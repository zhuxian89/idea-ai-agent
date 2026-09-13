package types

// ReasoningEffort represents reasoning effort values exposed by the model catalog.
type ReasoningEffort string

const (
	ReasoningEffortNone    ReasoningEffort = "none"
	ReasoningEffortMinimal ReasoningEffort = "minimal"
	ReasoningEffortLow     ReasoningEffort = "low"
	ReasoningEffortMedium  ReasoningEffort = "medium"
	ReasoningEffortHigh    ReasoningEffort = "high"
	ReasoningEffortXHigh   ReasoningEffort = "xhigh"
	ReasoningEffortMax     ReasoningEffort = "max"
	ReasoningEffortUltra   ReasoningEffort = "ultra"
)

// InputModality is a canonical user-input modality tag advertised by a model.
type InputModality string

const (
	InputModalityText  InputModality = "text"
	InputModalityImage InputModality = "image"
)

// ReasoningEffortOption describes a supported reasoning effort for a model.
type ReasoningEffortOption struct {
	ReasoningEffort ReasoningEffort `json:"reasoningEffort"`
	Description     string          `json:"description"`
}

// ModelAvailabilityNux carries an availability hint for the model picker.
type ModelAvailabilityNux struct {
	Message string `json:"message"`
}

// ModelUpgradeInfo describes a suggested migration target for a model.
type ModelUpgradeInfo struct {
	Model             string  `json:"model"`
	UpgradeCopy       *string `json:"upgradeCopy,omitempty"`
	ModelLink         *string `json:"modelLink,omitempty"`
	MigrationMarkdown *string `json:"migrationMarkdown,omitempty"`
}

// Model describes a model returned by the Codex app server model catalog.
type Model struct {
	ID                        string                  `json:"id"`
	Model                     string                  `json:"model"`
	Upgrade                   *string                 `json:"upgrade,omitempty"`
	UpgradeInfo               *ModelUpgradeInfo       `json:"upgradeInfo,omitempty"`
	AvailabilityNux           *ModelAvailabilityNux   `json:"availabilityNux,omitempty"`
	DisplayName               string                  `json:"displayName"`
	Description               string                  `json:"description"`
	Hidden                    bool                    `json:"hidden"`
	SupportedReasoningEfforts []ReasoningEffortOption `json:"supportedReasoningEfforts,omitempty"`
	DefaultReasoningEffort    ReasoningEffort         `json:"defaultReasoningEffort"`
	InputModalities           []InputModality         `json:"inputModalities,omitempty"`
	SupportsPersonality       bool                    `json:"supportsPersonality"`
	IsDefault                 bool                    `json:"isDefault"`
}

// ModelListParams configures a model/list request to the app server.
type ModelListParams struct {
	Cursor        *string `json:"cursor,omitempty"`
	Limit         *int    `json:"limit,omitempty"`
	IncludeHidden *bool   `json:"includeHidden,omitempty"`
}

// ModelListResponse contains model catalog results from the app server.
type ModelListResponse struct {
	Data       []Model `json:"data"`
	NextCursor *string `json:"nextCursor"`
}
