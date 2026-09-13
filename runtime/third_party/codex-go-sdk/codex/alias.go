package codex

// Re-export all types from the types package.
import (
	"github.com/fanwenlin/codex-go-sdk/types"
)

// Type aliases for convenience.
type (
	// ApprovalMode represents the approval mode for actions.
	ApprovalMode = types.ApprovalMode
	// ApprovalDecision represents the decision for an approval request.
	ApprovalDecision = types.ApprovalDecision
	// TransportMode represents the backend transport.
	TransportMode = types.TransportMode
	// SandboxMode represents the sandbox access mode.
	SandboxMode = types.SandboxMode
	// ModelReasoningEffort represents the reasoning effort level for the model.
	ModelReasoningEffort = types.ModelReasoningEffort
	// WebSearchMode represents the web search mode.
	WebSearchMode = types.WebSearchMode
	// CollaborationModeKind selects the Codex collaboration mode.
	CollaborationModeKind = types.CollaborationModeKind
	// CollaborationModeSettings configures collaboration mode model behavior.
	CollaborationModeSettings = types.CollaborationModeSettings
	// CollaborationMode configures Codex collaboration mode for app-server turn/start.
	CollaborationMode = types.CollaborationMode
	// CommandExecutionStatus represents the status of a command execution.
	CommandExecutionStatus = types.CommandExecutionStatus
	// CommandActionType identifies a parsed command action.
	CommandActionType = types.CommandActionType
	// PatchChangeKind indicates the type of file change.
	PatchChangeKind = types.PatchChangeKind
	// PatchApplyStatus represents the status of a file change.
	PatchApplyStatus = types.PatchApplyStatus
	// McpToolCallStatus represents the status of an MCP tool call.
	McpToolCallStatus = types.McpToolCallStatus
	// ReasoningEffort represents reasoning effort values exposed by the model catalog.
	ReasoningEffort = types.ReasoningEffort
	// InputModality represents a supported input modality for a model.
	InputModality = types.InputModality
	// PlanType describes the account subscription tier.
	PlanType = types.PlanType
	// ReviewDelivery controls inline vs detached review execution.
	ReviewDelivery = types.ReviewDelivery
)

// Constant values for TransportMode.
const (
	TransportAppServer = types.TransportAppServer
	TransportCLI       = types.TransportCLI
)

// Constant values for CommandActionType.
const (
	CommandActionTypeRead      = types.CommandActionTypeRead
	CommandActionTypeListFiles = types.CommandActionTypeListFiles
	CommandActionTypeSearch    = types.CommandActionTypeSearch
	CommandActionTypeUnknown   = types.CommandActionTypeUnknown
)

// Constant values for ApprovalMode.
const (
	ApprovalModeNever     = types.ApprovalModeNever
	ApprovalModeOnRequest = types.ApprovalModeOnRequest
	ApprovalModeOnFailure = types.ApprovalModeOnFailure
	ApprovalModeUntrusted = types.ApprovalModeUntrusted
)

// Constant values for ApprovalDecision.
const (
	ApprovalDecisionApproved = types.ApprovalDecisionApproved
	ApprovalDecisionRejected = types.ApprovalDecisionRejected
)

// Constant values for SandboxMode.
const (
	SandboxModeReadOnly       = types.SandboxModeReadOnly
	SandboxModeWorkspaceWrite = types.SandboxModeWorkspaceWrite
	SandboxModeFullAccess     = types.SandboxModeFullAccess
)

// Constant values for ModelReasoningEffort.
const (
	ModelReasoningEffortMinimal = types.ModelReasoningEffortMinimal
	ModelReasoningEffortLow     = types.ModelReasoningEffortLow
	ModelReasoningEffortMedium  = types.ModelReasoningEffortMedium
	ModelReasoningEffortHigh    = types.ModelReasoningEffortHigh
	ModelReasoningEffortXHigh   = types.ModelReasoningEffortXHigh
	ModelReasoningEffortMax     = types.ModelReasoningEffortMax
	ModelReasoningEffortUltra   = types.ModelReasoningEffortUltra
)

// Constant values for ReasoningEffort.
const (
	ReasoningEffortNone    = types.ReasoningEffortNone
	ReasoningEffortMinimal = types.ReasoningEffortMinimal
	ReasoningEffortLow     = types.ReasoningEffortLow
	ReasoningEffortMedium  = types.ReasoningEffortMedium
	ReasoningEffortHigh    = types.ReasoningEffortHigh
	ReasoningEffortXHigh   = types.ReasoningEffortXHigh
	ReasoningEffortMax     = types.ReasoningEffortMax
	ReasoningEffortUltra   = types.ReasoningEffortUltra
)

// Constant values for InputModality.
const (
	InputModalityText  = types.InputModalityText
	InputModalityImage = types.InputModalityImage
)

