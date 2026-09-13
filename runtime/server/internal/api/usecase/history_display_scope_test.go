package usecase

import (
	"context"
	"errors"
	"testing"
	"time"

	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/session"
)

type displayAgentRegistry struct {
	*syncDeltaTestRegistry
	importers map[string]agenttypes.ExternalSessionImporter
}

func (r *displayAgentRegistry) GetExternalSessionImporter(name string) (agenttypes.ExternalSessionImporter, error) {
	importer, ok := r.importers[name]
	if !ok {
		return nil, errors.New("unknown display agent")
	}
	return importer, nil
}

func TestHistoryDisplayUsesEachExchangesAgentBinding(t *testing.T) {
	ctx := context.Background()
	at := time.Date(2026, 9, 13, 10, 0, 0, 0, time.UTC)
	svc, manager, importer, current := newDisplayTestService(t, "claude", session.Exchange{Role: "user", Content: displayTestNotification, Timestamp: at})
	t.Cleanup(func() { _ = manager.Shutdown() })
	if err := manager.UpdateAgentState(ctx, current, "claude", 1, "external-claude"); err != nil {
		t.Fatal(err)
	}
	if err := manager.AddExchangeForAgentAt(ctx, current, "agent", "switched agent", "codex", "", "", "", at.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := manager.AddExchangeForAgentAt(ctx, current, "user", displayTestNotification, "codex", "", "", "", at); err != nil {
		t.Fatal(err)
	}
	if err := manager.UpdateAgentState(ctx, current, "codex", 3, "external-codex"); err != nil {
		t.Fatal(err)
	}
	importer.projection = agenttypes.ExternalSessionDisplayProjection{
		AgentSessionID: "external-claude",
		Users:          map[int][]agenttypes.ExternalSessionDisplaySnapshot{0: {{Content: displayTestNotification, Timestamp: at, Display: ""}}},
	}
	svc.Registry = &displayAgentRegistry{
		syncDeltaTestRegistry: svc.Registry.(*syncDeltaTestRegistry),
		importers:             map[string]agenttypes.ExternalSessionImporter{"claude": importer, "codex": &syncDeltaTestImporter{}},
	}
	overrides, err := svc.SessionHistoryDisplayOverrides(ctx, SessionHistoryDisplayInput{RootID: "root", Key: current.Key})
	if err != nil {
		t.Fatal(err)
	}
	if display, ok := overrides[1]; !ok || display != "" {
		t.Fatalf("previous Claude history was not corrected: %#v", overrides)
	}
	if _, ok := overrides[3]; ok {
		t.Fatal("a different agent's real user message was hidden")
	}
	if current.Exchanges[0].Content != displayTestNotification || current.Exchanges[2].Content != displayTestNotification {
		t.Fatal("canonical history was modified")
	}
}

func TestDisplayProvenanceConflictsDoNotLeakAcrossTimestamps(t *testing.T) {
	at := time.Date(2026, 9, 13, 10, 0, 0, 0, time.UTC)
	later := at.Add(time.Second)
	projection := agenttypes.ExternalSessionDisplayProjection{Users: map[int][]agenttypes.ExternalSessionDisplaySnapshot{
		0: {{Content: displayTestNotification, Timestamp: at, Display: ""}},
		1: {{Content: displayTestNotification, Timestamp: at, Display: displayTestNotification}},
		2: {{Content: displayTestNotification, Timestamp: later, Display: ""}},
	}}
	overrides := matchSessionDisplayOverrides([]session.Exchange{
		{Seq: 1, Role: "user", Content: displayTestNotification, Timestamp: at},
		{Seq: 2, Role: "user", Content: displayTestNotification, Timestamp: later},
	}, projection)
	if _, ok := overrides[1]; ok {
		t.Fatal("ambiguous provenance must preserve the original content")
	}
	if value, ok := overrides[2]; !ok || value != "" {
		t.Fatal("an unrelated timestamp conflict hid a verified projection")
	}
}
