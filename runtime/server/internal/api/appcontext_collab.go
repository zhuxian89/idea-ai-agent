package api

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"

	"mindfs/server/internal/agent"
	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/api/usecase"
	"mindfs/server/internal/collab"
	"mindfs/server/internal/session"
)

func (s *AppContext) GetCollabService() (*collab.Service, error) {
	if s == nil {
		return nil, errors.New("app context required")
	}
	s.mu.RLock()
	svc := s.Collab
	s.mu.RUnlock()
	if svc != nil {
		return svc, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Collab != nil {
		return s.Collab, nil
	}
	templates, err := collab.NewTemplateStore()
	if err != nil {
		return nil, err
	}
	s.Collab = collab.NewService(templates, s)
	return s.Collab, nil
}

func (s *AppContext) GetCollabStore(rootID string) (*collab.Store, error) {
	rootCtx, err := s.GetRootContext(rootID)
	if err != nil {
		return nil, err
	}
	mgr, err := s.GetSessionManager(rootID)
	if err != nil {
		return nil, err
	}
	metaDB, err := mgr.MetaDB()
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if rootCtx.Collab != nil {
		return rootCtx.Collab, nil
	}
	store, err := collab.NewStore(metaDB)
	if err != nil {
		return nil, err
	}
	if err := store.RecoverInterruptedRuns(context.Background()); err != nil {
		return nil, err
	}
	rootCtx.Collab = store
	return store, nil
}

func (s *AppContext) RootPath(rootID string) (string, error) {
	root, err := s.GetRoot(rootID)
	if err != nil {
		return "", err
	}
	return root.RootPath, nil
}

func (s *AppContext) AgentStatuses() []agent.Status {
	if s == nil || s.Prober == nil {
		return nil
	}
	statuses := s.Prober.GetAllStatuses()
	if s.Prefs != nil {
		statuses = s.Prefs.ApplyAgentDefaults(statuses)
	}
	return statuses
}

func (s *AppContext) EnsureStageSession(ctx context.Context, req collab.StageSessionRequest) (string, error) {
	mgr, err := s.GetSessionManager(req.RootID)
	if err != nil {
		return "", err
	}
	key := strings.TrimSpace(req.SessionKey)
	if key != "" {
		if existing, getErr := mgr.Get(ctx, key, 0); getErr == nil && existing != nil {
			if nextModel := strings.TrimSpace(req.Model); existing.Model != nextModel {
				_ = mgr.UpdateModel(ctx, existing, nextModel)
			}
			return existing.Key, nil
		}
	}
	source := session.SourceCollabStage
	if req.ReadOnly {
		source = session.SourceCollabReview
	}
	created, err := mgr.Create(ctx, session.CreateInput{
		Key:    key,
		Type:   session.TypeChat,
		Source: source,
		TaskID: strings.TrimSpace(req.RunID),
		Agent:  strings.TrimSpace(req.Agent),
		Model:  strings.TrimSpace(req.Model),
		Name:   strings.TrimSpace(req.Title),
	})
	if err != nil {
		return "", err
	}
	return created.Key, nil
}

func (s *AppContext) StageTurnActive(rootID, sessionKey string) bool {
	return usecase.SessionTurnActive(rootID, sessionKey)
}

func (s *AppContext) RunStageTurn(ctx context.Context, req collab.StageTurnRequest) (collab.StageTurnResult, error) {
	uc := &usecase.Service{Registry: s}
	sessionKey := strings.TrimSpace(req.SessionKey)
	sessionName := s.sessionTitle(req.RootID, sessionKey)
	updateTracker := newTurnUpdateTracker()
	planMode := false
	userTimestamp := time.Now().UTC()

	resolvedModel := strings.TrimSpace(req.Model)
	s.SetSessionPendingReply(req.RootID, sessionKey, sessionName)
	err := uc.SendMessage(ctx, usecase.SendMessageInput{
		RootID:                 req.RootID,
		Key:                    sessionKey,
		Agent:                  req.Agent,
		Model:                  req.Model,
		Mode:                   req.PermissionMode,
		Effort:                 req.Effort,
		PlanMode:               &planMode,
		ReadOnly:               req.ReadOnly,
		ExplicitRuntimeOptions: true,
		ReturnErrorOnCancel:    true,
		StreamFilter:           req.StreamFilter,
		SkipSwitchHint:         req.SkipSwitchHint,
		MemberSlotID:           req.MemberSlotID,
		OnRegistered:           req.OnRegistered,
		OnToolCall:             req.OnToolCall,
		Content:                req.Prompt,
		UserTimestamp:          userTimestamp,
		OnStart: func(start usecase.MessageStart) {
			if m := strings.TrimSpace(start.Model); m != "" {
				resolvedModel = m
			}
			s.BroadcastSessionUserMessageAt(req.RootID, sessionKey, session.TypeChat, sessionName, req.Agent, start.Model, start.Mode, start.Effort, start.FastService, false, req.Prompt, userTimestamp, start.BaseExchangeSeq)
		},
		OnUpdate: func(update agenttypes.Event) {
			updateTracker.Begin()
			defer updateTracker.End()
			if chunk, ok := update.Data.(agenttypes.MessageChunk); req.OnText != nil && update.Type == agenttypes.EventTypeMessageChunk && ok &&
				chunk.ParentToolUseID == "" && chunk.TaskID == "" {
				req.OnText(chunk.Content)
			}
			s.BroadcastSessionUpdate(req.RootID, sessionKey, update)
		},
		OnSubSessionCreated: func(created *session.Session) {
			s.BroadcastSessionMetaUpdated(req.RootID, created)
			if created != nil {
				s.SetSessionPendingReply(req.RootID, created.Key, created.Name)
			}
		},
		OnSubSessionUpdate: func(subKey string, update agenttypes.Event) {
			updateTracker.Begin()
			defer updateTracker.End()
			s.BroadcastSessionUpdate(req.RootID, subKey, update)
			if update.Type == agenttypes.EventTypeMessageDone {
				s.BroadcastSessionDone(req.RootID, subKey, "")
			}
		},
	})
	if err != nil && !errors.Is(err, context.Canceled) {
		s.BroadcastSessionError(req.RootID, sessionKey, err.Error())
	}
	if ok := updateTracker.WaitIdle(ctx, sessionDoneSettleWindow, sessionDoneMaxWait); !ok {
		log.Printf("[collab] session.done.wait_timeout root=%s session=%s", req.RootID, sessionKey)
	}
	s.BroadcastSessionDone(req.RootID, sessionKey, "")

	if err == nil {
		if mgr, mgrErr := s.GetSessionManager(req.RootID); mgrErr == nil && mgr != nil {
			if latest, getErr := mgr.Get(context.Background(), sessionKey, 0); getErr == nil && latest != nil {
				if m := strings.TrimSpace(latest.Model); m != "" {
					resolvedModel = m
				}
			}
		}
	}
	return collab.StageTurnResult{
		ResolvedModel: resolvedModel,
	}, err
}

func (s *AppContext) CancelStageTurn(ctx context.Context, rootID, sessionKey string) error {
	uc := &usecase.Service{Registry: s}
	return uc.CancelSessionTurn(ctx, usecase.CancelSessionTurnInput{
		RootID: rootID,
		Key:    sessionKey,
	})
}

func (s *AppContext) DeleteStageSession(ctx context.Context, rootID, sessionKey string) error {
	uc := &usecase.Service{Registry: s}
	return uc.DeleteSession(ctx, usecase.DeleteSessionInput{
		RootID: rootID,
		Key:    sessionKey,
	})
}

func (s *AppContext) RunUpdated(rootID string, run collab.Run, waitingCount int) {
	s.GetSessionStreamHub().BroadcastAll(WSResponse{
		Type: "collab.run.updated",
		Payload: map[string]any{
			"root_id":       rootID,
			"run":           run,
			"waiting_count": waitingCount,
		},
	})
}

func (s *AppContext) MeetingChunk(rootID, runID, turnID, attempt string, seq int, delta string) {
	s.GetSessionStreamHub().BroadcastAll(WSResponse{
		Type: "collab.meeting.chunk",
		Payload: map[string]any{"root_id": rootID, "run_id": runID,
			"turn_id": turnID, "attempt": attempt, "seq": seq, "delta": delta},
	})
}
