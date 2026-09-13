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
