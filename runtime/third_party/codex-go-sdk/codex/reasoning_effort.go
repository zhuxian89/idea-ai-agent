package codex

import (
	"strings"
)

func normalizeReasoningEffortForModel(args CodexExecArgs) CodexExecArgs {
	args.ModelReasoningEffort = normalizeReasoningEffortValueForModel(args.Model, args.ModelReasoningEffort)
	return args
}

func normalizeReasoningEffortValueForModel(_ string, effort string) string {
	// Model capabilities belong to the installed CLI/provider. Never silently
	// substitute a different reasoning budget based on a model-name whitelist.
	return strings.TrimSpace(effort)
}
