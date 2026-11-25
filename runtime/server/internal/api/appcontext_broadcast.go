package api

import (
	"errors"
	"mindfs/server/internal/agent"
	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/api/usecase"
	"mindfs/server/internal/commandexec"
	"mindfs/server/internal/kanban"
	"mindfs/server/internal/session"
	"strings"
	"time"
)

func (s *AppContext) BroadcastSessionMetaUpdated(rootID string, sess *session.Session) {
	if sess == nil {
		s.GetSessionStreamHub().BroadcastAll(WSResponse{Type: "session.meta.updated"})
		return
	}
	s.GetSessionStreamHub().BroadcastAll(WSResponse{
		Type: "session.meta.updated",
		Payload: map[string]any{
			"root_id": rootID,
			"session": map[string]any{
				"key":                 sess.Key,
				"type":                sess.Type,
				"parent_session_key":  sess.ParentSessionKey,
				"parent_tool_call_id": sess.ParentToolCallID,
				"source":              sess.Source,
				"task_id":             sess.TaskID,
				"name":                sess.Name,
				"agent":               session.InferAgentFromSession(sess),
				"model":               sess.Model,
				"mode":                session.InferModeFromSession(sess),
				"effort":              session.InferEffortFromSession(sess),
				"fast_service":        session.InferFastServiceFromSession(sess),
				"plan_mode":           sess.PlanMode,
				"related_worktree":    sess.RelatedWorktree,
				"updated_at":          sess.UpdatedAt,
			},
		},
	})
}

func (s *AppContext) BroadcastAgentStatusChanged(agentName string) {
	agentName = strings.TrimSpace(agentName)
	if s == nil || agentName == "" || s.GetProber() == nil {
		return
	}
	status, ok := s.GetProber().GetStatus(agentName)
	if !ok {
		return
	}
	statuses := []agent.Status{status}
	if prefs := s.GetPreferences(); prefs != nil {
		statuses = prefs.ApplyAgentDefaults(statuses)
	}
	status = applyAgentAPIProviderCapabilities(statuses)[0]
	s.GetSessionStreamHub().BroadcastAll(WSResponse{
		Type: "agent.status.changed",
		Payload: map[string]any{
			"name":                             status.Name,
			"protocol":                         status.Protocol,
			"installed":                        status.Installed,
			"available":                        status.Available,
			"probe_pending":                    status.ProbePending,
			"version":                          status.Version,
			"error":                            status.Error,
			"last_probe":                       status.LastProbe,
			"current_model_id":                 status.CurrentModelID,
			"current_mode_id":                  status.CurrentModeID,
			"default_model_id":                 status.DefaultModelID,
			"default_effort":                   status.DefaultEffort,
			"default_fast_service":             status.DefaultFastService,
			"supports_api_provider_switch":     status.SupportsAPIProviderSwitch,
			"supported_api_provider_protocols": status.SupportedAPIProviderProtocols,
			"supports_fast_service":            status.SupportsFastService,
			"efforts":                          status.Efforts,
			"models":                           status.Models,
			"modes":                            status.Modes,
			"models_error":                     status.ModelsError,
			"modes_error":                      status.ModesError,
			"commands":                         status.Commands,
			"commands_error":                   status.CommandsError,
		},
	})
}

func (s *AppContext) SetSessionPendingReply(rootID, sessionKey, sessionTitle string) {
	s.GetSessionStreamHub().SetPendingReply(rootID, sessionKey, sessionTitle)
}

func (s *AppContext) BroadcastSessionUserMessage(rootID, sessionKey, sessionType, sessionName, agentName, model, mode, effort, fastService string, planMode bool, content string) {
	s.BroadcastSessionUserMessageAt(rootID, sessionKey, sessionType, sessionName, agentName, model, mode, effort, fastService, planMode, content, time.Now().UTC())
}

func (s *AppContext) BroadcastSessionUserMessageAt(rootID, sessionKey, sessionType, sessionName, agentName, model, mode, effort, fastService string, planMode bool, content string, timestamp time.Time, baseExchangeSeq ...int) {
	s.ClearTaskAuxFlagsForSession(rootID, sessionKey)
	s.GetSessionStreamHub().BroadcastSessionUserMessageAt(rootID, sessionKey, sessionType, sessionName, agentName, model, mode, effort, fastService, planMode, content, timestamp, "", false, baseExchangeSeq...)
}

