package types

import "encoding/json"

// CommandExecutionStatus represents the status of a command execution.
type CommandExecutionStatus string

const (
	CommandExecutionStatusInProgress CommandExecutionStatus = "inProgress"
	CommandExecutionStatusCompleted  CommandExecutionStatus = "completed"
	CommandExecutionStatusFailed     CommandExecutionStatus = "failed"
	CommandExecutionStatusDeclined   CommandExecutionStatus = "declined"
)

// CommandActionType identifies the best-effort semantic action represented by
// a shell command.
type CommandActionType string

const (
	CommandActionTypeRead      CommandActionType = "read"
	CommandActionTypeListFiles CommandActionType = "listFiles"
	CommandActionTypeSearch    CommandActionType = "search"
	CommandActionTypeUnknown   CommandActionType = "unknown"
)

// CommandAction is Codex's best-effort parsing of one action in a command.
// Fields that do not apply to the action type are omitted.
type CommandAction struct {
	Type    CommandActionType `json:"type"`
	Command string            `json:"command"`
	Name    string            `json:"name,omitempty"`
	Path    *string           `json:"path,omitempty"`
	Query   *string           `json:"query,omitempty"`
}

// CommandExecutionItem represents a command executed by the agent.
type CommandExecutionItem struct {
	ID   string `json:"id"`
	Type string `json:"type"`
	// Command is the command line executed by the agent
	Command string `json:"command"`
	// CommandActions is a best-effort semantic parsing of the command.
	CommandActions []CommandAction `json:"commandActions,omitempty"`
	// AggregatedOutput is stdout and stderr captured while the command was running
	AggregatedOutput *string `json:"aggregatedOutput,omitempty"`
	// ExitCode is set when the command exits; omitted while still running
	ExitCode *int `json:"exitCode,omitempty"`
	// Source identifies who initiated the command execution.
	Source string `json:"source,omitempty"`
	// Status is the current status of the command execution
	Status CommandExecutionStatus `json:"status"`
}

// UnmarshalJSON supports both camelCase and snake_case fields from different transports.
func (i *CommandExecutionItem) UnmarshalJSON(data []byte) error {
	var payload struct {
		ID                  string                 `json:"id"`
		Type                string                 `json:"type"`
		Command             string                 `json:"command"`
		CommandActions      []CommandAction        `json:"commandActions"`
		CommandActionsAlt   []CommandAction        `json:"command_actions"`
		AggregatedOutput    *string                `json:"aggregatedOutput"`
		AggregatedOutputAlt *string                `json:"aggregated_output"`
		ExitCode            *int                   `json:"exitCode"`
		ExitCodeAlt         *int                   `json:"exit_code"`
		Source              string                 `json:"source"`
		Status              CommandExecutionStatus `json:"status"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return err
	}
	i.ID = payload.ID
	i.Type = payload.Type
	i.Command = payload.Command
	if payload.CommandActions != nil {
		i.CommandActions = payload.CommandActions
	} else {
		i.CommandActions = payload.CommandActionsAlt
	}
	if payload.AggregatedOutput != nil {
		i.AggregatedOutput = payload.AggregatedOutput
	} else {
		i.AggregatedOutput = payload.AggregatedOutputAlt
	}
	if payload.ExitCode != nil {
		i.ExitCode = payload.ExitCode
	} else {
		i.ExitCode = payload.ExitCodeAlt
	}
	i.Source = payload.Source
	i.Status = payload.Status
	return nil
}

// GetType returns the item type discriminator.
func (i CommandExecutionItem) GetType() string {
	return i.Type
}

// PatchChangeKindType indicates the type of the file change.
type PatchChangeKindType string

const (
	PatchChangeKindAdd    PatchChangeKindType = "add"
	PatchChangeKindDelete PatchChangeKindType = "delete"
	PatchChangeKindUpdate PatchChangeKindType = "update"
)

// PatchChangeKind describes the change, including update move_path when present.
type PatchChangeKind struct {
	Type     PatchChangeKindType `json:"type"`
	MovePath *string             `json:"move_path,omitempty"`
}

// UnmarshalJSON accepts both string and object representations:
// - "update"
// - {"type":"update","move_path":"new/path"}
func (k *PatchChangeKind) UnmarshalJSON(data []byte) error {
	var asString string
	if err := json.Unmarshal(data, &asString); err == nil {
		k.Type = PatchChangeKindType(asString)
		k.MovePath = nil
		return nil
	}

	var payload struct {
		Type        PatchChangeKindType `json:"type"`
		TypeAlt     PatchChangeKindType `json:"kind"`
		MovePath    *string             `json:"move_path"`
		MovePathAlt *string             `json:"movePath"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return err
	}
	if payload.Type != "" {
		k.Type = payload.Type
	} else {
		k.Type = payload.TypeAlt
	}
	if payload.MovePath != nil {
		k.MovePath = payload.MovePath
	} else {
		k.MovePath = payload.MovePathAlt
	}
	return nil
}

