package codex

import (
	"context"
	"errors"
	codexsdk "github.com/fanwenlin/codex-go-sdk/codex"
	"log"
	types "mindfs/server/internal/agent/types"
	"strings"
)

func (s *session) isReadOnly() bool {
	if s == nil {
		return false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.readOnly
}

func (s *session) SetModel(_ context.Context, model string) error {
	if s == nil || s.client == nil {
		return errors.New("codex session not initialized")
	}
	threadID := strings.TrimSpace(s.SessionID())
	if threadID == "" {
		s.updateThreadIDFromThread()
		threadID = strings.TrimSpace(s.SessionID())
	}
	if threadID == "" {
		return errors.New("codex thread id unavailable")
	}
	opts := s.threadOpts
	opts.Model = strings.TrimSpace(model)
	opts.CollaborationMode = codexCollaborationMode(s.planMode)
	if s.isReadOnly() {
		opts.SandboxMode, opts.ApprovalPolicy = "read-only", "never"
	}
	thread := s.client.ResumeThread(threadID, opts)
	s.mu.Lock()
	s.thread = thread
	s.threadOpts = opts
	s.threadID = threadID
	s.mu.Unlock()
	return nil
}

func (s *session) SetPlanMode(ctx context.Context, enabled bool) error {
	if s == nil || s.client == nil {
		return errors.New("codex session not initialized")
	}
	if s.isReadOnly() && enabled {
		return errors.New("read-only session cannot enter plan mode")
	}
	threadID := strings.TrimSpace(s.SessionID())
	if threadID == "" {
		s.updateThreadIDFromThread()
		threadID = strings.TrimSpace(s.SessionID())
	}
	if threadID == "" {
		return errors.New("codex thread id unavailable")
	}
	opts := s.threadOpts
	opts.CollaborationMode = codexCollaborationMode(enabled)
	thread := s.client.ResumeThread(threadID, opts)
	if err := thread.SetCollaborationMode(ctx, opts.CollaborationMode); err != nil {
		return err
	}
	s.mu.Lock()
	s.thread = thread
	s.threadOpts = opts
	s.threadID = threadID
	s.planMode = enabled
	s.mu.Unlock()
	return nil
}

func (s *session) ListModels(ctx context.Context) (types.ModelList, error) {
	if s == nil || s.client == nil {
		return types.ModelList{}, errors.New("codex session not initialized")
	}
	resp, err := s.client.ListModels(ctx, codexListModelsParams())
	if err != nil {
		return types.ModelList{}, err
	}
	models := make([]types.ModelInfo, 0, len(resp.Data))
	currentModelID := ""
	defaults, _ := s.RuntimeDefaults(ctx)
	for _, model := range resp.Data {
		name := strings.TrimSpace(model.DisplayName)
		if name == "" {
			name = strings.TrimSpace(model.Model)
		}
		models = append(models, types.ModelInfo{
			ID:            model.Model,
			Name:          name,
			Description:   model.Description,
			Hidden:        model.Hidden,
			SupportEffort: true,
			Efforts:       codexModelEfforts(model.SupportedReasoningEfforts),
		})
		if model.IsDefault && currentModelID == "" {
			currentModelID = model.Model
		}
	}
	if strings.TrimSpace(defaults.Model) != "" {
		currentModelID = strings.TrimSpace(defaults.Model)
	}
	return types.ModelList{
		CurrentModelID: currentModelID,
		Models:         models,
	}, nil
}

func codexListModelsParams() codexsdk.ModelListParams {
	includeHidden := true
	return codexsdk.ModelListParams{IncludeHidden: &includeHidden}
}

func codexModelEfforts(options []codexsdk.ReasoningEffortOption) []string {
	efforts := make([]string, 0, len(options))
	seen := make(map[string]struct{}, len(options))
	for _, option := range options {
		effort := strings.TrimSpace(string(option.ReasoningEffort))
		if effort == "" || effort == "none" {
			continue
		}
		if _, ok := seen[effort]; ok {
			continue
		}
		seen[effort] = struct{}{}
		efforts = append(efforts, effort)
	}
	return efforts
}

func (s *session) RuntimeDefaults(ctx context.Context) (types.RuntimeDefaults, error) {
	if s == nil || s.client == nil {
		return types.RuntimeDefaults{}, errors.New("codex session not initialized")
	}
	params := codexsdk.ConfigReadParams{
		IncludeLayers: false,
		Cwd:           strings.TrimSpace(s.threadOpts.WorkingDirectory),
	}
	resp, err := s.client.ReadConfig(ctx, params)
	if err != nil {
		log.Printf("[codex/runtime_defaults] config.read.error cwd=%q err=%v", params.Cwd, err)
		return types.RuntimeDefaults{}, err
	}
	defaults := types.RuntimeDefaults{}
	if resp == nil {
		log.Printf("[codex/runtime_defaults] config.read.empty cwd=%q", params.Cwd)
		return defaults, nil
	}
	if resp.Config.Model != nil {
		defaults.Model = strings.TrimSpace(*resp.Config.Model)
	}
	if resp.Config.ModelReasoningEffort != nil {
		defaults.Effort = strings.TrimSpace(string(*resp.Config.ModelReasoningEffort))
	}
	if resp.Config.ServiceTier != nil {
		if strings.TrimSpace(*resp.Config.ServiceTier) == "fast" {
			defaults.FastService = "on"
		} else {
			defaults.FastService = "off"
		}
	}
	return defaults, nil
}

func applyPermissionMode(opts *codexsdk.ThreadOptions, mode string) error {
	switch strings.TrimSpace(mode) {
	case "":
		opts.SandboxMode, opts.ApprovalPolicy = "", ""
	case "full-access":
		opts.SandboxMode, opts.ApprovalPolicy = "danger-full-access", "never"
	case "default":
		opts.SandboxMode, opts.ApprovalPolicy = "workspace-write", "on-request"
	case "read-only":
		opts.SandboxMode, opts.ApprovalPolicy = "read-only", "on-request"
	default:
		return errors.New("unsupported Codex permission mode: " + mode)
	}
	return nil
}

func (s *session) SetMode(_ context.Context, mode string) error {
	if s == nil || s.client == nil {
		return errors.New("codex session not initialized")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.readOnly {
		trimmed := strings.TrimSpace(mode)
		if trimmed != "" && trimmed != "read-only" {
			return errors.New("read-only session cannot change permission mode")
		}
		return nil
	}
	opts := s.threadOpts
	if err := applyPermissionMode(&opts, mode); err != nil {
		return err
	}
	threadID := s.threadID
	if threadID == "" && s.thread != nil && s.thread.ID() != nil {
		threadID = *s.thread.ID()
	}
	if threadID == "" {
		s.thread = s.client.StartThread(opts)
	} else {
		s.thread = s.client.ResumeThread(threadID, opts)
	}
	s.threadOpts = opts
	return nil
}

func (s *session) ListModes(_ context.Context) (types.ModeList, error) {
	return types.ModeList{Modes: []types.ModeInfo{
		{ID: "full-access", Name: "full-access", Description: "Run commands and edit files without approval prompts."},
		{ID: "default", Name: "default", Description: "Workspace access; Codex requests approval when needed."},
		{ID: "read-only", Name: "read-only", Description: "Read files; request approval for changes."},
	}}, nil
}

func (s *session) ListCommands(ctx context.Context) (types.CommandList, error) {
	_ = ctx
	if s == nil || s.client == nil {
		return types.CommandList{}, errors.New("codex session not initialized")
	}
	supported := s.client.SupportedSlashCommands()
	commands := make([]types.CommandInfo, 0, len(supported))
	for _, command := range supported {
		name := strings.TrimSpace(command.Name)
		if name == "" {
			continue
		}
		commands = append(commands, types.CommandInfo{
			Name:         name,
			Description:  strings.TrimSpace(command.Description),
			ArgumentHint: strings.TrimSpace(command.ArgumentHint),
		})
	}
	log.Printf("[agent/codex] commands.cached session=%s count=%d", s.sessionKey, len(commands))
	return types.CommandList{Commands: commands}, nil
}

func (s *session) emitMessageDelta(msg *codexsdk.AgentMessageItem, textByID map[string]string) {
	delta := messageDelta(textByID[msg.ID], msg.Text)
	textByID[msg.ID] = msg.Text
	if delta == "" {
		return
	}
	s.emit(types.Event{Type: types.EventTypeMessageChunk, SessionID: s.SessionID(), Data: types.MessageChunk{Content: delta}})
}
