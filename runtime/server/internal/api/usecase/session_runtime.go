package usecase

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"mindfs/server/internal/agent"
	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/session"
)

func applyMessageRuntimeDefaultsFromStatus(
	in *SendMessageInput,
	status agent.Status,
	statusOK bool,
) {
	if in == nil || strings.TrimSpace(in.Model) != "" {
		return
	}
	in.Model = ""
	in.Effort = strings.TrimSpace(in.Effort)
	in.FastService = strings.TrimSpace(in.FastService)
	if status.Protocol == agent.ProtocolCodexSDK || status.Protocol == agent.ProtocolClaudeSDK || in.Agent == "codex" || in.Agent == "claude" {
		// Cached discovery data and previous session preferences are not a
		// user override for a new native CLI session.
		return
	}
	if !statusOK {
		return
	}
	in.Model = strings.TrimSpace(status.DefaultModelID)
	if in.Model == "" {
		in.Model = strings.TrimSpace(status.CurrentModelID)
	}
	if in.Effort == "" {
		in.Effort = strings.TrimSpace(status.DefaultEffort)
	}
	if in.FastService == "" {
		in.FastService = strings.TrimSpace(status.DefaultFastService)
	}
}

func (s *Service) applyMessageRuntimeDefaults(in *SendMessageInput) {
	if in == nil || strings.TrimSpace(in.Model) != "" {
		return
	}
	if s == nil || s.Registry == nil || s.Registry.GetProber() == nil {
		applyMessageRuntimeDefaultsFromStatus(in, agent.Status{}, false)
		return
	}
	status, ok := s.Registry.GetProber().GetStatus(strings.TrimSpace(in.Agent))
	if ok {
		if prefs := s.Registry.GetPreferences(); prefs != nil {
			status = prefs.ApplyAgentDefaults([]agent.Status{status})[0]
		}
	}
	applyMessageRuntimeDefaultsFromStatus(in, status, ok)
}

func sendMessageUserTimestamp(in SendMessageInput, fallback time.Time) time.Time {
	if !in.UserTimestamp.IsZero() {
		return in.UserTimestamp.UTC()
	}
	if fallback.IsZero() {
		return time.Now().UTC()
	}
	return fallback.UTC()
}