// FileUpdateChange represents a set of file changes by the agent.
type FileUpdateChange struct {
	Path string          `json:"path"`
	Kind PatchChangeKind `json:"kind"`
	Diff string          `json:"diff,omitempty"`
}

// PatchApplyStatus represents the status of a file change.
type PatchApplyStatus string

const (
	PatchApplyStatusInProgress PatchApplyStatus = "inProgress"
	PatchApplyStatusCompleted  PatchApplyStatus = "completed"
	PatchApplyStatusFailed     PatchApplyStatus = "failed"
	PatchApplyStatusDeclined   PatchApplyStatus = "declined"
)

// FileChangeItem represents a set of file changes by the agent.
type FileChangeItem struct {
	ID   string `json:"id"`
	Type string `json:"type"`
	// Changes are individual file changes that comprise the patch
	Changes []FileUpdateChange `json:"changes"`
	// Status indicates whether the patch ultimately succeeded or failed
	Status PatchApplyStatus `json:"status"`
	// Output contains streamed output (when available)
	Output string `json:"output,omitempty"`
}

// GetType returns the item type discriminator.
func (i FileChangeItem) GetType() string {
	return i.Type
}

// McpToolCallStatus represents the status of an MCP tool call.
type McpToolCallStatus string

const (
	McpToolCallStatusInProgress McpToolCallStatus = "inProgress"
	McpToolCallStatusCompleted  McpToolCallStatus = "completed"
	McpToolCallStatusFailed     McpToolCallStatus = "failed"
)

// McpToolCallItem represents a call to an MCP tool.
type McpToolCallItem struct {
	ID   string `json:"id"`
	Type string `json:"type"`
	// Server is the name of the MCP server handling the request
	Server string `json:"server"`
	// Tool is the tool invoked on the MCP server
	Tool string `json:"tool"`
	// Arguments forwarded to the tool invocation
	Arguments interface{} `json:"arguments"`
	// Result payload returned by the MCP server for successful calls
	Result *McpToolCallResult `json:"result,omitempty"`
	// Error message reported for failed calls
	Error *McpToolCallError `json:"error,omitempty"`
	// Status is the current status of the tool invocation
	Status McpToolCallStatus `json:"status"`
}

// McpToolCallResult contains the result payload for successful MCP tool calls.
type McpToolCallResult struct {
	Content           interface{} `json:"content"`
	StructuredContent interface{} `json:"structuredContent"`
}

// McpToolCallError contains error information for failed MCP tool calls.
type McpToolCallError struct {
	Message string `json:"message"`
}

// GetType returns the item type discriminator.
func (i McpToolCallItem) GetType() string {
	return i.Type
}

// AgentMessageItem represents a response from the agent.
type AgentMessageItem struct {
	ID   string `json:"id"`
	Type string `json:"type"`
	// Text is either natural-language text or JSON when structured output is requested
	Text string `json:"text"`
}

// GetType returns the item type discriminator.
func (i AgentMessageItem) GetType() string {
	return i.Type
}

