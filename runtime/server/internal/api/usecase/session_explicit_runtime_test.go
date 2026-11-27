package usecase

import (
	"testing"

	"mindfs/server/internal/session"
)

func TestResolveEffectiveRuntimeOptionsExplicitDoesNotInheritStaleSession(t *testing.T) {
	stale := &session.Session{
		Key:   "collab-explicit-1",
		Model: "broken-old-model",
		Exchanges: []session.Exchange{
			{
				Role:   "agent",
				Agent:  "codex",
				Model:  "broken-old-model",
				Mode:   "full-access",
				Effort: "xhigh",
			},
		},
	}

	// Explicit collab runtime options: empty strings mean agent defaults, never inherit stale broken values.
	model, mode, effort := resolveEffectiveRuntimeOptions("codex", stale, "", "", "", false, true)
	if model != "" || mode != "" || effort != "" {
		t.Fatalf("explicit empty options inherited stale values: model=%q mode=%q effort=%q", model, mode, effort)
	}

	// Non-explicit (normal single chat) preserves legacy inheritance behavior.
	model, mode, effort = resolveEffectiveRuntimeOptions("codex", stale, "", "", "", false, false)
	if model != "broken-old-model" || mode != "full-access" || effort != "xhigh" {
		t.Fatalf("non-explicit options = (%q, %q, %q), want inherited values", model, mode, effort)
	}

	// Explicit read-only always clears permission mode.
	model, mode, effort = resolveEffectiveRuntimeOptions("codex", stale, "gpt-5.4", "full-access", "high", true, true)
	if model != "gpt-5.4" || mode != "" || effort != "high" {
		t.Fatalf("explicit read-only options = (%q, %q, %q)", model, mode, effort)
	}
}
