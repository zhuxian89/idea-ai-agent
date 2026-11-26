package session

import (
	"context"
	"testing"

	"mindfs/server/internal/fs"
)

func TestCollabSessionIsolationFromSingleChat(t *testing.T) {
	t.Setenv("IDE_AGENT_DATA_DIR", t.TempDir())
	root := fs.NewRootInfo("root-1", "demo", t.TempDir())
	mgr := NewManager(root)
	defer func() { _ = mgr.Shutdown() }()

	ctx := context.Background()
	normal, err := mgr.Create(ctx, CreateInput{
		Key:  "chat-1",
		Type: TypeChat,
		Name: "普通单聊",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := mgr.SetPinned(ctx, normal.Key, true); err != nil {
		t.Fatal(err)
	}

	stage, err := mgr.Create(ctx, CreateInput{
		Key:    "collab-run1-impl",
		Type:   TypeChat,
		Source: SourceCollabStage,
		Name:   "阶段 1 主模型实现",
	})
	if err != nil {
		t.Fatal(err)
	}
	review, err := mgr.Create(ctx, CreateInput{
		Key:    "collab-run1-review",
		Type:   TypeChat,
		Source: SourceCollabReview,
		Name:   "阶段 2 只读审核",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := mgr.SetPinned(ctx, review.Key, true); err != nil {
		t.Fatal(err)
	}
	if err := mgr.AddExchangeForAgent(ctx, stage, "user", "secret-collab-keyword", "codex", "", "", ""); err != nil {
		t.Fatal(err)
	}

	sub, err := mgr.Create(ctx, CreateInput{
		Key:              "sub-1",
		Type:             TypeChat,
		ParentSessionKey: review.Key,
		Name:             "Explore 子代理",
	})
	if err != nil {
		t.Fatal(err)
	}

	if IsReadOnlySession(stage) {
		t.Fatal("stage session should not be read-only")
	}
	if !IsReadOnlySession(review) {
		t.Fatal("review session must be read-only")
	}

	listed, err := mgr.List(ctx, ListOptions{TopLevelOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].Key != normal.Key {
		t.Fatalf("TopLevel List = %#v, want only %s", listed, normal.Key)
	}

	count, err := mgr.Count(ctx, ListOptions{TopLevelOnly: true})
	if err != nil || count != 1 {
		t.Fatalf("Count = %d, err = %v, want 1", count, err)
	}

	pinned, err := mgr.ListPinned(ctx, ListOptions{TopLevelOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(pinned) != 1 || pinned[0].Key != normal.Key {
		t.Fatalf("Pinned = %#v, want only %s", pinned, normal.Key)
	}

	hits, err := mgr.Search(ctx, SearchOptions{Query: "secret-collab-keyword"})
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) != 0 {
		t.Fatalf("Search leaked collab session: %#v", hits)
	}

	// Direct Get and child lookup for SessionViewer must still work cleanly.
	loadedStage, err := mgr.Get(ctx, stage.Key, 0)
	if err != nil || len(loadedStage.Exchanges) != 1 {
		t.Fatalf("Get stage = %#v, err = %v", loadedStage, err)
	}
	children, err := mgr.List(ctx, ListOptions{ParentSessionKey: review.Key})
	if err != nil || len(children) != 1 || children[0].Key != sub.Key {
		t.Fatalf("Children of review = %#v, err = %v", children, err)
	}
}
