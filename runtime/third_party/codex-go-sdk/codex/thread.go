package codex

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"github.com/fanwenlin/codex-go-sdk/types"
)

type reviewExec interface {
	RunReview(args CodexExecArgs, params types.ReviewStartParams) <-chan ExecResult
}

type shellCommandExec interface {
	RunShellCommand(args CodexExecArgs, command string) <-chan ExecResult
}

type compactExec interface {
	RunCompact(args CodexExecArgs) <-chan ExecResult
}

type goalSetExec interface {
	RunGoalSet(args CodexExecArgs, params types.ThreadGoalSetParams) <-chan ExecResult
}

type threadEventsExec interface {
	SubscribeThreadEvents(args CodexExecArgs) <-chan ExecResult
}

type threadUnsubscribeExec interface {
	UnsubscribeThread(ctx context.Context, threadID string) (*types.ThreadUnsubscribeResponse, error)
}

var syntheticTurnCounter uint64

// Thread represents a conversation thread with the agent.
type Thread struct {
	exec          Exec
	options       types.CodexOptions
	id            *string
	threadOptions types.ThreadOptions
}

// ID returns the thread ID. Populated after the first turn starts.
func (t *Thread) ID() *string {
	return t.id
}

// Unsubscribe removes this SDK connection's subscription to the thread. The
// app server unloads a thread after its own no-subscriber inactivity period.
// A later turn transparently resumes the persisted thread.
func (t *Thread) Unsubscribe(ctx context.Context) (*types.ThreadUnsubscribeResponse, error) {
	if t == nil || t.id == nil || strings.TrimSpace(*t.id) == "" {
		return &types.ThreadUnsubscribeResponse{Status: types.ThreadUnsubscribeStatusNotLoaded}, nil
	}
	threadID := strings.TrimSpace(*t.id)
	if exec, ok := t.exec.(threadUnsubscribeExec); ok {
		return exec.UnsubscribeThread(ctx, threadID)
	}
	var response types.ThreadUnsubscribeResponse
	if err := t.appServerRPCTyped(ctx, "thread/unsubscribe", map[string]interface{}{
		"threadId": threadID,
	}, &response); err != nil {
		return nil, err
	}
	return &response, nil
}

// Close releases the live app-server resources associated with the thread
// without deleting or archiving its persisted conversation.
func (t *Thread) Close(ctx context.Context) error {
	_, err := t.Unsubscribe(ctx)
	return err
}

// SetCollaborationMode updates the app-server thread collaboration mode for subsequent turns.
func (t *Thread) SetCollaborationMode(ctx context.Context, mode *types.CollaborationMode) error {
	if mode == nil {
		return fmt.Errorf("collaboration mode required")
	}
	threadID, err := t.ensureAppServerThread(ctx)
	if err != nil {
		return err
	}
	nextMode := buildCollaborationMode(mode, t.threadOptions.Model, string(t.threadOptions.ModelReasoningEffort))
	if nextMode == nil {
		return fmt.Errorf("collaboration mode required")
	}

	waitCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	updates, err := t.subscribeEvents(waitCtx)
	if err != nil {
		return err
	}

	if err := t.appServerRPCTyped(ctx, "thread/settings/update", map[string]interface{}{
		"threadId":          threadID,
		"collaborationMode": nextMode,
	}, nil); err != nil {
		return err
	}
	if err := waitForThreadCollaborationModeEvent(ctx, updates, threadID, nextMode.Mode); err != nil {
		return err
	}

	t.threadOptions.CollaborationMode = mode
	return nil
}

// newThread creates a new Thread instance.
func newThread(exec Exec, options types.CodexOptions, threadOptions types.ThreadOptions, id *string) *Thread {
	return &Thread{
		exec:          exec,
		options:       options,
		id:            id,
		threadOptions: threadOptions,
	}
}

func waitForThreadCollaborationModeEvent(
	ctx context.Context,
	events <-chan types.ThreadEvent,
	threadID string,
	mode types.CollaborationModeKind,
) error {
	timer := time.NewTimer(defaultInterruptTimeout)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timer.C:
			return fmt.Errorf("timed out waiting for thread settings collaboration mode %q", mode)
		case event, ok := <-events:
			if !ok {
				return fmt.Errorf("thread settings stream closed")
			}
			if threadSettingsRawEventMatches(event, threadID, mode) {
				return nil
			}
		}
	}
}

func threadSettingsRawEventMatches(event types.ThreadEvent, threadID string, mode types.CollaborationModeKind) bool {
	rawEvent, ok := event.(*types.RawEvent)
	if !ok {
		return false
	}
	return threadSettingsCollaborationModeLineMatches(rawEvent.Raw, threadID, mode)
}

