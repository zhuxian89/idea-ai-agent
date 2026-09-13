package codex

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/fanwenlin/codex-go-sdk/types"
)

// Exec defines the interface for executing codex commands
type Exec interface {
	Run(args CodexExecArgs) <-chan ExecResult
}

type modelListExec interface {
	ListModels(ctx context.Context, params types.ModelListParams) (*types.ModelListResponse, error)
}

type appServerRPCExec interface {
	RPCCall(ctx context.Context, method string, params interface{}) (json.RawMessage, error)
}

type closeableExec interface {
	Close() error
}

// Codex is the main class for interacting with the Codex agent.
// Use the StartThread() method to start a new thread or ResumeThread() to resume a previously started thread.
type Codex struct {
	exec    Exec
	options types.CodexOptions
}

// NewCodex creates a new Codex client.
func NewCodex(options types.CodexOptions) *Codex {
	var exec Exec
	if options.Transport == "" || options.Transport == types.TransportAppServer {
		exec = NewAppServerExec(
			options.AppServerPathOverride,
			options.AppServerArgs,
			options.Env,
			options.ClientInfo,
			options.BaseUrl,
			options.ApiKey,
		)
	} else {
		if options.CodexPathOverride != "" {
			exec = NewCodexExec(options.CodexPathOverride, options.Env)
		} else {
			// Try to find codex in PATH or parent project
			exec = NewCodexExec("", options.Env)
		}
	}
	if options.Verbose {
		switch e := exec.(type) {
		case *CodexExec:
			e.EnableVerbose(options.VerboseWriter)
		case *AppServerExec:
			e.EnableVerbose(options.VerboseWriter)
		}
	}
	return &Codex{
		exec:    exec,
		options: options,
	}
}

// NewCodexWithExec creates a new Codex client with a custom Exec implementation.
// This is intended for testing purposes.
func NewCodexWithExec(exec Exec, options types.CodexOptions) *Codex {
	if options.Verbose {
		switch e := exec.(type) {
		case *CodexExec:
			e.EnableVerbose(options.VerboseWriter)
		case *AppServerExec:
			e.EnableVerbose(options.VerboseWriter)
		}
	}
	return &Codex{
		exec:    exec,
		options: options,
	}
}

// StartThread starts a new conversation with an agent.
// Returns a new thread instance.
func (c *Codex) StartThread(options types.ThreadOptions) *Thread {
	return newThread(c.exec, c.options, options, nil)
}

// ResumeThread resumes a conversation with an agent based on the thread ID.
// Threads are persisted in ~/.codex/sessions.
//
// Parameters:
//   - id: The ID of the thread to resume
//   - options: Options for the thread
//
// Returns a new thread instance.
func (c *Codex) ResumeThread(id string, options types.ThreadOptions) *Thread {
	return newThread(c.exec, c.options, options, &id)
}

// ForkThread forks an existing app-server thread and returns the forked thread.
func (c *Codex) ForkThread(ctx context.Context, sourceThreadID string, options types.ThreadForkOptions) (*Thread, error) {
	sourceThreadID = strings.TrimSpace(sourceThreadID)
	if sourceThreadID == "" {
		return nil, errors.New("source thread id required")
	}
	params := buildThreadForkParams(sourceThreadID, options)
	var response struct {
		Thread struct {
			ID    string     `json:"id"`
			Turns []forkTurn `json:"turns"`
		} `json:"thread"`
	}
	if err := c.AppServerRPCTyped(ctx, "thread/fork", params, &response); err != nil {
		return nil, err
	}
	threadID := strings.TrimSpace(response.Thread.ID)
	if threadID == "" {
		return nil, errors.New("thread/fork did not return thread id")
	}
	if options.TruncateBeforeNthUserMessage != nil {
		rollbackTurns, err := rollbackTurnsAfterUserOrdinal(response.Thread.Turns, *options.TruncateBeforeNthUserMessage)
		if err != nil {
			return nil, err
		}
		if rollbackTurns > 0 {
			if err := c.rollbackThread(ctx, threadID, rollbackTurns); err != nil {
				return nil, err
			}
		}
	}
	return newThread(c.exec, c.options, options.ThreadOptions, &threadID), nil
}

func (c *Codex) SubscribeThreadEvents(ctx context.Context, threadID string, options types.ThreadOptions) (*types.StreamedTurn, error) {
	thread := c.ResumeThread(threadID, options)
	events, err := thread.subscribeEvents(ctx)
	if err != nil {
		return nil, err
	}
	return &types.StreamedTurn{Events: events}, nil
}

// ListModels queries the app-server model catalog.
func (c *Codex) ListModels(ctx context.Context, params types.ModelListParams) (*types.ModelListResponse, error) {
	if exec, ok := c.exec.(modelListExec); ok {
		return exec.ListModels(ctx, params)
	}
	return nil, errors.New("model list is only supported by app-server transport")
}