func (s *Service) ensureAgentSession(
	ctx context.Context,
	pool *agent.Pool,
	manager *session.Manager,
	current *session.Session,
	agentName string,
	model string,
	mode string,
	effort string,
	fastService string,
	readOnly bool,
	rootAbs string,
	developerInstructions string,
	onResumeFallback func(),
) (agenttypes.Session, *int, error) {
	poolSessionKey := agentPoolSessionKey(current.Key, agentName)
	nextModel := resolveRuntimeModel(current, nil, model)
	nextMode := resolveRuntimeMode(current, mode)
	nextEffort := resolveRuntimeEffort(agentName, current, effort)
	nextFastService := resolveRuntimeFastService(agentName, current, fastService)
	nextPlanMode := current != nil && current.PlanMode && !readOnly
	if readOnly {
		nextMode = ""
	}
	var binding *session.AgentBinding
	if manager != nil {
		var err error
		binding, err = manager.FindAgentBinding(ctx, current.Key, agentName)
		if err != nil {
			return nil, nil, err
		}
	}
	currentModel := ""
	currentMode := ""
	currentEffort := ""
	currentFastService := ""
	currentPlanMode := false
	if current != nil {
		currentModel = resolveSessionExchangeModel(current)
		if currentModel == "" {
			currentModel = strings.TrimSpace(current.Model)
		}
		currentMode = resolveSessionExchangeMode(current)
		currentEffort = session.InferEffortFromSession(current)
		currentFastService = inferFastServiceFromSession(current)
		currentPlanMode = current.PlanMode
	}
	if existing, existingReadOnly, ok := pool.GetWithReadOnly(poolSessionKey); ok {
		if existingReadOnly == readOnly && !shouldReopenSessionForSetting(pool, agentName, currentEffort, nextEffort) &&
			currentFastService == nextFastService {
			if current != nil && currentModel != nextModel {
				log.Printf("[session/model] switch.detected session=%s agent=%s from=%q to=%q action=set_runtime_model", current.Key, agentName, currentModel, nextModel)
				if err := existing.SetModel(ctx, nextModel); err != nil {
					if prober := s.Registry.GetProber(); prober != nil {
						prober.ReportRuntimeFailure(agentName, err)
					}
					log.Printf("[session/model] switch.error session=%s agent=%s model=%q pool_session=%s err=%v", current.Key, agentName, nextModel, poolSessionKey, err)
					return nil, nil, err
				}
				log.Printf("[session/model] switch.done session=%s agent=%s model=%q pool_session=%s", current.Key, agentName, nextModel, poolSessionKey)
			}
			if !readOnly && current != nil && currentMode != nextMode {
				log.Printf("[session/mode] switch.detected session=%s agent=%s from=%q to=%q action=set_runtime_mode", current.Key, agentName, currentMode, nextMode)
				if err := existing.SetMode(ctx, nextMode); err != nil {
					if prober := s.Registry.GetProber(); prober != nil {
						prober.ReportRuntimeFailure(agentName, err)
					}
					log.Printf("[session/mode] switch.error session=%s agent=%s mode=%q pool_session=%s err=%v", current.Key, agentName, nextMode, poolSessionKey, err)
					return nil, nil, err
				}
				log.Printf("[session/mode] switch.done session=%s agent=%s mode=%q pool_session=%s", current.Key, agentName, nextMode, poolSessionKey)
			}
			if !readOnly && current != nil && currentPlanMode != nextPlanMode {
				log.Printf("[session/plan] switch.detected session=%s agent=%s from=%t to=%t action=set_plan_mode", current.Key, agentName, currentPlanMode, nextPlanMode)
				if err := existing.SetPlanMode(ctx, nextPlanMode); err != nil {
					if prober := s.Registry.GetProber(); prober != nil {
						prober.ReportRuntimeFailure(agentName, err)
					}
					log.Printf("[session/plan] switch.error session=%s agent=%s plan_mode=%t pool_session=%s err=%v", current.Key, agentName, nextPlanMode, poolSessionKey, err)
					return nil, nil, err
				}
				log.Printf("[session/plan] switch.done session=%s agent=%s plan_mode=%t pool_session=%s", current.Key, agentName, nextPlanMode, poolSessionKey)
			}
			// The transcript mode can drift from the live runtime (CLI reset,
			// native plan entry, dropped bypass). Re-check before the next send
			// and abort the turn when the runtime refuses to re-sync.
			if !readOnly {
				if err := ensureRuntimePermissionMode(ctx, current, agentName, nextMode, existing); err != nil {
					if prober := s.Registry.GetProber(); prober != nil {
						prober.ReportRuntimeFailure(agentName, err)
					}
					log.Printf("[session/mode] verify.error session=%s agent=%s mode=%q pool_session=%s err=%v", poolSessionKey, agentName, nextMode, poolSessionKey, err)
					return nil, nil, err
				}
			}
			var currentSeq *int
			if current != nil {
				last := current.AgentCtxSeq[agentName]
				currentSeq = &last
			}
			return existing, currentSeq, nil
		}
		log.Printf("[session/settings] reopen.detected session=%s agent=%s effort_from=%q effort_to=%q fast_service_from=%q fast_service_to=%q read_only_from=%t read_only_to=%t action=resume_runtime_session", current.Key, agentName, currentEffort, nextEffort, currentFastService, nextFastService, existingReadOnly, readOnly)
		pool.Close(poolSessionKey)
	}

	openCtx := pool.Context()
	if openCtx == nil {
		openCtx = ctx
	}

	openInput := agenttypes.OpenSessionInput{
		SessionKey:            poolSessionKey,
		AgentName:             agentName,
		Model:                 nextModel,
		Mode:                  nextMode,
		Effort:                nextEffort,
		FastService:           nextFastService,
		PlanMode:              nextPlanMode,
		ReadOnly:              readOnly,
		RootPath:              rootAbs,
		DeveloperInstructions: developerInstructions,
		AgentSessionID: strings.TrimSpace(func() string {
			if binding == nil {
				return ""
			}
			return binding.AgentSessionID
		}()),
		AgentCtxSeq: func() int {
			if binding == nil {
				return 0
			}
			return binding.AgentCtxSeq
		}(),
	}
	if openInput.AgentSessionID != "" {
		log.Printf("[session/model] open session=%s agent=%s model=%q mode=%q effort=%q fast_service=%q pool_session=%s action=resume_runtime_session agent_session_id=%s agent_ctx_seq=%d", current.Key, agentName, nextModel, nextMode, nextEffort, nextFastService, poolSessionKey, openInput.AgentSessionID, openInput.AgentCtxSeq)
	} else {
		log.Printf("[session/model] open session=%s agent=%s model=%q mode=%q effort=%q fast_service=%q pool_session=%s action=open_new_runtime_session", current.Key, agentName, nextModel, nextMode, nextEffort, nextFastService, poolSessionKey)
	}
	sess, err := pool.GetOrCreate(openCtx, openInput)
	var ctxSeqOverride *int
	if err != nil {
		if openInput.AgentSessionID != "" {
			log.Printf("[session/model] resume.error session=%s agent=%s model=%q mode=%q effort=%q fast_service=%q pool_session=%s agent_session_id=%s err=%v fallback=open_new_runtime_session", current.Key, agentName, nextModel, nextMode, nextEffort, nextFastService, poolSessionKey, openInput.AgentSessionID, err)
			openInput.AgentSessionID = ""
			openInput.AgentCtxSeq = 0
			sess, err = pool.GetOrCreate(openCtx, openInput)
			if err == nil {
				zero := 0
				ctxSeqOverride = &zero
				if onResumeFallback != nil {
					onResumeFallback()
				}
			}
		}
	}
	if err != nil {
		if prober := s.Registry.GetProber(); prober != nil {
			prober.ReportRuntimeFailure(agentName, err)
		}
		log.Printf("[session/model] open.error session=%s agent=%s model=%q mode=%q effort=%q fast_service=%q pool_session=%s err=%v", current.Key, agentName, nextModel, nextMode, nextEffort, nextFastService, poolSessionKey, err)
		return nil, nil, err
	}
	if ctxSeqOverride == nil && binding != nil && openInput.AgentSessionID != "" {
		last := binding.AgentCtxSeq
		ctxSeqOverride = &last
	}
	log.Printf("[session/model] open.done session=%s agent=%s model=%q mode=%q effort=%q fast_service=%q pool_session=%s", current.Key, agentName, nextModel, nextMode, nextEffort, nextFastService, poolSessionKey)
	return sess, ctxSeqOverride, nil
}

