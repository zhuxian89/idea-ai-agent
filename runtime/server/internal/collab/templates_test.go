package collab

import (
	"os"
	"path/filepath"
	"testing"

	"mindfs/server/internal/agent"
	agenttypes "mindfs/server/internal/agent/types"
)

func TestGlobalTemplateStoreSnapshotAndAvailability(t *testing.T) {
	dir := t.TempDir()
	storePath := filepath.Join(dir, "collab-templates.json")

	// Verify legacy bare-array JSON upgrades idempotently to versioned format.
	legacyJSON := `[{"id":"legacy-1","name":"日常一写一审","members":[{"role":"primary","agent":"claude","model":"claude-opus-4-6"},{"role":"reviewer","agent":"codex","model":"gpt-5.4"}]}]`
	if err := os.WriteFile(storePath, []byte(legacyJSON), 0o600); err != nil {
		t.Fatal(err)
	}

	store, err := NewTemplateStoreAt(storePath)
	if err != nil {
		t.Fatal(err)
	}
	list, err := store.List(ModeQuick)
	if err != nil || len(list) != 1 || list[0].ID != "legacy-1" {
		t.Fatalf("legacy load = %#v, err = %v", list, err)
	}
	if list[0].Members[0].PermissionMode != "" {
		t.Fatal("legacy template must keep native permissions")
	}

	t1, err := store.Save(Template{
		ID:        "legacy-1",
		Name:      "日常一写一审",
		Mode:      ModeQuick,
		IsDefault: true,
		Members: []MemberSlot{
			{Role: RolePrimary, Agent: "claude", Model: "claude-opus-4-6", Effort: "high"},
			{Role: RoleReviewer, Agent: "codex", Model: "gpt-5.4", Effort: "xhigh"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	snap := SnapshotTemplate(t1)

	// Saving a second default template in Quick Mode unsets IsDefault on the first,
	// without mutating the previously captured SnapshotTemplate!
	t2, err := store.Save(Template{
		Name:      "双模型快审",
		Mode:      ModeQuick,
		IsDefault: true,
		Members: []MemberSlot{
			{Role: RolePrimary, Agent: "codex", Model: "gpt-5.4", PermissionMode: " full-access "},
			{Role: RoleReviewer, Agent: "claude", Model: "claude-sonnet-4-6", PermissionMode: "bypassPermissions"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	reloaded2, ok, err := store.Get(t2.ID)
	if err != nil || !ok || reloaded2.Members[0].PermissionMode != "full-access" || reloaded2.Members[1].PermissionMode != "" {
		t.Fatalf("reloaded template permissions: %+v %v", reloaded2.Members, err)
	}
	snap.Members[0].Model = "mutated-locally"
	reloaded1, ok, err := store.Get(t1.ID)
	if err != nil || !ok {
		t.Fatalf("Get(t1) = %v, %v", ok, err)
	}
	if reloaded1.IsDefault || !t2.IsDefault {
		t.Fatalf("default switch failed: t1=%v t2=%v", reloaded1.IsDefault, t2.IsDefault)
	}
	if reloaded1.Members[0].Model != "claude-opus-4-6" {
		t.Fatalf("snapshot mutation leaked into store: %q", reloaded1.Members[0].Model)
	}

	statuses := []agent.Status{
		{
			Name:      "claude",
			Installed: true,
			Available: true,
			Models:    []agenttypes.ModelInfo{{ID: "claude-opus-4-6"}, {ID: "claude-sonnet-4-6"}},
		},
		{
			Name:      "codex",
			Installed: true,
			Available: true,
			Models:    []agenttypes.ModelInfo{{ID: "gpt-5.4"}},
		},
		{
			Name:      "gemini",
			Installed: false,
			Available: false,
		},
	}

	checks := ValidateMembers([]MemberSlot{
		{SlotID: "primary", Role: RolePrimary, Agent: "claude", Model: "claude-opus-4-6"},
		{SlotID: "reviewer", Role: RoleReviewer, Agent: "codex", Model: "retired-relay-model"},
		{SlotID: "m3", Role: RoleMember, Agent: "gemini", Model: "gemini-2.5-pro"},
	}, statuses)
	if !checks[0].Available {
		t.Fatalf("slot 0 expected available: %#v", checks[0])
	}
	if checks[1].Available || checks[1].Model != "retired-relay-model" || checks[1].Reason == "" {
		t.Fatalf("slot 1 expected unavailable without silent substitution: %#v", checks[1])
	}
	if checks[2].Available || checks[2].Reason == "" {
		t.Fatalf("slot 2 expected unavailable uninstalled agent: %#v", checks[2])
	}
}