// RunStreamed provides input to the agent and streams events as they are produced.
func (t *Thread) RunStreamed(input types.Input, turnOptions types.TurnOptions) (*types.StreamedTurn, error) {
	if cmd, ok := parseSlashCommand(input); ok && isSupportedSlashCommand(cmd.name) {
		return t.runSlashStreamed(cmd, turnOptions)
	}

	events, err := t.runStreamedInternal(input, turnOptions)
	if err != nil {
		return nil, err
	}
	return &types.StreamedTurn{Events: events}, nil
}

// runStreamedInternal is the internal implementation that generates events.
func (t *Thread) runStreamedInternal(input types.Input, turnOptions types.TurnOptions) (chan types.ThreadEvent, error) {
	// Create output schema file if needed
	schemaFile, err := CreateOutputSchemaFile(turnOptions.OutputSchema)
	if err != nil {
		return nil, fmt.Errorf("failed to create output schema file: %w", err)
	}

	prompt, images := t.normalizeInput(input)
	inputItems := t.normalizeInputItems(input)

	ctx := resolveTurnContext(turnOptions)
	args := t.buildExecArgs(ctx, prompt, inputItems, images, schemaFile.SchemaPath, turnOptions)

	events := make(chan types.ThreadEvent)

	go func() {
		defer close(events)
		defer func() {
			if cleanupErr := schemaFile.Cleanup(); cleanupErr != nil {
				// Log cleanup error but don't fail
				fmt.Fprintf(os.Stderr, "Warning: failed to cleanup schema file: %v\n", cleanupErr)
			}
		}()

		resultChan := t.exec.Run(args)

		for result := range resultChan {
			event, eventErr := t.processExecResult(result)
			if eventErr != nil {
				events <- &types.ThreadErrorEvent{
					Type:    "error",
					Message: eventErr.Error(),
				}
				return
			}
			if event == nil {
				continue
			}
			if threadStarted, ok := event.(*types.ThreadStartedEvent); ok {
				t.id = &threadStarted.ThreadId
			}
			select {
			case events <- event:
			case <-ctx.Done():
				return
			}
		}
	}()

	return events, nil
}

func (t *Thread) subscribeEvents(ctx context.Context) (chan types.ThreadEvent, error) {
	runner, ok := t.exec.(threadEventsExec)
	if !ok {
		return nil, fmt.Errorf("thread event subscription requires app-server transport")
	}
	if t.id == nil || strings.TrimSpace(*t.id) == "" {
		return nil, fmt.Errorf("thread id required")
	}

	args := t.buildExecArgs(ctx, "", nil, nil, "", types.TurnOptions{})
	events := make(chan types.ThreadEvent)

	go func() {
		defer close(events)
		resultChan := runner.SubscribeThreadEvents(args)
		for result := range resultChan {
			event, eventErr := t.processExecResult(result)
			if eventErr != nil {
				events <- &types.ThreadErrorEvent{
					Type:    "error",
					Message: eventErr.Error(),
				}
				return
			}
			if event == nil {
				continue
			}
			if threadStarted, ok := event.(*types.ThreadStartedEvent); ok {
				t.id = &threadStarted.ThreadId
			}
			select {
			case events <- event:
			case <-ctx.Done():
				return
			}
		}
	}()

	return events, nil
}

func resolveTurnContext(turnOptions types.TurnOptions) context.Context {
	if turnOptions.Context != nil {
		if ctx, ok := turnOptions.Context.(context.Context); ok {
			return ctx
		}
	}
	return context.Background()
}

func (t *Thread) buildExecArgs(
	ctx context.Context,
	prompt string,
	inputItems []types.UserInput,
	images []string,
	schemaPath string,
	turnOptions types.TurnOptions,
) CodexExecArgs {
	options := t.threadOptions
	threadID := t.id
	collaborationMode := options.CollaborationMode
	if turnOptions.CollaborationMode != nil {
		collaborationMode = turnOptions.CollaborationMode
		t.threadOptions.CollaborationMode = turnOptions.CollaborationMode
	}

	return CodexExecArgs{
		Input:                 prompt,
		InputItems:            inputItems,
		BaseUrl:               t.options.BaseUrl,
		ApiKey:                t.options.ApiKey,
		ThreadId:              threadID,
		Images:                images,
		Model:                 options.Model,
		ModelProvider:         options.ModelProvider,
		SandboxMode:           string(options.SandboxMode),
		WorkingDirectory:      options.WorkingDirectory,
		DeveloperInstructions: options.DeveloperInstructions,
		SkipGitRepoCheck:      options.SkipGitRepoCheck,
		DisableSkills:         options.DisableSkills,
		OutputSchemaFile:      schemaPath,
		FastService:           options.FastService,
		ModelReasoningEffort:  string(options.ModelReasoningEffort),
		Context:               ctx,
		NetworkAccessEnabled:  options.NetworkAccessEnabled,
		WebSearchMode:         string(options.WebSearchMode),
		WebSearchEnabled:      options.WebSearchEnabled,
		ApprovalPolicy:        string(options.ApprovalPolicy),
		ApprovalHandler:       options.ApprovalHandler,
		AskUserHandler:        options.AskUserHandler,
		AdditionalDirectories: options.AdditionalDirectories,
		CollaborationMode:     collaborationMode,
	}
}