// Constant values for PlanType.
const (
	PlanTypeFree       = types.PlanTypeFree
	PlanTypeGo         = types.PlanTypeGo
	PlanTypePlus       = types.PlanTypePlus
	PlanTypePro        = types.PlanTypePro
	PlanTypeTeam       = types.PlanTypeTeam
	PlanTypeBusiness   = types.PlanTypeBusiness
	PlanTypeEnterprise = types.PlanTypeEnterprise
	PlanTypeEdu        = types.PlanTypeEdu
	PlanTypeUnknown    = types.PlanTypeUnknown
)

// Constant values for ReviewDelivery.
const (
	ReviewDeliveryInline   = types.ReviewDeliveryInline
	ReviewDeliveryDetached = types.ReviewDeliveryDetached
)

// Constant values for WebSearchMode.
const (
	WebSearchModeDisabled = types.WebSearchModeDisabled
	WebSearchModeCached   = types.WebSearchModeCached
	WebSearchModeLive     = types.WebSearchModeLive
)

// Constant values for CollaborationModeKind.
const (
	CollaborationModeDefault = types.CollaborationModeDefault
	CollaborationModePlan    = types.CollaborationModePlan
)

// NewCollaborationMode creates a collaboration mode value.
func NewCollaborationMode(mode CollaborationModeKind) *CollaborationMode {
	return types.NewCollaborationMode(mode)
}

// Constant values for CommandExecutionStatus.
const (
	CommandExecutionStatusInProgress = types.CommandExecutionStatusInProgress
	CommandExecutionStatusCompleted  = types.CommandExecutionStatusCompleted
	CommandExecutionStatusFailed     = types.CommandExecutionStatusFailed
	CommandExecutionStatusDeclined   = types.CommandExecutionStatusDeclined
)

// Re-export event types.
type (
	ThreadEvent          = types.ThreadEvent
	ThreadStartedEvent   = types.ThreadStartedEvent
	TurnStartedEvent     = types.TurnStartedEvent
	Usage                = types.Usage
	TurnCompletedEvent   = types.TurnCompletedEvent
	TurnDiffUpdatedEvent = types.TurnDiffUpdatedEvent
	ThreadError          = types.ThreadError
	TurnFailedEvent      = types.TurnFailedEvent
	ItemStartedEvent     = types.ItemStartedEvent
	ItemUpdatedEvent     = types.ItemUpdatedEvent
	ItemCompletedEvent   = types.ItemCompletedEvent
	ThreadErrorEvent     = types.ThreadErrorEvent
	RawEvent             = types.RawEvent
)

// Re-export item types.
type (
	ThreadItem            = types.ThreadItem
	CommandAction         = types.CommandAction
	CommandExecutionItem  = types.CommandExecutionItem
	FileUpdateChange      = types.FileUpdateChange
	FileChangeItem        = types.FileChangeItem
	McpToolCallItem       = types.McpToolCallItem
	McpToolCallResult     = types.McpToolCallResult
	McpToolCallError      = types.McpToolCallError
	AgentMessageItem      = types.AgentMessageItem
	ReasoningItem         = types.ReasoningItem
	WebSearchItem         = types.WebSearchItem
	TodoItem              = types.TodoItem
	TodoListItem          = types.TodoListItem
	ErrorItem             = types.ErrorItem
	UserMessageItem       = types.UserMessageItem
	ImageViewItem         = types.ImageViewItem
	EnteredReviewModeItem = types.EnteredReviewModeItem
	ExitedReviewModeItem  = types.ExitedReviewModeItem
	CompactedItem         = types.CompactedItem
	CollabToolCallItem    = types.CollabToolCallItem
	Model                 = types.Model
	ModelUpgradeInfo      = types.ModelUpgradeInfo
	ModelAvailabilityNux  = types.ModelAvailabilityNux
	ReasoningEffortOption = types.ReasoningEffortOption
)

// Re-export option types.
//
//nolint:revive // Keep name for public API compatibility and alignment with the TypeScript SDK.
type CodexOptions = types.CodexOptions

