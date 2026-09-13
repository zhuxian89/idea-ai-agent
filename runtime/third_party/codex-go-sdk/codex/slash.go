package codex

import (
	_ "embed"
	"strings"

	"github.com/fanwenlin/codex-go-sdk/types"
)

//go:embed prompt_for_init_command.md
var initCommandPrompt string

type slashCommand struct {
	name string
	args string
}

var supportedSlashCommands = []types.SlashCommandInfo{
	{
		Name:        "status",
		Description: "Show account and rate limit status.",
	},
	{
		Name:        "compact",
		Description: "Compact the current thread context.",
	},
	{
		Name:         "shell",
		Description:  "Run a shell command in the current thread.",
		ArgumentHint: "<command>",
	},
	{
		Name:         "goal",
		Description:  "Show, set, pause, resume, or clear the active thread goal.",
		ArgumentHint: "[objective|pause|resume|clear]",
	},
	{
		Name:         "review",
		Description:  "Review current changes or run a custom review.",
		ArgumentHint: "[instructions]",
	},
	{
		Name:         "review-branch",
		Description:  "Review changes against a base branch.",
		ArgumentHint: "<branch>",
	},
	{
		Name:         "review-commit",
		Description:  "Review a specific commit.",
		ArgumentHint: "<sha>",
	},
	{
		Name:        "init",
		Description: "Generate an AGENTS.md contributor guide.",
	},
}

// SupportedSlashCommands returns the slash commands implemented by this SDK.
func SupportedSlashCommands() []types.SlashCommandInfo {
	commands := make([]types.SlashCommandInfo, len(supportedSlashCommands))
	copy(commands, supportedSlashCommands)
	return commands
}

func parseSlashCommand(input types.Input) (*slashCommand, bool) {
	line, ok := slashCommandLine(input)
	if !ok {
		return nil, false
	}
	return parseSlashCommandLine(line)
}

func slashCommandLine(input types.Input) (string, bool) {
	switch v := input.(type) {
	case string:
		return v, true
	case []types.UserInput:
		if len(v) != 1 || v[0].Type != "text" {
			return "", false
		}
		return v[0].Text, true
	default:
		return "", false
	}
}

func parseSlashCommandLine(line string) (*slashCommand, bool) {
	firstLine := strings.TrimSpace(strings.Split(line, "\n")[0])
	if !strings.HasPrefix(firstLine, "/") {
		return nil, false
	}
	stripped := strings.TrimPrefix(firstLine, "/")
	if stripped == "" {
		return nil, false
	}
	name := stripped
	args := ""
	if idx := strings.IndexFunc(stripped, func(r rune) bool { return r == ' ' || r == '\t' }); idx >= 0 {
		name = stripped[:idx]
		args = strings.TrimSpace(stripped[idx:])
	}
	if name == "" {
		return nil, false
	}
	return &slashCommand{name: name, args: args}, true
}

func isSupportedSlashCommand(name string) bool {
	for _, command := range supportedSlashCommands {
		if command.Name == name {
			return true
		}
	}
	return false
}
