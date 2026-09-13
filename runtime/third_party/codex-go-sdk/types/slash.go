package types

// SlashCommandInfo describes one supported slash command.
type SlashCommandInfo struct {
	Name         string `json:"name"`
	Description  string `json:"description,omitempty"`
	ArgumentHint string `json:"argument_hint,omitempty"`
}
