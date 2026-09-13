package claude

import (
	"testing"

	claudeagent "github.com/roasbeef/claude-agent-sdk-go"
)

func TestCurrentModeReportsRuntimePermissionMode(t *testing.T) {
	var nilSession *session
	if got := nilSession.CurrentMode(); got != "" {
		t.Fatalf("nil session mode = %q, want empty", got)
	}

	s := &session{}
	if got := s.CurrentMode(); got != "" {
		t.Fatalf("fresh session mode = %q, want empty", got)
	}
	s.mu.Lock()
	s.permissionMode = claudeagent.PermissionModeBypassAll
	s.mu.Unlock()
	if got := s.CurrentMode(); got != string(claudeagent.PermissionModeBypassAll) {
		t.Fatalf("mode = %q, want %q", got, claudeagent.PermissionModeBypassAll)
	}

	// CLI-reported values are trimmed so usecase comparisons are stable.
	s.mu.Lock()
	s.permissionMode = claudeagent.PermissionMode(" plan ")
	s.mu.Unlock()
	if got := s.CurrentMode(); got != string(claudeagent.PermissionModePlan) {
		t.Fatalf("mode = %q, want %q", got, claudeagent.PermissionModePlan)
	}
}

func TestInitialPermissionStatePreservesSelectedBaseMode(t *testing.T) {
	planned := initialPermissionState("bypassPermissions", true)
	if !planned.planMode {
		t.Fatal("plan flag lost")
	}
	if planned.permissionMode != claudeagent.PermissionModePlan {
		t.Fatalf("plan open records runtime mode %q, want %q", planned.permissionMode, claudeagent.PermissionModePlan)
	}
	if planned.previousPermissionMode != claudeagent.PermissionModeBypassAll {
		t.Fatalf("plan open records base mode %q, want %q", planned.previousPermissionMode, claudeagent.PermissionModeBypassAll)
	}

	plain := initialPermissionState("bypassPermissions", false)
	if plain.planMode {
		t.Fatal("plain open must not set plan flag")
	}
	if plain.permissionMode != claudeagent.PermissionModeBypassAll || plain.previousPermissionMode != claudeagent.PermissionModeBypassAll {
		t.Fatalf("plain open modes = %q/%q, want bypassPermissions/bypassPermissions", plain.permissionMode, plain.previousPermissionMode)
	}

	empty := initialPermissionState("  ", false)
	if empty.planMode || empty.permissionMode != "" || empty.previousPermissionMode != "" {
		t.Fatalf("empty open state = %+v, want empty CLI-default semantics", empty)
	}
}

func TestResolveSetModeInsidePlanOnlyRecordsBaseMode(t *testing.T) {
	cases := []struct {
		name  string
		state permissionState
	}{
		{"session plan flag", permissionState{planMode: true, permissionMode: claudeagent.PermissionModePlan, previousPermissionMode: claudeagent.PermissionModeDefault}},
		{"native CLI plan", permissionState{permissionMode: claudeagent.PermissionModePlan, previousPermissionMode: claudeagent.PermissionModeAcceptEdits}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			transition := resolveSetMode(tc.state, claudeagent.PermissionModeBypassAll)
			if !transition.planning {
				t.Fatal("plan runtime not detected")
			}
			if transition.send != "" {
				t.Fatalf("plan runtime must not receive a control request, got send=%q", transition.send)
			}
			if transition.previous != claudeagent.PermissionModeBypassAll {
				t.Fatalf("base mode = %q, want bypassPermissions", transition.previous)
			}
			if transition.effective != tc.state.permissionMode {
				t.Fatalf("effective mode = %q, want runtime plan mode %q", transition.effective, tc.state.permissionMode)
			}
		})
	}
}

func TestResolveSetModeOutsidePlanAppliesAndRecords(t *testing.T) {
	state := permissionState{permissionMode: claudeagent.PermissionModeDefault, previousPermissionMode: claudeagent.PermissionModeDefault}
	transition := resolveSetMode(state, claudeagent.PermissionModeBypassAll)
	if transition.planning {
		t.Fatal("non-plan runtime reported as planning")
	}
	if transition.send != claudeagent.PermissionModeBypassAll {
		t.Fatalf("send = %q, want bypassPermissions", transition.send)
	}
	if transition.previous != claudeagent.PermissionModeBypassAll || transition.effective != claudeagent.PermissionModeBypassAll {
		t.Fatalf("recorded modes = %q/%q, want bypassPermissions/bypassPermissions", transition.previous, transition.effective)
	}
}

func TestResolveSetPlanModeEnterRecordsBaseMode(t *testing.T) {
	transition := resolveSetPlanMode(permissionState{
		permissionMode:         claudeagent.PermissionModeBypassAll,
		previousPermissionMode: claudeagent.PermissionModeBypassAll,
	}, true)
	if transition.send != claudeagent.PermissionModePlan || transition.effective != claudeagent.PermissionModePlan {
		t.Fatalf("enter plan modes = send %q effective %q, want plan/plan", transition.send, transition.effective)
	}
	if transition.base != claudeagent.PermissionModeBypassAll {
		t.Fatalf("enter plan base = %q, want bypassPermissions", transition.base)
	}

	// Native plan entry: the runtime is already planning, so the previously
	// recorded base mode must survive instead of being overwritten by "plan".
	native := resolveSetPlanMode(permissionState{
		permissionMode:         claudeagent.PermissionModePlan,
		previousPermissionMode: claudeagent.PermissionModeAcceptEdits,
	}, true)
	if native.send != claudeagent.PermissionModePlan || native.effective != claudeagent.PermissionModePlan {
		t.Fatalf("native enter plan modes = send %q effective %q, want plan/plan", native.send, native.effective)
	}
	if native.base != claudeagent.PermissionModeAcceptEdits {
		t.Fatalf("native enter plan base = %q, want acceptEdits", native.base)
	}

	// No user-selected mode: base stays empty so exit falls back to default.
	blank := resolveSetPlanMode(permissionState{}, true)
	if blank.base != "" {
		t.Fatalf("blank enter plan base = %q, want empty", blank.base)
	}
}

func TestResolveSetPlanModeExitRestoresBaseMode(t *testing.T) {
	transition := resolveSetPlanMode(permissionState{
		planMode:               true,
		permissionMode:         claudeagent.PermissionModePlan,
		previousPermissionMode: claudeagent.PermissionModeBypassAll,
	}, false)
	if transition.send != claudeagent.PermissionModeBypassAll || transition.effective != claudeagent.PermissionModeBypassAll {
		t.Fatalf("exit plan modes = send %q effective %q, want bypassPermissions/bypassPermissions", transition.send, transition.effective)
	}
	if transition.base != claudeagent.PermissionModeBypassAll {
		t.Fatalf("exit plan base = %q, want bypassPermissions", transition.base)
	}

	emptyBase := resolveSetPlanMode(permissionState{planMode: true, permissionMode: claudeagent.PermissionModePlan}, false)
	if emptyBase.send != claudeagent.PermissionModeDefault || emptyBase.effective != claudeagent.PermissionModeDefault {
		t.Fatalf("exit plan without base = send %q effective %q, want default/default", emptyBase.send, emptyBase.effective)
	}

	// Defensive: a plan value can never become the restored base mode.
	planBase := resolveSetPlanMode(permissionState{previousPermissionMode: claudeagent.PermissionModePlan}, false)
	if planBase.send != claudeagent.PermissionModeDefault || planBase.effective != claudeagent.PermissionModeDefault {
		t.Fatalf("exit plan with plan base = send %q effective %q, want default/default", planBase.send, planBase.effective)
	}
}
