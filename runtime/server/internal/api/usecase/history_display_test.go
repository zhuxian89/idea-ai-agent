package usecase

import (
	"context"
	"errors"
	"testing"
	"time"

	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/fs"
	"mindfs/server/internal/session"
)

const displayTestNotification = "<task-notification>Background command completed (id: bg-1)</task-notification>"
const displayTestNotification2 = "<task-notification>Background command failed (id: bg-2)</task-notification>"

type displayProjectorImporter struct {
	syncDeltaTestImporter
	projection agenttypes.ExternalSessionDisplayProjection
	err        error
	called     bool
	input      agenttypes.ImportExternalSessionInput
}

func (i *displayProjectorImporter) ProjectExternalSessionDisplay(_ context.Context, in agenttypes.ImportExternalSessionInput) (agenttypes.ExternalSessionDisplayProjection, error) {
	i.called = true
	i.input = in
	return i.projection, i.err
}

func newDisplayTestService(t *testing.T, agentName string, exchanges ...session.Exchange) (*Service, *session.Manager, *displayProjectorImporter, *session.Session) {
	t.Helper()
	root := fs.NewRootInfo("root", "Root", t.TempDir())
	manager := session.NewManager(root)
	created, err := manager.Create(context.Background(), session.CreateInput{
		Type:  session.TypeChat,
		Agent: agentName,
		Name:  "Imported",
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, exchange := range exchanges {
		if err := manager.AddExchangeForAgentAt(context.Background(), created, exchange.Role, exchange.Content, agentName, "", "", "", exchange.Timestamp); err != nil {
			t.Fatal(err)
		}
	}
	importer := &displayProjectorImporter{}
	svc := &Service{Registry: &syncDeltaTestRegistry{root: root, manager: manager, importer: importer}}
	return svc, manager, importer, created
}

func bindTestAgentSession(t *testing.T, manager *session.Manager, created *session.Session, agentSessionID string) {
	t.Helper()
	current, err := manager.Get(context.Background(), created.Key, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.UpdateAgentState(context.Background(), current, "codex", len(current.Exchanges), agentSessionID); err != nil {
		t.Fatal(err)
	}
}

// TestSessionHistoryDisplayOverridesHidesPureNotification covers the main
// fix: a persisted user bubble that the native source proves to be a
// task notification is overridden with empty display content, matched by
// exact content plus canonical timestamp through the agent binding.
func TestSessionHistoryDisplayOverridesHidesPureNotification(t *testing.T) {
	timestamp := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	svc, manager, importer, created := newDisplayTestService(t, "codex", session.Exchange{
		Role:      "user",
		Content:   displayTestNotification,
		Timestamp: timestamp,
	})
	bindTestAgentSession(t, manager, created, "external-1")
	importer.projection = agenttypes.ExternalSessionDisplayProjection{
		AgentSessionID: "external-1",
		Users: map[int][]agenttypes.ExternalSessionDisplaySnapshot{
			0: {{
				Content:   displayTestNotification,
				Timestamp: timestamp,
				Display:   "",
			}},
		},
	}
	overrides, err := svc.SessionHistoryDisplayOverrides(context.Background(), SessionHistoryDisplayInput{
		RootID: "root",
		Key:    created.Key,
	})
	if err != nil {
		t.Fatal(err)
	}
	display, ok := overrides[1]
	if len(overrides) != 1 || !ok || display != "" {
		t.Fatalf("overrides = %#v, want {1: \"\"}", overrides)
	}
	if !importer.called {
		t.Fatal("projector was not called")
	}
	if importer.input.AgentSessionID != "external-1" {
		t.Fatalf("projector agent session id = %q, want the bound id", importer.input.AgentSessionID)
	}
}

// TestSessionHistoryDisplayOverridesMixedPrefixSnapshot covers the older-cache
// case: the persisted exchange holds the merged prefix state recorded before
// the notification line arrived, and the notification body is stripped while
// the real body is kept.
func TestSessionHistoryDisplayOverridesMixedPrefixSnapshot(t *testing.T) {
	first := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	second := first.Add(2 * time.Second)
	mergedContent := "please review\n\n" + displayTestNotification
	svc, manager, importer, created := newDisplayTestService(t, "codex", session.Exchange{
		Role:      "user",
		Content:   mergedContent,
		Timestamp: second,
	})
	bindTestAgentSession(t, manager, created, "external-1")
	importer.projection = agenttypes.ExternalSessionDisplayProjection{
		Users: map[int][]agenttypes.ExternalSessionDisplaySnapshot{
			0: {
				{Content: "please review", Timestamp: first, Display: "please review"},
				{Content: mergedContent, Timestamp: second, Display: "please review"},
			},
		},
	}
	overrides, err := svc.SessionHistoryDisplayOverrides(context.Background(), SessionHistoryDisplayInput{
		RootID: "root",
		Key:    created.Key,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(overrides) != 1 || overrides[1] != "please review" {
		t.Fatalf("overrides = %#v, want {1: \"please review\"}", overrides)
	}
}

// TestSessionHistoryDisplayOverridesPureNotificationPrefix keeps fixing older
// caches whose persisted exchange is exactly the earlier, still-pure
// notification state of a since-grown merged exchange.
func TestSessionHistoryDisplayOverridesPureNotificationPrefix(t *testing.T) {
	first := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	second := first.Add(time.Second)
	svc, manager, importer, created := newDisplayTestService(t, "codex", session.Exchange{
		Role:      "user",
		Content:   displayTestNotification,
		Timestamp: first,
	})
	bindTestAgentSession(t, manager, created, "external-1")
	importer.projection = agenttypes.ExternalSessionDisplayProjection{
		Users: map[int][]agenttypes.ExternalSessionDisplaySnapshot{
			0: {
				{Content: displayTestNotification, Timestamp: first, Display: ""},
				{Content: displayTestNotification + "\n\n" + displayTestNotification2, Timestamp: second, Display: ""},
			},
		},
	}
	overrides, err := svc.SessionHistoryDisplayOverrides(context.Background(), SessionHistoryDisplayInput{
		RootID: "root",
		Key:    created.Key,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(overrides) != 1 || overrides[1] != "" {
		t.Fatalf("overrides = %#v, want {1: \"\"}", overrides)
	}
}

// TestSessionHistoryDisplayOverridesCleanPrefixNeedsNoOverride verifies that a
// cache holding only the real-body prefix state stays untouched.
func TestSessionHistoryDisplayOverridesCleanPrefixNeedsNoOverride(t *testing.T) {
	first := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	second := first.Add(2 * time.Second)
	svc, manager, importer, created := newDisplayTestService(t, "codex", session.Exchange{
		Role:      "user",
		Content:   "please review",
		Timestamp: first,
	})
	bindTestAgentSession(t, manager, created, "external-1")
	importer.projection = agenttypes.ExternalSessionDisplayProjection{
		Users: map[int][]agenttypes.ExternalSessionDisplaySnapshot{
			0: {
				{Content: "please review", Timestamp: first, Display: "please review"},
				{Content: "please review\n\n" + displayTestNotification, Timestamp: second, Display: "please review"},
			},
		},
	}
	overrides, err := svc.SessionHistoryDisplayOverrides(context.Background(), SessionHistoryDisplayInput{
		RootID: "root",
		Key:    created.Key,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(overrides) != 0 {
		t.Fatalf("overrides = %#v, want none", overrides)
	}
}

// TestSessionHistoryDisplayOverridesKeepsUnprovenAndConflictedMatches pins the
// conservative rules: unknown provenance (snapshot display equal to content)
// and same-key conflicts (same content and timestamp resolving to different
// display bodies) both keep the stored content.
func TestSessionHistoryDisplayOverridesKeepsUnprovenAndConflictedMatches(t *testing.T) {
	timestamp := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	svc, manager, importer, created := newDisplayTestService(t, "codex",
		session.Exchange{Role: "user", Content: displayTestNotification, Timestamp: timestamp},
		session.Exchange{Role: "user", Content: "conflicted", Timestamp: timestamp},
	)
	bindTestAgentSession(t, manager, created, "external-1")
	importer.projection = agenttypes.ExternalSessionDisplayProjection{
		Users: map[int][]agenttypes.ExternalSessionDisplaySnapshot{
			0: {{Content: displayTestNotification, Timestamp: timestamp, Display: displayTestNotification}},
			1: {
				{Content: "conflicted", Timestamp: timestamp, Display: ""},
				{Content: "conflicted", Timestamp: timestamp, Display: "conflicted"},
			},
		},
	}
	overrides, err := svc.SessionHistoryDisplayOverrides(context.Background(), SessionHistoryDisplayInput{
		RootID: "root",
		Key:    created.Key,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(overrides) != 0 {
		t.Fatalf("overrides = %#v, want none", overrides)
	}
}

// TestSessionHistoryDisplayOverridesTimestampMismatchKeepsOriginal verifies the
// canonical timestamp guard: identical text at a different time is not treated
// as the same persisted exchange.
func TestSessionHistoryDisplayOverridesTimestampMismatchKeepsOriginal(t *testing.T) {
	timestamp := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	other := timestamp.Add(time.Hour)
	svc, manager, importer, created := newDisplayTestService(t, "codex", session.Exchange{
		Role:      "user",
		Content:   displayTestNotification,
		Timestamp: timestamp,
	})
	bindTestAgentSession(t, manager, created, "external-1")
	importer.projection = agenttypes.ExternalSessionDisplayProjection{
		Users: map[int][]agenttypes.ExternalSessionDisplaySnapshot{
			0: {{Content: displayTestNotification, Timestamp: other, Display: ""}},
		},
	}
	overrides, err := svc.SessionHistoryDisplayOverrides(context.Background(), SessionHistoryDisplayInput{
		RootID: "root",
		Key:    created.Key,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(overrides) != 0 {
		t.Fatalf("overrides = %#v, want none", overrides)
	}
}

// TestSessionHistoryDisplayOverridesIgnoresAgentExchanges pins that only user
// exchanges are projected, so assistant entries and aux payloads (tool calls,
// plans) are never rewritten.
func TestSessionHistoryDisplayOverridesIgnoresAgentExchanges(t *testing.T) {
	timestamp := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	svc, manager, importer, created := newDisplayTestService(t, "codex",
		session.Exchange{Role: "agent", Content: displayTestNotification, Timestamp: timestamp},
		session.Exchange{Role: "user", Content: displayTestNotification, Timestamp: timestamp},
	)
	bindTestAgentSession(t, manager, created, "external-1")
	importer.projection = agenttypes.ExternalSessionDisplayProjection{
		Users: map[int][]agenttypes.ExternalSessionDisplaySnapshot{
			1: {{Content: displayTestNotification, Timestamp: timestamp, Display: ""}},
		},
	}
	overrides, err := svc.SessionHistoryDisplayOverrides(context.Background(), SessionHistoryDisplayInput{
		RootID: "root",
		Key:    created.Key,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(overrides) != 1 {
		t.Fatalf("overrides = %#v, want only the user exchange", overrides)
	}
	if _, ok := overrides[1]; ok {
		t.Fatalf("overrides = %#v, agent exchange must not be overridden", overrides)
	}
	if overrides[2] != "" {
		t.Fatalf("overrides[2] = %q, want empty", overrides[2])
	}
}

// TestSessionHistoryDisplayOverridesFallbacks covers the fallback paths: a
// missing native source returns an error (callers keep stored content), a
// session without an agent binding never invokes the projector, and importers
// without the optional projector interface are skipped.
func TestSessionHistoryDisplayOverridesFallbacks(t *testing.T) {
	timestamp := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	svc, manager, importer, created := newDisplayTestService(t, "codex", session.Exchange{
		Role:      "user",
		Content:   displayTestNotification,
		Timestamp: timestamp,
	})
	bindTestAgentSession(t, manager, created, "external-1")

	importer.err = errors.New("external session not found")
	if _, err := svc.SessionHistoryDisplayOverrides(context.Background(), SessionHistoryDisplayInput{RootID: "root", Key: created.Key}); err == nil {
		t.Fatal("expected an error when the native source is missing")
	}

	// Recreate the scenario without a binding: the projector must not run.
	root2 := fs.NewRootInfo("root2", "Root2", t.TempDir())
	manager2 := session.NewManager(root2)
	created2, err := manager2.Create(context.Background(), session.CreateInput{Type: session.TypeChat, Agent: "codex", Name: "Local"})
	if err != nil {
		t.Fatal(err)
	}
	if err := manager2.AddExchangeForAgentAt(context.Background(), created2, "user", displayTestNotification, "codex", "", "", "", timestamp); err != nil {
		t.Fatal(err)
	}
	importer2 := &displayProjectorImporter{}
	svc2 := &Service{Registry: &syncDeltaTestRegistry{root: root2, manager: manager2, importer: importer2}}
	overrides, err := svc2.SessionHistoryDisplayOverrides(context.Background(), SessionHistoryDisplayInput{RootID: "root2", Key: created2.Key})
	if err != nil {
		t.Fatal(err)
	}
	if overrides != nil {
		t.Fatalf("overrides = %#v, want nil without a binding", overrides)
	}
	if importer2.called {
		t.Fatal("projector ran without an agent binding")
	}

	// An importer without the optional projector interface is skipped cleanly.
	svc3 := &Service{Registry: &syncDeltaTestRegistry{root: root2, manager: manager2, importer: &syncDeltaTestImporter{}}}
	overrides, err = svc3.SessionHistoryDisplayOverrides(context.Background(), SessionHistoryDisplayInput{RootID: "root2", Key: created2.Key})
	if err != nil {
		t.Fatal(err)
	}
	if overrides != nil {
		t.Fatalf("overrides = %#v, want nil without a projector", overrides)
	}
}
