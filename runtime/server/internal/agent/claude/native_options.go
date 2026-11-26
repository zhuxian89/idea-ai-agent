package claude

import (
	claudeagent "github.com/roasbeef/claude-agent-sdk-go"
	"os"
	"strings"
)

// Claude Code exits at startup when bypassPermissions (or the flag that allows switching to it)
// is used with uid 0, unless IS_SANDBOX=1 is set. Without it a root service never receives the
// initialization response and every probe and session ends in "context deadline exceeded".
func claudeEnvironment(uid int, env map[string]string) map[string]string {
	if uid != 0 {
		return env
	}
	if _, set := env["IS_SANDBOX"]; set {
		return env
	}
	withSandbox := make(map[string]string, len(env)+1)
	for key, value := range env {
		withSandbox[key] = value
	}
	withSandbox["IS_SANDBOX"] = "1"
	return withSandbox
}

func readOnlyDisallowedTools() []string {
	return []string{
		"Write",
		"Edit",
		"MultiEdit",
		"NotebookEdit",
		"Bash",
		"EnterPlanMode",
		"ExitPlanMode",
	}
}

func (s *session) nativeOptions(opts OpenOptions) []claudeagent.Option {
	permissionMode := claudeagent.PermissionMode(strings.TrimSpace(opts.Mode))
	allowBypass := true
	if opts.ReadOnly {
		permissionMode = claudeagent.PermissionModeDefault
		allowBypass = false
	} else if opts.PlanMode {
		permissionMode = claudeagent.PermissionModePlan
	}
	options := []claudeagent.Option{
		// Empty values omit SDK flags, so the local CLI chooses its own defaults.
		claudeagent.WithModel(""),
		claudeagent.WithPermissionMode(permissionMode),
		// Enable switching to the native bypass mode when explicitly selected.
		// This flag alone does not activate bypassPermissions.
		claudeagent.WithAllowDangerouslySkipPermissions(allowBypass),
		// This SDK's transport consumes SkillsConfig, not Options.SettingSources.
		claudeagent.WithSkills(claudeagent.SkillsConfig{EnableSkills: true, SettingSources: []string{"user", "project", "local"}}),
		claudeagent.WithCwd(opts.RootPath),
		claudeagent.WithEnv(claudeEnvironment(os.Geteuid(), opts.Env)),
		claudeagent.WithVerbose(true),
		claudeagent.WithIncludePartialMessages(true),
		claudeagent.WithAgentProgressSummaries(true),
		claudeagent.WithForwardSubagentText(true),
		claudeagent.WithCanUseTool(s.handleCanUseTool),
		claudeagent.WithOnElicitation(s.handleElicitation),
		claudeagent.WithOnUserDialog(s.handleUserDialog),
		claudeagent.WithSupportedDialogKinds("refusal_fallback_prompt"),
	}
	if opts.ReadOnly {
		options = append(options, claudeagent.WithDisallowedTools(readOnlyDisallowedTools()))
	}
	return options
}