// ReadConfig queries the app-server effective configuration snapshot.
func (c *Codex) ReadConfig(ctx context.Context, params types.ConfigReadParams) (*types.ConfigReadResponse, error) {
	var response types.ConfigReadResponse
	if err := c.AppServerRPCTyped(ctx, "config/read", params, &response); err != nil {
		return nil, err
	}
	return &response, nil
}

// LoginChatGPTDeviceCode starts ChatGPT device-code login and streams progress until it completes.
func (c *Codex) LoginChatGPTDeviceCode(ctx context.Context) (<-chan types.LoginEvent, error) {
	exec, ok := c.exec.(interface {
		LoginChatGPTDeviceCode(context.Context) <-chan types.LoginEvent
	})
	if !ok {
		return nil, errors.New("ChatGPT device-code login is only supported by app-server transport")
	}
	return exec.LoginChatGPTDeviceCode(ctx), nil
}

// AppServerRPC executes an app-server RPC request and returns the raw result payload.
func (c *Codex) AppServerRPC(ctx context.Context, method string, params interface{}) (json.RawMessage, error) {
	if exec, ok := c.exec.(appServerRPCExec); ok {
		return exec.RPCCall(ctx, method, params)
	}
	return nil, errors.New("app-server RPC is only supported by app-server transport")
}

// AppServerRPCTyped executes an app-server RPC request and unmarshals the result into out.
func (c *Codex) AppServerRPCTyped(ctx context.Context, method string, params interface{}, out interface{}) error {
	result, err := c.AppServerRPC(ctx, method, params)
	if err != nil {
		return err
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(result, out)
}

// SupportedSlashCommands returns the slash commands implemented by this SDK.
func (c *Codex) SupportedSlashCommands() []types.SlashCommandInfo {
	return SupportedSlashCommands()
}

// Close releases resources held by the underlying transport.
func (c *Codex) Close() error {
	if exec, ok := c.exec.(closeableExec); ok {
		return exec.Close()
	}
	return nil
}

func buildThreadForkParams(sourceThreadID string, options types.ThreadForkOptions) map[string]interface{} {
	args := normalizeReasoningEffortForModel(CodexExecArgs{
		Model:                 strings.TrimSpace(options.Model),
		ModelProvider:         strings.TrimSpace(options.ModelProvider),
		FastService:           options.FastService,
		WorkingDirectory:      strings.TrimSpace(options.WorkingDirectory),
		DeveloperInstructions: strings.TrimSpace(options.DeveloperInstructions),
		SandboxMode:           string(options.SandboxMode),
		ApprovalPolicy:        string(options.ApprovalPolicy),
		ModelReasoningEffort:  string(options.ModelReasoningEffort),
	})
	params := map[string]interface{}{
		"threadId": strings.TrimSpace(sourceThreadID),
	}
	appendThreadContextParams(params, args, args.ModelProvider)
	if effort := strings.TrimSpace(args.ModelReasoningEffort); effort != "" {
		params["config"] = map[string]interface{}{"model_reasoning_effort": effort}
	}
	return params
}

type forkTurn struct {
	Items []json.RawMessage `json:"items"`
}

func rollbackTurnsAfterUserOrdinal(turns []forkTurn, ordinal int) (int, error) {
	if ordinal < 0 {
		return 0, errors.New("truncate user ordinal must be >= 0")
	}
	if len(turns) == 0 {
		return 0, errors.New("thread/fork did not return turns for truncate")
	}
	userCount := 0
	for index, turn := range turns {
		userCount += countUserMessages(turn.Items)
		if userCount > ordinal {
			return len(turns) - index, nil
		}
	}
	return 0, nil
}

func countUserMessages(items []json.RawMessage) int {
	count := 0
	for _, item := range items {
		if isUserMessageItem(item) {
			count++
		}
	}
	return count
}

func isUserMessageItem(item json.RawMessage) bool {
	var meta struct {
		Type string `json:"type"`
		Role string `json:"role"`
	}
	if err := json.Unmarshal(item, &meta); err != nil {
		return false
	}
	itemType := strings.ToLower(strings.TrimSpace(meta.Type))
	if itemType == "usermessage" || itemType == "user_message" {
		return true
	}
	return itemType == "message" && strings.EqualFold(strings.TrimSpace(meta.Role), "user")
}

func (c *Codex) rollbackThread(ctx context.Context, threadID string, numTurns int) error {
	if numTurns <= 0 {
		return nil
	}
	var response struct {
		Thread struct {
			ID string `json:"id"`
		} `json:"thread"`
	}
	return c.AppServerRPCTyped(ctx, "thread/rollback", map[string]interface{}{
		"threadId": threadID,
		"numTurns": numTurns,
	}, &response)
}