func shouldReopenSessionForSetting(pool *agent.Pool, agentName, currentValue, nextValue string) bool {
	currentValue = strings.TrimSpace(currentValue)
	nextValue = strings.TrimSpace(nextValue)
	if currentValue == nextValue {
		return false
	}
	if pool == nil {
		return false
	}
	def, ok := pool.Config().GetAgent(agentName)
	if !ok {
		return false
	}
	protocol := def.Protocol
	if protocol == "" {
		protocol = agent.DefaultProtocol(agentName)
	}
	return protocol == agent.ProtocolCodexSDK || protocol == agent.ProtocolClaudeSDK
}

func resolveRuntimeModel(current *session.Session, runtime agenttypes.Session, requested string) string {
	if model := strings.TrimSpace(requested); model != "" {
		return model
	}
	if runtime != nil {
		if model := strings.TrimSpace(runtime.CurrentModel()); model != "" {
			return model
		}
	}
	if model := resolveSessionExchangeModel(current); model != "" {
		return model
	}
	if current == nil {
		return ""
	}
	return strings.TrimSpace(current.Model)
}

func (s *Service) resolveExchangeModelDisplayName(agentName, model string) string {
	agentName = strings.TrimSpace(agentName)
	model = strings.TrimSpace(model)
	if agentName != "claude" || model == "" || s == nil || s.Registry == nil {
		return ""
	}
	prober := s.Registry.GetProber()
	if prober == nil {
		return ""
	}
	status, ok := prober.GetStatus(agentName)
	if !ok {
		return ""
	}
	for _, item := range status.Models {
		if strings.TrimSpace(item.ID) == model {
			return strings.TrimSpace(item.Name)
		}
	}
	return ""
}

func resolveRuntimeEffort(_ string, current *session.Session, requested string) string {
	if effort := strings.TrimSpace(requested); effort != "" {
		return effort
	}
	if effort := session.InferEffortFromSession(current); effort != "" {
		return effort
	}
	return ""
}

func resolveRuntimeFastService(agentName string, current *session.Session, requested string) string {
	if strings.TrimSpace(agentName) != "codex" {
		return ""
	}
	if value := strings.TrimSpace(requested); value != "" {
		return value
	}
	return inferFastServiceFromSession(current)
}

