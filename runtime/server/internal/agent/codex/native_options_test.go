package codex

import (
	"context"
	"testing"
)

func TestOpenSessionInheritsNativePermissions(t *testing.T) {
	r := NewRuntime()
	defer r.CloseAll()
	opened, err := r.OpenSession(context.Background(), OpenOptions{SessionKey: "native-options", RootPath: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	s := opened.(*session)
	if s.threadOpts.SandboxMode != "" || s.threadOpts.ApprovalPolicy != "" {
		t.Fatalf("native permissions overridden: sandbox=%q approval=%q", s.threadOpts.SandboxMode, s.threadOpts.ApprovalPolicy)
	}
}

func TestNativePermissionModeChoices(t *testing.T) {
	modes, err := (&session{}).ListModes(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range modes.Modes {
		if mode.ID == "full-access" {
			return
		}
	}
	t.Fatal("Codex full-access permission choice is missing")
}

func TestNativeFullAccessAndPermissionDowngrade(t *testing.T) {
	r := NewRuntime()
	defer r.CloseAll()
	opened, err := r.OpenSession(context.Background(), OpenOptions{SessionKey: "permissions", RootPath: t.TempDir(), Mode: "full-access", PlanMode: true})
	if err != nil {
		t.Fatal(err)
	}
	s := opened.(*session)
	if s.threadOpts.SandboxMode != "danger-full-access" || s.threadOpts.ApprovalPolicy != "never" {
		t.Fatalf("full access not forwarded: %+v", s.threadOpts)
	}
	if err := s.SetMode(context.Background(), "default"); err != nil {
		t.Fatal(err)
	}
	if s.threadOpts.SandboxMode != "workspace-write" || s.threadOpts.ApprovalPolicy != "on-request" {
		t.Fatal("normal mode did not restore approvals")
	}
	if s.threadOpts.CollaborationMode == nil || string(s.threadOpts.CollaborationMode.Mode) != "plan" {
		t.Fatal("permission change discarded plan mode")
	}
	if err := s.SetMode(context.Background(), "invalid"); err == nil {
		t.Fatal("invalid mode silently accepted")
	}
	if s.threadOpts.SandboxMode != "workspace-write" {
		t.Fatal("invalid mode changed permissions")
	}
}
