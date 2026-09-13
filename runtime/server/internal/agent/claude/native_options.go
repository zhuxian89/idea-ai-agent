package claude

import (
	claudeagent "github.com/roasbeef/claude-agent-sdk-go"
	"strings"
)

func (s *session) nativeOptions(opts OpenOptions) []claudeagent.Option {
	permissionMode := claudeagent.PermissionMode(strings.TrimSpace(opts.Mode))
	if opts.PlanMode {
		permissionMode = claudeagent.PermissionModePlan
	}
	return []claudeagent.Option{
		// Empty values omit SDK flags, so the local CLI chooses its own defaults.
		claudeagent.WithModel(""),
		claudeagent.WithPermissionMode(permissionMode),
		// Enable switching to the native bypass mode when explicitly selected.
		// This flag alone does not activate bypassPermissions.
		claudeagent.WithAllowDangerouslySkipPermissions(true),
		// This SDK's transport consumes SkillsConfig, not Options.SettingSources.
		claudeagent.WithSkills(claudeagent.SkillsConfig{EnableSkills: true, SettingSources: []string{"user", "project", "local"}}),
		claudeagent.WithCwd(opts.RootPath),
		claudeagent.WithEnv(opts.Env),
		claudeagent.WithVerbose(true),
		claudeagent.WithIncludePartialMessages(true),
		claudeagent.WithAgentProgressSummaries(true),
		claudeagent.WithForwardSubagentText(true),
		claudeagent.WithCanUseTool(s.handleCanUseTool),
	}
}
