package usecase

import (
	"context"
	"path/filepath"
	"testing"

	rootfs "mindfs/server/internal/fs"
	"mindfs/server/internal/session"
)

func TestSessionLogPathUsesRequestedRootAndAgentBinding(t *testing.T) {
	ctx := context.Background()
	rootA := rootfs.NewRootInfo("a", "A", t.TempDir())
	rootB := rootfs.NewRootInfo("b", "B", t.TempDir())
	managerA, managerB := session.NewManager(rootA), session.NewManager(rootB)
	created, err := managerA.Create(ctx, session.CreateInput{Type: session.TypeChat, Agent: "codex", Name: "A chat"})
	if err != nil {
		t.Fatal(err)
	}
	if err := managerA.UpsertAgentBinding(ctx, session.AgentBinding{SessionKey: created.Key, Agent: "codex", AgentSessionID: "native-thread-a"}); err != nil {
		t.Fatal(err)
	}
	svc := Service{Registry: &multiRootSearchTestRegistry{roots: []rootfs.RootInfo{rootA, rootB}, managers: map[string]*session.Manager{"a": managerA, "b": managerB}}}
	out, err := svc.GetSessionLogPath(ctx, GetSessionInput{RootID: "a", Key: created.Key})
	if err != nil {
		t.Fatal(err)
	}
	if out.Path != managerA.ExchangeLogAbsolutePath(created.Key) || !filepath.IsAbs(out.Path) || out.AgentSessionID != "native-thread-a" {
		t.Fatalf("path result = %+v", out)
	}
	for _, input := range []GetSessionInput{{RootID: "missing", Key: created.Key}, {RootID: "b", Key: created.Key}, {RootID: "a", Key: "missing"}, {RootID: "a", Key: "../../outside"}} {
		if _, err := svc.GetSessionLogPath(ctx, input); err == nil {
			t.Fatalf("accepted missing or cross-root session: %+v", input)
		}
	}
	unbound, err := managerB.Create(ctx, session.CreateInput{Type: session.TypeChat, Agent: "codex"})
	if err != nil {
		t.Fatal(err)
	}
	out, err = svc.GetSessionLogPath(ctx, GetSessionInput{RootID: "b", Key: unbound.Key})
	if err != nil || out.AgentSessionID != "" || out.Path != managerB.ExchangeLogAbsolutePath(unbound.Key) {
		t.Fatalf("unbound = %+v, %v", out, err)
	}
}