func inferFastServiceFromSession(current *session.Session) string {
	return session.InferFastServiceFromSession(current)
}

func resolveRuntimeMode(current *session.Session, requested string) string {
	if mode := strings.TrimSpace(requested); mode != "" {
		return mode
	}
	if mode := resolveSessionExchangeMode(current); mode != "" {
		return mode
	}
	return ""
}

func resolveSessionExchangeModel(current *session.Session) string {
	if current == nil || len(current.Exchanges) == 0 {
		return ""
	}
	for i := len(current.Exchanges) - 1; i >= 0; i-- {
		model := strings.TrimSpace(current.Exchanges[i].Model)
		if model != "" {
			return model
		}
	}
	return ""
}

func resolveSessionExchangeMode(current *session.Session) string {
	if current == nil || len(current.Exchanges) == 0 {
		return ""
	}
	for i := len(current.Exchanges) - 1; i >= 0; i-- {
		mode := strings.TrimSpace(current.Exchanges[i].Mode)
		if mode != "" {
			return mode
		}
	}
	return ""
}

// duckPermissionModeReader is implemented by runtime sessions that can report
// their live permission mode. Currently only the Claude SDK session does;
// keeping this duck-typed avoids touching the shared session interface and
// other providers.
type duckPermissionModeReader interface {
	CurrentMode() string
}

// runtimePermissionMode returns the live permission mode reported by a pooled
// runtime session, or "" when it cannot report one (legacy providers/stubs).
func runtimePermissionMode(runtime agenttypes.Session) string {
	if runtime == nil {
		return ""
	}
	reader, ok := runtime.(duckPermissionModeReader)
	if !ok {
		return ""
	}
	return strings.TrimSpace(reader.CurrentMode())
}

// ensureRuntimePermissionMode re-checks a pooled runtime session's live
// permission mode against the mode resolved for the next message. The
// transcript alone cannot be trusted: the CLI may have reset the mode, entered
// plan natively, or dropped a bypass selection since the last exchange, so a
// recorded-but-inactive bypass would otherwise never be corrected. When the
// runtime disagrees, a SetMode control request is sent and must succeed
// before the caller continues; after the ack both sides agree, so following
// turns need no repeated control request.
//
// An empty nextMode keeps the CLI default semantics: nothing is forced.
// Runtimes that cannot report their mode keep the legacy behavior. While the
// runtime is planning, SetMode only records the requested base mode (see the
// Claude session), so the plan approval flow is never bypassed and exiting
// plan restores the user's selection.
func ensureRuntimePermissionMode(ctx context.Context, current *session.Session, agentName, nextMode string, existing agenttypes.Session) error {
	nextMode = strings.TrimSpace(nextMode)
	if nextMode == "" || existing == nil {
		return nil
	}
	runtimeMode := runtimePermissionMode(existing)
	if runtimeMode == "" || runtimeMode == nextMode {
		return nil
	}
	key := ""
	if current != nil {
		key = current.Key
	}
	log.Printf("[session/mode] verify.detected session=%s agent=%s runtime_mode=%q resolved_mode=%q action=set_runtime_mode", key, agentName, runtimeMode, nextMode)
	if err := existing.SetMode(ctx, nextMode); err != nil {
		return err
	}
	log.Printf("[session/mode] verify.done session=%s agent=%s mode=%q pool_session_runtime_mode=%q", key, agentName, nextMode, runtimePermissionMode(existing))
	return nil
}

func (s *Service) validateAgentModel(agentName, model string) error {
	agentName = strings.TrimSpace(agentName)
	model = strings.TrimSpace(model)
	if agentName == "" || model == "" || s.Registry == nil {
		return nil
	}
	prober := s.Registry.GetProber()
	if prober == nil {
		return nil
	}
	status, ok := prober.GetStatus(agentName)
	if !ok {
		return nil
	}
	if prefs := s.Registry.GetPreferences(); prefs != nil {
		status = prefs.ApplyAgentDefaults([]agent.Status{status})[0]
	}
	if len(status.Models) == 0 {
		return nil
	}
	for _, item := range status.Models {
		if strings.TrimSpace(item.ID) == model {
			return nil
		}
	}
	return fmt.Errorf("model %q is not supported by agent %q", model, agentName)
}
