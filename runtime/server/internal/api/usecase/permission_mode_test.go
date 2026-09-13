package usecase

import (
	"context"
	"errors"
	"sync"
	"testing"

	agenttypes "mindfs/server/internal/agent/types"
)

// modeVerifyRuntime is a scripted pooled runtime session. It satisfies
// agenttypes.Session but deliberately does NOT implement CurrentMode, so it
// doubles as the legacy stub used to prove old runtimes keep their behavior.
type modeVerifyRuntime struct {
	mu           sync.Mutex
	currentMode  string
	setModeErr   error
	setModeCalls []string
}

var _ agenttypes.Session = (*modeVerifyRuntime)(nil)

func (m *modeVerifyRuntime) SetMode(_ context.Context, mode string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.setModeCalls = append(m.setModeCalls, mode)
	if m.setModeErr != nil {
		return m.setModeErr
	}
	m.currentMode = mode
	return nil
}

func (m *modeVerifyRuntime) recordedSetModes() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]string(nil), m.setModeCalls...)
}

func (m *modeVerifyRuntime) liveMode() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.currentMode
}

func (m *modeVerifyRuntime) SendMessage(context.Context, string) error {
	return nil
}

func (m *modeVerifyRuntime) AnswerQuestion(context.Context, agenttypes.AskUserAnswer) error {
	return nil
}

func (m *modeVerifyRuntime) CurrentModel() string {
	return ""
}

func (m *modeVerifyRuntime) SetModel(context.Context, string) error {
	return nil
}

func (m *modeVerifyRuntime) ListModels(context.Context) (agenttypes.ModelList, error) {
	return agenttypes.ModelList{}, nil
}

func (m *modeVerifyRuntime) SetPlanMode(context.Context, bool) error {
	return nil
}

func (m *modeVerifyRuntime) ListModes(context.Context) (agenttypes.ModeList, error) {
	return agenttypes.ModeList{}, nil
}

func (m *modeVerifyRuntime) ListCommands(context.Context) (agenttypes.CommandList, error) {
	return agenttypes.CommandList{}, nil
}

func (m *modeVerifyRuntime) CancelCurrentTurn() error {
	return nil
}

func (m *modeVerifyRuntime) OnUpdate(func(agenttypes.Event)) {}

func (m *modeVerifyRuntime) SessionID() string {
	return "pool-mode-verify"
}

func (m *modeVerifyRuntime) Close() error {
	return nil
}

func (m *modeVerifyRuntime) ContextWindow(context.Context) (agenttypes.ContextWindow, error) {
	return agenttypes.ContextWindow{}, nil
}

// modeVerifyModeReader adds the optional duck-typed mode reader implemented by
// the Claude SDK session.
type modeVerifyModeReader struct{ *modeVerifyRuntime }

var _ interface{ CurrentMode() string } = (*modeVerifyModeReader)(nil)

func (m *modeVerifyModeReader) CurrentMode() string { return m.liveMode() }

func TestEnsureRuntimePermissionModeSyncsDriftedRuntime(t *testing.T) {
	core := &modeVerifyRuntime{currentMode: "default"}
	runtime := &modeVerifyModeReader{modeVerifyRuntime: core}

	// Transcript claims bypass but the runtime reports default: the next send
	// must re-sync before continuing.
	if err := ensureRuntimePermissionMode(context.Background(), nil, "claude", "bypassPermissions", runtime); err != nil {
		t.Fatal(err)
	}
	if calls := core.recordedSetModes(); len(calls) != 1 || calls[0] != "bypassPermissions" {
		t.Fatalf("set mode calls = %v, want [bypassPermissions]", calls)
	}
	if mode := core.liveMode(); mode != "bypassPermissions" {
		t.Fatalf("runtime mode after ack = %q, want bypassPermissions", mode)
	}

	// After a successful ack both sides agree: no repeated control request.
	if err := ensureRuntimePermissionMode(context.Background(), nil, "claude", "bypassPermissions", runtime); err != nil {
		t.Fatal(err)
	}
	if calls := core.recordedSetModes(); len(calls) != 1 {
		t.Fatalf("set mode calls after re-check = %v, want no additional requests", calls)
	}
}

func TestEnsureRuntimePermissionModeEmptyModeKeepsCLIDefaults(t *testing.T) {
	core := &modeVerifyRuntime{currentMode: "default"}
	runtime := &modeVerifyModeReader{modeVerifyRuntime: core}
	for _, nextMode := range []string{"", "   "} {
		if err := ensureRuntimePermissionMode(context.Background(), nil, "claude", nextMode, runtime); err != nil {
			t.Fatal(err)
		}
	}
	if calls := core.recordedSetModes(); len(calls) != 0 {
		t.Fatalf("empty mode must not force a mode, got calls %v", calls)
	}
	if mode := core.liveMode(); mode != "default" {
		t.Fatalf("runtime mode changed to %q without a request", mode)
	}
}

func TestEnsureRuntimePermissionModeFailureBlocksTurn(t *testing.T) {
	core := &modeVerifyRuntime{currentMode: "default", setModeErr: errors.New("cli refused mode change")}
	runtime := &modeVerifyModeReader{modeVerifyRuntime: core}
	err := ensureRuntimePermissionMode(context.Background(), nil, "claude", "bypassPermissions", runtime)
	if err == nil {
		t.Fatal("mismatched runtime with failing ack must abort the turn")
	}
	if err.Error() != "cli refused mode change" {
		t.Fatalf("error = %v, want the runtime error", err)
	}
	if calls := core.recordedSetModes(); len(calls) != 1 {
		t.Fatalf("set mode calls = %v, want exactly one attempt", calls)
	}
}

func TestEnsureRuntimePermissionModeLegacyStubWithoutModeReader(t *testing.T) {
	core := &modeVerifyRuntime{currentMode: "default"}
	if err := ensureRuntimePermissionMode(context.Background(), nil, "claude", "bypassPermissions", core); err != nil {
		t.Fatal(err)
	}
	if calls := core.recordedSetModes(); len(calls) != 0 {
		t.Fatalf("legacy runtime must keep legacy behavior, got calls %v", calls)
	}
}

func TestEnsureRuntimePermissionModeDefersToPlanRuntime(t *testing.T) {
	core := &modeVerifyRuntime{currentMode: "plan"}
	runtime := &modeVerifyModeReader{modeVerifyRuntime: core}
	// The claude session records this request as the new base mode without
	// exiting plan; here we assert the usecase forwards the user's selection.
	if err := ensureRuntimePermissionMode(context.Background(), nil, "claude", "bypassPermissions", runtime); err != nil {
		t.Fatal(err)
	}
	if calls := core.recordedSetModes(); len(calls) != 1 || calls[0] != "bypassPermissions" {
		t.Fatalf("set mode calls = %v, want [bypassPermissions]", calls)
	}
}

func TestRuntimePermissionModeReaderDuckTyping(t *testing.T) {
	if got := runtimePermissionMode(nil); got != "" {
		t.Fatalf("nil runtime mode = %q, want empty", got)
	}
	core := &modeVerifyRuntime{currentMode: "  acceptEdits  "}
	if got := runtimePermissionMode(core); got != "" {
		t.Fatalf("legacy runtime mode = %q, want empty", got)
	}
	reader := &modeVerifyModeReader{modeVerifyRuntime: core}
	if got := runtimePermissionMode(reader); got != "acceptEdits" {
		t.Fatalf("reader mode = %q, want acceptEdits", got)
	}
}