func (t *Thread) processExecResult(result ExecResult) (types.ThreadEvent, error) {
	if result.Error != nil {
		return nil, result.Error
	}
	return parseThreadEvent(result.Line)
}

func parseThreadEvent(line string) (types.ThreadEvent, error) {
	eventType, err := extractEventType(line)
	if err != nil {
		return nil, err
	}
	normalizedType := strings.ReplaceAll(eventType, "/", ".")
	if normalizedType == "error" && !hasThreadErrorMessage(line) {
		return &types.RawEvent{
			Type: eventType,
			Raw:  json.RawMessage(line),
		}, nil
	}
	if factory, ok := threadEventFactory(normalizedType); ok {
		event := factory()
		if unmarshalErr := json.Unmarshal([]byte(line), event); unmarshalErr != nil {
			return nil, fmt.Errorf("failed to unmarshal %s: %w", normalizedType, unmarshalErr)
		}
		return event, nil
	}
	return &types.RawEvent{
		Type: eventType,
		Raw:  json.RawMessage(line),
	}, nil
}

func hasThreadErrorMessage(line string) bool {
	var payload struct {
		Message string `json:"message"`
		Error   *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal([]byte(line), &payload); err != nil {
		return false
	}
	if strings.TrimSpace(payload.Message) != "" {
		return true
	}
	return payload.Error != nil && strings.TrimSpace(payload.Error.Message) != ""
}

func extractEventType(line string) (string, error) {
	var meta struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal([]byte(line), &meta); err != nil {
		return "", fmt.Errorf("failed to parse event: %w", err)
	}
	if meta.Type == "" {
		return "", fmt.Errorf("event missing type field: %s", line)
	}
	return meta.Type, nil
}

func threadEventFactory(eventType string) (func() types.ThreadEvent, bool) {
	factories := map[string]func() types.ThreadEvent{
		"thread.started":    func() types.ThreadEvent { return &types.ThreadStartedEvent{} },
		"turn.started":      func() types.ThreadEvent { return &types.TurnStartedEvent{} },
		"turn.completed":    func() types.ThreadEvent { return &types.TurnCompletedEvent{} },
		"turn.failed":       func() types.ThreadEvent { return &types.TurnFailedEvent{} },
		"turn.diff.updated": func() types.ThreadEvent { return &types.TurnDiffUpdatedEvent{} },
		"thread.goal.updated": func() types.ThreadEvent {
			return &types.ThreadGoalUpdatedEvent{}
		},
		"thread.goal.cleared": func() types.ThreadEvent {
			return &types.ThreadGoalClearedEvent{}
		},
		"item.started":   func() types.ThreadEvent { return &types.ItemStartedEvent{} },
		"item.updated":   func() types.ThreadEvent { return &types.ItemUpdatedEvent{} },
		"item.completed": func() types.ThreadEvent { return &types.ItemCompletedEvent{} },
		"error":          func() types.ThreadEvent { return &types.ThreadErrorEvent{} },
	}
	factory, ok := factories[eventType]
	return factory, ok
}

// Run provides input to the agent and returns the completed turn.
func (t *Thread) Run(input types.Input, turnOptions types.TurnOptions) (*types.Turn, error) {
	streamed, err := t.RunStreamed(input, turnOptions)
	if err != nil {
		return nil, err
	}

	var items []types.ThreadItem
	var finalResponse string
	var usage *types.Usage
	var turnFailure error

	for event := range streamed.Events {
		switch e := event.(type) {
		case *types.ItemCompletedEvent:
			// Check if this is an agent message to get the final response
			if agentMsg, ok := e.Item.(*types.AgentMessageItem); ok {
				finalResponse = agentMsg.Text
			}
			items = append(items, e.Item)
		case *types.TurnCompletedEvent:
			usage = &e.Usage
		case *types.TurnFailedEvent:
			turnFailure = fmt.Errorf("turn failed: %s", e.Error.Message)
		case *types.ThreadErrorEvent:
			turnFailure = fmt.Errorf("thread error: %s", e.Message)
		}

		if turnFailure != nil {
			break
		}
	}

	if turnFailure != nil {
		return nil, turnFailure
	}

	return &types.Turn{
		Items:         items,
		FinalResponse: finalResponse,
		Usage:         usage,
	}, nil
}

func (t *Thread) runSlashStreamed(
	cmd *slashCommand,
	turnOptions types.TurnOptions,
) (*types.StreamedTurn, error) {
	switch cmd.name {
	case "init":
		initTarget, ok := t.initTargetPath()
		if ok {
			if _, err := os.Stat(initTarget); err == nil {
				return t.syntheticMessageStream(
					resolveTurnContext(turnOptions),
					"AGENTS.md already exists here. Skipping /init to avoid overwriting it.",
				), nil
			}
		}
		return t.runStandardPromptStreamed(strings.TrimSpace(initCommandPrompt), turnOptions)
	case "review", "review-branch", "review-commit":
		return t.runReviewCommandStreamed(cmd, turnOptions)
	case "status":
		return t.runStatusCommandStreamed(turnOptions)
	case "compact":
		return t.runCompactCommandStreamed(turnOptions)
	case "goal":
		return t.runGoalCommandStreamed(cmd, turnOptions)
	case "shell":
		return t.runShellCommandStreamed(cmd, turnOptions)
	default:
		return t.runStandardPromptStreamed("/"+cmd.name, turnOptions)
	}
}

func (t *Thread) initTargetPath() (string, bool) {
	workingDir := strings.TrimSpace(t.threadOptions.WorkingDirectory)
	if workingDir == "" {
		return "", false
	}
	return filepath.Join(workingDir, "AGENTS.md"), true
}

func (t *Thread) runStandardPromptStreamed(
	prompt string,
	turnOptions types.TurnOptions,
) (*types.StreamedTurn, error) {
	events, err := t.runStreamedInternal(prompt, turnOptions)
	if err != nil {
		return nil, err
	}
	return &types.StreamedTurn{Events: events}, nil
}

func (t *Thread) runReviewCommandStreamed(
	cmd *slashCommand,
	turnOptions types.TurnOptions,
) (*types.StreamedTurn, error) {
	reviewer, ok := t.exec.(reviewExec)
	if !ok {
		return nil, fmt.Errorf("/%s requires app-server transport", cmd.name)
	}

	target, err := buildReviewTarget(cmd)
	if err != nil {
		return nil, err
	}

	ctx := resolveTurnContext(turnOptions)
	args := t.buildExecArgs(ctx, "", nil, nil, "", types.TurnOptions{})
	events := make(chan types.ThreadEvent)

	go func() {
		defer close(events)
		resultChan := reviewer.RunReview(args, types.ReviewStartParams{
			Target: target,
		})
		for result := range resultChan {
			event, eventErr := t.processExecResult(result)
			if eventErr != nil {
				events <- &types.ThreadErrorEvent{
					Type:    "error",
					Message: eventErr.Error(),
				}
				return
			}
			if event == nil {
				continue
			}
			if threadStarted, ok := event.(*types.ThreadStartedEvent); ok {
				t.id = &threadStarted.ThreadId
			}
			select {
			case events <- event:
			case <-ctx.Done():
				return
			}
		}
	}()

	return &types.StreamedTurn{Events: events}, nil
}

func (t *Thread) runShellCommandStreamed(
	cmd *slashCommand,
	turnOptions types.TurnOptions,
) (*types.StreamedTurn, error) {
	command := strings.TrimSpace(cmd.args)
	if command == "" {
		return nil, fmt.Errorf("/shell requires a command")
	}

	runner, ok := t.exec.(shellCommandExec)
	if !ok {
		return nil, fmt.Errorf("/shell requires app-server transport")
	}

	ctx := resolveTurnContext(turnOptions)
	args := t.buildExecArgs(ctx, "", nil, nil, "", types.TurnOptions{})
	events := make(chan types.ThreadEvent)

	go func() {
		defer close(events)
		resultChan := runner.RunShellCommand(args, command)
		for result := range resultChan {
			event, eventErr := t.processExecResult(result)
			if eventErr != nil {
				events <- &types.ThreadErrorEvent{
					Type:    "error",
					Message: eventErr.Error(),
				}
				return
			}
			if event == nil {
				continue
			}
			if threadStarted, ok := event.(*types.ThreadStartedEvent); ok {
				t.id = &threadStarted.ThreadId
			}
			select {
			case events <- event:
			case <-ctx.Done():
				return
			}
		}
	}()

	return &types.StreamedTurn{Events: events}, nil
}

func (t *Thread) runStatusCommandStreamed(
	turnOptions types.TurnOptions,
) (*types.StreamedTurn, error) {
	ctx := resolveTurnContext(turnOptions)

	var accountResp types.GetAccountResponse
	if err := t.appServerRPCTyped(ctx, "account/read", types.GetAccountParams{
		RefreshToken: false,
	}, &accountResp); err != nil {
		return nil, err
	}

	var limitsResp types.GetAccountRateLimitsResponse
	if err := t.appServerRPCTyped(ctx, "account/rateLimits/read", nil, &limitsResp); err != nil {
		return nil, err
	}

	message := formatStatusMessage(&accountResp, &limitsResp)
	return t.syntheticMessageStream(ctx, message), nil
}

func (t *Thread) runCompactCommandStreamed(
	turnOptions types.TurnOptions,
) (*types.StreamedTurn, error) {
	runner, ok := t.exec.(compactExec)
	if ok {
		ctx := resolveTurnContext(turnOptions)
		args := t.buildExecArgs(ctx, "", nil, nil, "", types.TurnOptions{})
		events := make(chan types.ThreadEvent)

		go func() {
			defer close(events)
			resultChan := runner.RunCompact(args)
			for result := range resultChan {
				event, eventErr := t.processExecResult(result)
				if eventErr != nil {
					events <- &types.ThreadErrorEvent{
						Type:    "error",
						Message: eventErr.Error(),
					}
					return
				}
				if event == nil {
					continue
				}
				if threadStarted, ok := event.(*types.ThreadStartedEvent); ok {
					t.id = &threadStarted.ThreadId
				}
				select {
				case events <- event:
				case <-ctx.Done():
					return
				}
			}
		}()

		return &types.StreamedTurn{Events: events}, nil
	}

	ctx := resolveTurnContext(turnOptions)
	threadID, err := t.ensureAppServerThread(ctx)
	if err != nil {
		return nil, err
	}

	if err := t.appServerRPCTyped(ctx, "thread/compact/start", map[string]interface{}{
		"threadId": threadID,
	}, nil); err != nil {
		return nil, err
	}

	return t.syntheticMessageStream(ctx, "Started context compaction for this thread."), nil
}

func (t *Thread) runGoalCommandStreamed(
	cmd *slashCommand,
	turnOptions types.TurnOptions,
) (*types.StreamedTurn, error) {
	ctx := resolveTurnContext(turnOptions)
	args := strings.TrimSpace(cmd.args)
	if args == "" {
		threadID, err := t.ensureAppServerThread(ctx)
		if err != nil {
			return nil, err
		}
		var response types.ThreadGoalGetResponse
		if err := t.appServerRPCTyped(ctx, "thread/goal/get", types.ThreadGoalGetParams{
			ThreadID: threadID,
		}, &response); err != nil {
			return nil, err
		}
		return t.syntheticMessageStream(ctx, formatGoalMessage(response.Goal)), nil
	}

	switch strings.ToLower(args) {
	case "clear":
		threadID, err := t.ensureAppServerThread(ctx)
		if err != nil {
			return nil, err
		}
		var response types.ThreadGoalClearResponse
		if err := t.appServerRPCTyped(ctx, "thread/goal/clear", types.ThreadGoalClearParams{
			ThreadID: threadID,
		}, &response); err != nil {
			return nil, err
		}
		if response.Cleared {
			return t.syntheticMessageStream(ctx, "Cleared the active goal."), nil
		}
		return t.syntheticMessageStream(ctx, "No active goal to clear."), nil
	case "pause":
		threadID, err := t.ensureAppServerThread(ctx)
		if err != nil {
			return nil, err
		}
		status := types.ThreadGoalStatusPaused
		return t.setGoalStatusStreamed(ctx, threadID, status)
	case "resume":
		status := types.ThreadGoalStatusActive
		return t.setActiveGoalStreamed(ctx, types.ThreadGoalSetParams{Status: &status})
	case "edit":
		return t.syntheticMessageStream(ctx, "Use /goal <objective> to replace the current goal."), nil
	default:
		objective := args
		status := types.ThreadGoalStatusActive
		return t.setActiveGoalStreamed(ctx, types.ThreadGoalSetParams{
			Objective: &objective,
			Status:    &status,
		})
	}
}

func (t *Thread) setActiveGoalStreamed(
	ctx context.Context,
	params types.ThreadGoalSetParams,
) (*types.StreamedTurn, error) {
	if runner, ok := t.exec.(goalSetExec); ok {
		args := t.buildExecArgs(ctx, "", nil, nil, "", types.TurnOptions{})
		events := make(chan types.ThreadEvent)

		go func() {
			defer close(events)
			resultChan := runner.RunGoalSet(args, params)
			for result := range resultChan {
				event, eventErr := t.processExecResult(result)
				if eventErr != nil {
					events <- &types.ThreadErrorEvent{
						Type:    "error",
						Message: eventErr.Error(),
					}
					return
				}
				if event == nil {
					continue
				}
				if threadStarted, ok := event.(*types.ThreadStartedEvent); ok {
					t.id = &threadStarted.ThreadId
				}
				select {
				case events <- event:
				case <-ctx.Done():
					return
				}
			}
		}()

		return &types.StreamedTurn{Events: events}, nil
	}

	threadID, err := t.ensureAppServerThread(ctx)
	if err != nil {
		return nil, err
	}
	params.ThreadID = threadID
	var response types.ThreadGoalSetResponse
	if err := t.appServerRPCTyped(ctx, "thread/goal/set", params, &response); err != nil {
		return nil, err
	}
	return t.syntheticMessageStream(ctx, formatGoalUpdatedMessage(&response.Goal)), nil
}

func (t *Thread) setGoalStatusStreamed(
	ctx context.Context,
	threadID string,
	status types.ThreadGoalStatus,
) (*types.StreamedTurn, error) {
	var response types.ThreadGoalSetResponse
	if err := t.appServerRPCTyped(ctx, "thread/goal/set", types.ThreadGoalSetParams{
		ThreadID: threadID,
		Status:   &status,
	}, &response); err != nil {
		return nil, err
	}
	return t.syntheticMessageStream(ctx, formatGoalUpdatedMessage(&response.Goal)), nil
}

func (t *Thread) appServerRPCTyped(
	ctx context.Context,
	method string,
	params interface{},
	out interface{},
) error {
	if exec, ok := t.exec.(appServerRPCExec); ok {
		result, err := exec.RPCCall(ctx, method, params)
		if err != nil {
			return err
		}
		if out == nil {
			return nil
		}
		return json.Unmarshal(result, out)
	}
	return fmt.Errorf("%s requires app-server transport", method)
}

func (t *Thread) ensureAppServerThread(ctx context.Context) (string, error) {
	if t.id != nil && strings.TrimSpace(*t.id) != "" {
		return *t.id, nil
	}

	params := buildThreadStartParams(CodexExecArgs{
		Model:                 strings.TrimSpace(t.threadOptions.Model),
		ModelProvider:         strings.TrimSpace(t.threadOptions.ModelProvider),
		FastService:           t.threadOptions.FastService,
		WorkingDirectory:      strings.TrimSpace(t.threadOptions.WorkingDirectory),
		DeveloperInstructions: strings.TrimSpace(t.threadOptions.DeveloperInstructions),
		SandboxMode:           string(t.threadOptions.SandboxMode),
		ApprovalPolicy:        string(t.threadOptions.ApprovalPolicy),
	})

	var response struct {
		Thread struct {
			ID string `json:"id"`
		} `json:"thread"`
	}
	if err := t.appServerRPCTyped(ctx, "thread/start", params, &response); err != nil {
		return "", err
	}
	if response.Thread.ID == "" {
		return "", fmt.Errorf("thread/start did not return thread id")
	}
	t.id = &response.Thread.ID
	return response.Thread.ID, nil
}

func buildReviewTarget(cmd *slashCommand) (types.ReviewTarget, error) {
	switch cmd.name {
	case "review":
		if strings.TrimSpace(cmd.args) == "" {
			return types.ReviewTarget{Type: "uncommittedChanges"}, nil
		}
		return types.ReviewTarget{
			Type:         "custom",
			Instructions: strings.TrimSpace(cmd.args),
		}, nil
	case "review-branch":
		if strings.TrimSpace(cmd.args) == "" {
			return types.ReviewTarget{}, fmt.Errorf("/review-branch requires a branch name")
		}
		return types.ReviewTarget{
			Type:   "baseBranch",
			Branch: strings.TrimSpace(cmd.args),
		}, nil
	case "review-commit":
		if strings.TrimSpace(cmd.args) == "" {
			return types.ReviewTarget{}, fmt.Errorf("/review-commit requires a commit sha")
		}
		return types.ReviewTarget{
			Type: "commit",
			SHA:  strings.TrimSpace(cmd.args),
		}, nil
	default:
		return types.ReviewTarget{}, fmt.Errorf("unsupported review command: /%s", cmd.name)
	}
}

func (t *Thread) syntheticMessageStream(ctx context.Context, message string) *types.StreamedTurn {
	events := make(chan types.ThreadEvent)
	go func() {
		defer close(events)
		itemID := fmt.Sprintf("msg-synth-%d", atomic.AddUint64(&syntheticTurnCounter, 1))

		started := &types.TurnStartedEvent{Type: "turn.started"}
		itemStarted := &types.ItemStartedEvent{
			Type: "item.started",
			Item: &types.AgentMessageItem{ID: itemID, Type: "agentMessage", Text: ""},
		}
		itemUpdated := &types.ItemUpdatedEvent{
			Type: "item.updated",
			Item: &types.AgentMessageItem{ID: itemID, Type: "agentMessage", Text: message},
		}
		itemCompleted := &types.ItemCompletedEvent{
			Type: "item.completed",
			Item: &types.AgentMessageItem{ID: itemID, Type: "agentMessage", Text: message},
		}
		turnCompleted := &types.TurnCompletedEvent{
			Type:  "turn.completed",
			Usage: types.Usage{},
		}

		for _, event := range []types.ThreadEvent{started, itemStarted, itemUpdated, itemCompleted, turnCompleted} {
			select {
			case events <- event:
			case <-ctx.Done():
				return
			}
		}
	}()
	return &types.StreamedTurn{Events: events}
}

func formatStatusMessage(
	accountResp *types.GetAccountResponse,
	limitsResp *types.GetAccountRateLimitsResponse,
) string {
	var parts []string

	if accountResp == nil || accountResp.Account == nil {
		parts = append(parts, "Account: not logged in")
	} else {
		account := accountResp.Account
		accountLine := "Account: " + account.Type
		if account.Email != "" {
			accountLine += " (" + account.Email + ")"
		}
		if account.PlanType != "" {
			accountLine += " [" + string(account.PlanType) + "]"
		}
		parts = append(parts, accountLine)
	}

	if accountResp != nil {
		parts = append(parts, fmt.Sprintf("Requires OpenAI auth: %t", accountResp.RequiresOpenAIAuth))
	}

	if limitsResp == nil {
		return strings.Join(parts, "\n")
	}

	rateLimitLines := selectStatusRateLimitLines(limitsResp)
	if len(rateLimitLines) == 0 {
		return strings.Join(parts, "\n")
	}
	parts = append(parts, "", "Rate limits:")
	parts = append(parts, rateLimitLines...)

	return strings.Join(parts, "\n")
}

func formatGoalMessage(goal *types.ThreadGoal) string {
	if goal == nil {
		return "No active goal."
	}
	return formatGoalUpdatedMessage(goal)
}

func formatGoalUpdatedMessage(goal *types.ThreadGoal) string {
	if goal == nil {
		return "Goal updated."
	}
	var parts []string
	parts = append(parts, fmt.Sprintf("Goal: %s", goal.Objective))
	parts = append(parts, fmt.Sprintf("Status: %s", goal.Status))
	if goal.TokenBudget != nil && *goal.TokenBudget > 0 {
		parts = append(parts, fmt.Sprintf("Tokens: %d / %d", goal.TokensUsed, *goal.TokenBudget))
	} else if goal.TokensUsed > 0 {
		parts = append(parts, fmt.Sprintf("Tokens used: %d", goal.TokensUsed))
	}
	if goal.TimeUsedSeconds > 0 {
		parts = append(parts, fmt.Sprintf("Elapsed: %s", formatGoalElapsed(goal.TimeUsedSeconds)))
	}
	return strings.Join(parts, "\n")
}

func formatGoalElapsed(seconds int64) string {
	if seconds <= 0 {
		return "0s"
	}
	duration := time.Duration(seconds) * time.Second
	days := duration / (24 * time.Hour)
	duration %= 24 * time.Hour
	hours := duration / time.Hour
	duration %= time.Hour
	minutes := duration / time.Minute
	duration %= time.Minute
	secs := duration / time.Second

	var parts []string
	if days > 0 {
		parts = append(parts, fmt.Sprintf("%dd", days))
	}
	if hours > 0 {
		parts = append(parts, fmt.Sprintf("%dh", hours))
	}
	if minutes > 0 {
		parts = append(parts, fmt.Sprintf("%dm", minutes))
	}
	if secs > 0 && len(parts) == 0 {
		parts = append(parts, fmt.Sprintf("%ds", secs))
	}
	return strings.Join(parts, " ")
}

func selectStatusRateLimitLines(limitsResp *types.GetAccountRateLimitsResponse) []string {
	if limitsResp == nil {
		return nil
	}
	if snapshot, ok := limitsResp.RateLimitsByLimitID["codex"]; ok {
		return formatRateLimitSnapshot(limitBucketLabel(snapshot, "codex"), snapshot)
	}
	return formatRateLimitSnapshot(limitBucketLabel(limitsResp.RateLimits, "default"), limitsResp.RateLimits)
}

func formatRateLimitSnapshot(bucketLabel string, snapshot types.RateLimitSnapshot) []string {
	var lines []string
	showBucketLabel := bucketLabel != "" && !strings.EqualFold(bucketLabel, "codex")

	if showBucketLabel {
		lines = append(lines, fmt.Sprintf("- %s limit", bucketLabel))
	}

	if snapshot.Primary != nil {
		lines = append(lines, formatRateLimitWindow(bucketLabel, snapshot.Primary, "5h", showBucketLabel))
	}
	if snapshot.Secondary != nil {
		lines = append(lines, formatRateLimitWindow(bucketLabel, snapshot.Secondary, "weekly", showBucketLabel))
	}
	if snapshot.Credits != nil {
		if creditLine := formatCreditsLine(snapshot.Credits, showBucketLabel); creditLine != "" {
			lines = append(lines, creditLine)
		}
	}

	if len(lines) == 0 {
		if showBucketLabel {
			return []string{fmt.Sprintf("- %s limit", bucketLabel)}
		}
		return []string{"- codex limit"}
	}

	return lines
}

func limitBucketLabel(snapshot types.RateLimitSnapshot, fallback string) string {
	if snapshot.LimitName != nil && strings.TrimSpace(*snapshot.LimitName) != "" {
		return strings.TrimSpace(*snapshot.LimitName)
	}
	if snapshot.LimitID != nil && strings.TrimSpace(*snapshot.LimitID) != "" {
		return strings.TrimSpace(*snapshot.LimitID)
	}
	return fallback
}

func formatRateLimitWindow(
	bucketLabel string,
	window *types.RateLimitWindow,
	fallbackLabel string,
	showBucketLabel bool,
) string {
	label := fallbackLabel
	if window.WindowDurationMins != nil {
		label = getLimitsDuration(*window.WindowDurationMins)
	}
	label = strings.Title(label) + " limit"

	if showBucketLabel && label != "Weekly limit" && label != "Monthly limit" && label != "Annual limit" {
		label = bucketLabel + " " + label
	}

	percentLeft := int((100.0 - float64(window.UsedPercent)))
	if percentLeft < 0 {
		percentLeft = 0
	}
	if percentLeft > 100 {
		percentLeft = 100
	}

	line := fmt.Sprintf("  %s: %d%% left", label, percentLeft)
	if window.ResetsAt != nil {
		line += fmt.Sprintf(" (resets at %s)", formatResetTime(*window.ResetsAt))
	}
	return line
}

func formatResetTime(unixSeconds int64) string {
	return time.Unix(unixSeconds, 0).Local().Format("2006-01-02 15:04")
}

func formatCreditsLine(credits *types.CreditsSnapshot, showBucketLabel bool) string {
	label := "Credits"
	if showBucketLabel {
		label = "  " + label
	}
	switch {
	case credits.Unlimited:
		return label + ": Unlimited"
	case credits.Balance != nil && strings.TrimSpace(*credits.Balance) != "":
		return label + ": " + strings.TrimSpace(*credits.Balance)
	case credits.HasCredits:
		return label + ": Available"
	default:
		return ""
	}
}

func getLimitsDuration(windowMinutes int64) string {
	const minutesPerHour = int64(60)
	const minutesPerDay = int64(24) * minutesPerHour
	const minutesPerWeek = int64(7) * minutesPerDay
	const minutesPerMonth = int64(30) * minutesPerDay
	const roundingBiasMinutes = int64(3)

	windowMinutes = maxInt64(windowMinutes, 0)

	switch {
	case windowMinutes <= minutesPerDay+roundingBiasMinutes:
		adjusted := windowMinutes + roundingBiasMinutes
		hours := maxInt64(1, adjusted/minutesPerHour)
		return fmt.Sprintf("%dh", hours)
	case windowMinutes <= minutesPerWeek+roundingBiasMinutes:
		return "weekly"
	case windowMinutes <= minutesPerMonth+roundingBiasMinutes:
		return "monthly"
	default:
		return "annual"
	}
}

func maxInt64(a int64, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

// normalizeInput normalizes the input into a prompt string and image paths.
func (t *Thread) normalizeInput(input types.Input) (prompt string, images []string) {
	// Check if input is a string
	if s, ok := input.(string); ok {
		return s, []string{}
	}

	// Otherwise, assume it's a slice of UserInput
	var promptParts []string
	var imagePaths []string

	// Try to parse as []UserInput
	if inputs, ok := input.([]types.UserInput); ok {
		for _, item := range inputs {
			switch item.Type {
			case "text":
				promptParts = append(promptParts, item.Text)
			case "local_image":
				imagePaths = append(imagePaths, item.Path)
			}
		}
	}

	return strings.Join(promptParts, "\n\n"), imagePaths
}

// normalizeInputItems preserves structured input items when available.
func (t *Thread) normalizeInputItems(input types.Input) []types.UserInput {
	if s, ok := input.(string); ok {
		return []types.UserInput{types.NewTextInput(s)}
	}
	if inputs, ok := input.([]types.UserInput); ok {
		return inputs
	}
	return nil
}
