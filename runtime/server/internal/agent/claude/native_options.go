package claude

import claudeagent "github.com/roasbeef/claude-agent-sdk-go"

func (s *session) nativeOptions(opts OpenOptions) []claudeagent.Option {
	return []claudeagent.Option{
		// Empty values omit SDK flags, so the local CLI chooses its own defaults.
		claudeagent.WithModel(""),
		claudeagent.WithPermissionMode(""),
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