type (
	// ClientInfo identifies the SDK client sending requests.
	ClientInfo = types.ClientInfo
	// ThreadOptions configures thread creation and resume behavior.
	ThreadOptions = types.ThreadOptions
	// ThreadForkOptions configures thread fork behavior.
	ThreadForkOptions = types.ThreadForkOptions
	// TurnOptions configures turn execution behavior.
	TurnOptions = types.TurnOptions
	// ApprovalRequest carries a pending approval request payload.
	ApprovalRequest = types.ApprovalRequest
	// ApprovalHandler handles approval requests from the app server.
	ApprovalHandler = types.ApprovalHandler
	// AskUserQuestionOption is one selectable option for request_user_input.
	AskUserQuestionOption = types.AskUserQuestionOption
	// AskUserQuestion describes one request_user_input question.
	AskUserQuestion = types.AskUserQuestion
	// AskUserRequest carries a pending request_user_input request.
	AskUserRequest = types.AskUserRequest
	// AskUserAnswer is the answer for one request_user_input question.
	AskUserAnswer = types.AskUserAnswer
	// AskUserResponse resolves a request_user_input request.
	AskUserResponse = types.AskUserResponse
	// AskUserHandler handles request_user_input requests from the app server.
	AskUserHandler = types.AskUserHandler
	// ModelListParams configures model catalog queries.
	ModelListParams = types.ModelListParams
	// ModelListResponse contains paginated model catalog results.
	ModelListResponse = types.ModelListResponse
	// ConfigReadParams configures config/read.
	ConfigReadParams = types.ConfigReadParams
	// EffectiveConfig is the current effective app-server config snapshot.
	EffectiveConfig = types.EffectiveConfig
	// ConfigReadResponse contains the app-server config/read response.
	ConfigReadResponse = types.ConfigReadResponse
	// GetAccountParams configures account/read.
	GetAccountParams = types.GetAccountParams
	// GetAccountResponse contains the account/read response.
	GetAccountResponse = types.GetAccountResponse
	// LoginEvent reports progress for a login flow.
	LoginEvent = types.LoginEvent
	// LoginAccountDeviceCodeResponse is returned by ChatGPT device code login start.
	LoginAccountDeviceCodeResponse = types.LoginAccountDeviceCodeResponse
	// AccountLoginCompletedNotification is emitted when a login attempt finishes.
	AccountLoginCompletedNotification = types.AccountLoginCompletedNotification
	// AccountUpdatedNotification is emitted when the active account changes.
	AccountUpdatedNotification = types.AccountUpdatedNotification
	// GetAccountRateLimitsResponse contains the account/rateLimits/read response.
	GetAccountRateLimitsResponse = types.GetAccountRateLimitsResponse
	// Account represents the active authentication state.
	Account = types.Account
	// RateLimitWindow represents one rate-limit window.
	RateLimitWindow = types.RateLimitWindow
	// CreditsSnapshot contains credit information.
	CreditsSnapshot = types.CreditsSnapshot
	// RateLimitSnapshot mirrors the app-server rate limit payload.
	RateLimitSnapshot = types.RateLimitSnapshot
	// ReviewTarget describes what a review should inspect.
	ReviewTarget = types.ReviewTarget
	// ReviewStartParams configures review/start.
	ReviewStartParams = types.ReviewStartParams
	// ReviewStartResponse contains the immediate review/start response.
	ReviewStartResponse = types.ReviewStartResponse
	// SlashCommandInfo describes one supported slash command.
	SlashCommandInfo = types.SlashCommandInfo
	// ThreadGoalStatus is the lifecycle status for a Codex thread goal.
	ThreadGoalStatus = types.ThreadGoalStatus
	// ThreadGoal describes the active goal persisted for a Codex thread.
	ThreadGoal = types.ThreadGoal
	// ThreadGoalSetParams configures thread/goal/set.
	ThreadGoalSetParams = types.ThreadGoalSetParams
	// ThreadGoalSetResponse contains the updated goal.
	ThreadGoalSetResponse = types.ThreadGoalSetResponse
	// ThreadGoalGetParams configures thread/goal/get.
	ThreadGoalGetParams = types.ThreadGoalGetParams
	// ThreadGoalGetResponse contains the current goal, when present.
	ThreadGoalGetResponse = types.ThreadGoalGetResponse
	// ThreadGoalClearParams configures thread/goal/clear.
	ThreadGoalClearParams = types.ThreadGoalClearParams
	// ThreadGoalClearResponse reports whether a goal was cleared.
	ThreadGoalClearResponse = types.ThreadGoalClearResponse
	// ThreadGoalUpdatedEvent is emitted when the thread goal changes.
	ThreadGoalUpdatedEvent = types.ThreadGoalUpdatedEvent
	// ThreadGoalClearedEvent is emitted when the thread goal is cleared.
	ThreadGoalClearedEvent = types.ThreadGoalClearedEvent
	// ThreadShellCommandParams configures thread/shellCommand.
	ThreadShellCommandParams = types.ThreadShellCommandParams
	// ThreadShellCommandResponse is the empty success response for thread/shellCommand.
	ThreadShellCommandResponse = types.ThreadShellCommandResponse
)

const (
	ThreadGoalStatusActive        = types.ThreadGoalStatusActive
	ThreadGoalStatusPaused        = types.ThreadGoalStatusPaused
	ThreadGoalStatusBlocked       = types.ThreadGoalStatusBlocked
	ThreadGoalStatusUsageLimited  = types.ThreadGoalStatusUsageLimited
	ThreadGoalStatusBudgetLimited = types.ThreadGoalStatusBudgetLimited
	ThreadGoalStatusComplete      = types.ThreadGoalStatusComplete
)

// Re-export alias types.
type (
	UserInput         = types.UserInput
	Input             = types.Input
	Turn              = types.Turn
	StreamedTurn      = types.StreamedTurn
	RunResult         = types.Turn
	RunStreamedResult = types.StreamedTurn
)

// Helper functions for creating inputs.
//
//nolint:gochecknoglobals // These are intentional function aliases for convenience
var (
	NewTextInput     = types.NewTextInput
	NewImageInput    = types.NewImageInput
	NewImageURLInput = types.NewImageURLInput
	NewSkillInput    = types.NewSkillInput
	NewMentionInput  = types.NewMentionInput
)

// Classes and functions are already exported from other files
// No need to re-export them here as they would create circular references
