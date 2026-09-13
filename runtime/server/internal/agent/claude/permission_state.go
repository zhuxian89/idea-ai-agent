package claude

import (
	"strings"

	claudeagent "github.com/roasbeef/claude-agent-sdk-go"
)

// planPermissionMode is the CLI-native planning mode. The CLI can enter it
// through its own EnterPlanMode flow (reported back via System/Status
// messages) even when this process never called SetPlanMode, so permission
// handling must consult the live runtime value and not only the session's
// plan flag.
const planPermissionMode = claudeagent.PermissionModePlan

// CurrentMode returns the permission mode the runtime currently reports. The
// value is refreshed from CLI System/Status messages (see updateSessionID) and
// therefore reflects CLI-side plan entry/exit and mode resets that bypass this
// process. It backs the optional duck-typed mode reader used by the session
// usecase to verify pooled sessions before the next send; runtimes that do not
// implement the reader keep their legacy behavior.
func (s *session) CurrentMode() string {
	if s == nil {
		return ""
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return strings.TrimSpace(string(s.permissionMode))
}

// permissionState captures the mutable permission-related fields of a session
// so the transition helpers below can be tested without a live CLI stream.
type permissionState struct {
	planMode               bool
	permissionMode         claudeagent.PermissionMode
	previousPermissionMode claudeagent.PermissionMode
}

// initialPermissionState derives the session's starting permission state from
// the open options. The user-selected mode is preserved as the base mode so
// leaving plan mode restores it instead of an arbitrary default; when plan
// mode is requested, the effective runtime mode is "plan" (the stream is put
// into plan mode right after opening).
func initialPermissionState(mode string, planMode bool) permissionState {
	base := claudeagent.PermissionMode(strings.TrimSpace(mode))
	state := permissionState{
		permissionMode:         base,
		previousPermissionMode: base,
	}
	if planMode {
		state.planMode = true
		state.permissionMode = planPermissionMode
	}
	return state
}

// setModeTransition describes how a SetMode request applies to the runtime.
type setModeTransition struct {
	// planning reports that the runtime is inside the plan flow: the request
	// is only recorded as the new base mode and no control request is sent,
	// so a mode change can never bypass or silently terminate an active plan
	// (including plans the CLI entered natively).
	planning bool
	// previous is the base mode to persist in previousPermissionMode.
	previous claudeagent.PermissionMode
	// send is the mode to push to the CLI; empty means "no control request".
	send claudeagent.PermissionMode
	// effective is the runtime mode to record after the ack.
	effective claudeagent.PermissionMode
}

// resolveSetMode decides how a SetMode request applies given the live state.
// While planning - via SetPlanMode or the CLI's native EnterPlanMode - only
// the base mode is updated; it takes effect when the plan flow exits.
func resolveSetMode(state permissionState, next claudeagent.PermissionMode) setModeTransition {
	if state.planMode || state.permissionMode == planPermissionMode {
		return setModeTransition{
			planning:  true,
			previous:  next,
			effective: state.permissionMode,
		}
	}
	return setModeTransition{
		previous:  next,
		send:      next,
		effective: next,
	}
}

// setPlanModeTransition describes how a SetPlanMode request applies.
type setPlanModeTransition struct {
	// send is the mode to push to the CLI.
	send claudeagent.PermissionMode
	// effective is the runtime mode to record after the ack.
	effective claudeagent.PermissionMode
	// base is the base mode to record after the ack.
	base claudeagent.PermissionMode
}

// resolveSetPlanMode decides how a SetPlanMode request applies. Entering plan
// mode records the current non-plan runtime mode as the base mode (keeping any
// previously recorded base when the CLI is already planning). Leaving plan
// mode restores the recorded base mode instead of an arbitrary default, so an
// explicit exit never widens or discards the user's selection.
func resolveSetPlanMode(state permissionState, enabled bool) setPlanModeTransition {
	if enabled {
		base := state.previousPermissionMode
		if current := state.permissionMode; current != "" && current != planPermissionMode {
			base = current
		}
		return setPlanModeTransition{
			send:      planPermissionMode,
			effective: planPermissionMode,
			base:      base,
		}
	}
	base := state.previousPermissionMode
	if base == "" || base == planPermissionMode {
		base = claudeagent.PermissionModeDefault
	}
	return setPlanModeTransition{
		send:      base,
		effective: base,
		base:      base,
	}
}
