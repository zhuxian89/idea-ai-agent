package types

// ConfigReadParams configures a config/read request to the app server.
type ConfigReadParams struct {
	IncludeLayers bool   `json:"includeLayers"`
	Cwd           string `json:"cwd,omitempty"`
}

// EffectiveConfig is the current effective app-server configuration snapshot.
type EffectiveConfig struct {
	Model                *string               `json:"model"`
	ModelProvider        *string               `json:"model_provider"`
	Profile              *string               `json:"profile"`
	ModelReasoningEffort *ModelReasoningEffort `json:"model_reasoning_effort"`
	ServiceTier          *string               `json:"service_tier"`
}

// ConfigReadResponse contains the app-server config/read response.
type ConfigReadResponse struct {
	Config EffectiveConfig `json:"config"`
}
