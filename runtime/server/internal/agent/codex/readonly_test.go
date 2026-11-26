package codex

import (
	"context"
	"testing"

	codexsdk "github.com/fanwenlin/codex-go-sdk/codex"
)

func TestReadOnlyCodexSessionEnforcement(t *testing.T) {
	rt := NewRuntime()
	defer rt.CloseAll()

	raw, err := rt.OpenSession(context.Background(), OpenOptions{
		AgentName:  "codex",
		SessionKey: "ro-codex-1",
		Mode:       "full-access",
		PlanMode:   true,
		ReadOnly:   true,
		RootPath:   t.TempDir(),
	})
	if err != nil {
		t.Fatal(err)
	}
	sess := raw.(*session)
	if sess.threadOpts.SandboxMode != "read-only" || sess.threadOpts.ApprovalPolicy != "never" {
		t.Fatalf("threadOpts = (%q, %q), want (read-only, never)", sess.threadOpts.SandboxMode, sess.threadOpts.ApprovalPolicy)
	}
	if sess.planMode {
		t.Fatal("planMode = true on read-only session, want false")
	}

	decision, err := sess.handleApprovalRequest(codexsdk.ApprovalRequest{ItemID: "1", ItemType: "command"})
	if err != nil {
		t.Fatal(err)
	}
	if decision != codexsdk.ApprovalDecisionRejected {
		t.Fatalf("decision = %q, want %q", decision, codexsdk.ApprovalDecisionRejected)
	}

	if err := sess.SetMode(context.Background(), "full-access"); err == nil {
		t.Fatal("SetMode(full-access) on read-only session succeeded, want error")
	}
	if err := sess.SetMode(context.Background(), "read-only"); err != nil {
		t.Fatalf("SetMode(read-only) failed: %v", err)
	}
	if err := sess.SetPlanMode(context.Background(), true); err == nil {
		t.Fatal("SetPlanMode(true) on read-only session succeeded, want error")
	}
}