// ReasoningItem represents the agent's reasoning summary.
type ReasoningItem struct {
	ID      string   `json:"id"`
	Type    string   `json:"type"`
	Summary []string `json:"summary"`
}

// GetType returns the item type discriminator.
func (i ReasoningItem) GetType() string {
	return i.Type
}

// WebSearchItem captures a web search request.
type WebSearchItem struct {
	ID    string `json:"id"`
	Type  string `json:"type"`
	Query string `json:"query"`
}

// GetType returns the item type discriminator.
func (i WebSearchItem) GetType() string {
	return i.Type
}

// TodoItem represents an item in the agent's to-do list.
type TodoItem struct {
	Text      string `json:"text"`
	Completed bool   `json:"completed"`
}

// TodoListItem tracks the agent's running to-do list.
type TodoListItem struct {
	ID    string     `json:"id"`
	Type  string     `json:"type"`
	Items []TodoItem `json:"items"`
}

// GetType returns the item type discriminator.
func (i TodoListItem) GetType() string {
	return i.Type
}

// ErrorItem describes a non-fatal error surfaced as an item.
type ErrorItem struct {
	ID      string `json:"id"`
	Type    string `json:"type"`
	Message string `json:"message"`
}

// GetType returns the item type discriminator.
func (i ErrorItem) GetType() string {
	return i.Type
}

// ThreadItem is the union type for all thread items.
// All item types must implement this interface.
type ThreadItem interface {
	GetType() string
}

// UserMessageItem represents a user message in the thread.
type UserMessageItem struct {
	ID   string `json:"id"`
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

// GetType returns the item type discriminator.
func (i UserMessageItem) GetType() string {
	return i.Type
}

// ImageViewItem represents an image preview item.
type ImageViewItem struct {
	ID   string `json:"id"`
	Type string `json:"type"`
	URL  string `json:"url,omitempty"`
	Path string `json:"path,omitempty"`
}

// GetType returns the item type discriminator.
func (i ImageViewItem) GetType() string {
	return i.Type
}

// EnteredReviewModeItem represents entering review mode.
type EnteredReviewModeItem struct {
	ID   string `json:"id"`
	Type string `json:"type"`
}

// GetType returns the item type discriminator.
func (i EnteredReviewModeItem) GetType() string {
	return i.Type
}

// ExitedReviewModeItem represents exiting review mode.
type ExitedReviewModeItem struct {
	ID   string `json:"id"`
	Type string `json:"type"`
}

// GetType returns the item type discriminator.
func (i ExitedReviewModeItem) GetType() string {
	return i.Type
}

// CompactedItem represents a compacted summary of the thread.
type CompactedItem struct {
	ID      string `json:"id"`
	Type    string `json:"type"`
	Summary string `json:"summary,omitempty"`
	Status  string `json:"status,omitempty"`
}

// GetType returns the item type discriminator.
func (i CompactedItem) GetType() string {
	return i.Type
}

// CollabToolCallItem represents a collaborative tool call.
type CollabToolCallItem struct {
	ID                string                      `json:"id"`
	Type              string                      `json:"type"`
	Tool              string                      `json:"tool,omitempty"`
	Status            string                      `json:"status,omitempty"`
	SenderThreadID    string                      `json:"senderThreadId,omitempty"`
	ReceiverThreadIDs []string                    `json:"receiverThreadIds,omitempty"`
	Prompt            *string                     `json:"prompt,omitempty"`
	Model             *string                     `json:"model,omitempty"`
	ReasoningEffort   *string                     `json:"reasoningEffort,omitempty"`
	AgentsStates      map[string]CollabAgentState `json:"agentsStates,omitempty"`
	Arguments         interface{}                 `json:"arguments,omitempty"`
	Result            interface{}                 `json:"result,omitempty"`
	Error             *McpToolCallError           `json:"error,omitempty"`
}

// GetType returns the item type discriminator.
func (i CollabToolCallItem) GetType() string {
	return i.Type
}

type CollabAgentState struct {
	Status  string  `json:"status"`
	Message *string `json:"message,omitempty"`
}