func (s *AppContext) BroadcastSessionUpdate(rootID, sessionKey string, update agenttypes.Event) {
	event := updateToEvent(update)
	if event == nil {
		return
	}
	s.updateTaskAuxFlagsFromEvent(rootID, sessionKey, event)
	s.notifyAskUserIfNeeded(rootID, sessionKey, event)
	s.GetSessionStreamHub().BroadcastSessionStream(rootID, sessionKey, event)
}

func (s *AppContext) BroadcastSessionError(rootID, sessionKey, message string) {
	s.recordSessionFailure(rootID, sessionKey, message)
	s.UpdateTaskSessionErrorForSession(rootID, sessionKey, message)
	s.GetSessionStreamHub().BroadcastSessionStream(rootID, sessionKey, &StreamEvent{
		Type: "error",
		Data: map[string]string{"message": normalizeAgentErrorMessage(errors.New(message))},
	})
}

func (s *AppContext) ClearTaskAuxFlagsForSession(rootID, sessionKey string) {
	empty := ""
	no := false
	s.updateTaskAuxFlagsForSession(rootID, sessionKey, kanban.TaskAuxFlagsPatch{
		AskUserWaiting: &no,
		HasPlan:        &no,
		HasTodos:       &no,
		HasTask:        &no,
		SessionError:   &empty,
	}, "aux_flags_cleared")
}

func (s *AppContext) UpdateTaskSessionErrorForSession(rootID, sessionKey, message string) {
	trimmed := strings.TrimSpace(message)
	if trimmed == "" {
		return
	}
	s.updateTaskAuxFlagsForSession(rootID, sessionKey, kanban.TaskAuxFlagsPatch{
		SessionError: &trimmed,
	}, "agent_session_error")
}

func (s *AppContext) BroadcastSessionDone(rootID, sessionKey, requestID string) {
	hub := s.GetSessionStreamHub()
	pending := hub.PendingSessionSnapshot(sessionKey)
	s.notifySessionDone(rootID, sessionKey, requestID, pending)
	// Keep the current turn reserved until its completion reaches the clients.
	// Otherwise another endpoint can start a turn before this done is delivered.
	hub.waitForReplayClients(sessionKey)
	hub.BroadcastSessionDone(rootID, sessionKey, requestID)
	hub.ClearSessionPending(sessionKey)
}

func (s *AppContext) BroadcastScheduledTaskDone(rootID, taskID, taskName, sessionKey, summary string) {
	s.notifyScheduled(rootID, taskID, taskName, sessionKey, summary, "", true)
}

func (s *AppContext) BroadcastScheduledTaskFailed(rootID, taskID, taskName, sessionKey, message string) {
	s.notifyScheduled(rootID, taskID, taskName, sessionKey, "", message, false)
}

func (s *AppContext) GetCandidateRegistry() *usecase.CandidateRegistry {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.candidateRegistry == nil {
		registry := usecase.NewCandidateRegistry()
		registry.Register(usecase.NewFileCandidateProvider())
		if store, err := usecase.NewPromptStore(); err == nil {
			registry.Register(usecase.NewPromptCandidateProvider(store))
		}
		registry.Register(usecase.NewSkillCandidateProvider())
		registry.Register(usecase.NewCommandCandidateProvider(func() usecase.ShellHistorySpec {
			if s.Agents == nil {
				return usecase.ShellHistorySpec{}
			}
			cfg := s.Agents.Config()
			shells := make([]commandexec.ShellSpec, 0, len(cfg.Shells))
			for _, shell := range cfg.Shells {
				shells = append(shells, commandexec.ShellSpec{
					Command:       shell.Command,
					Args:          append([]string(nil), shell.Args...),
					LongShellArgs: append([]string(nil), shell.LongShellArgs...),
					CommandPrefix: shell.CommandPrefix,
				})
			}
			if shell, ok := commandexec.ResolveConfiguredShell(shells); ok {
				return usecase.ShellHistorySpec{Command: shell.Command}
			}
			return usecase.ShellHistorySpec{}
		}))
		registry.Register(usecase.NewSlashCommandCandidateProvider(func(agentName string) (agent.Status, bool) {
			if s.Prober == nil {
				return agent.Status{}, false
			}
			return s.Prober.GetStatus(agentName)
		}))
		s.candidateRegistry = registry
	}
	return s.candidateRegistry
}
