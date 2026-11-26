package acp

import (
	"context"
	"testing"

	acpsdk "github.com/coder/acp-go-sdk"
)

func TestReadOnlyACPPermissionsAndCallbacks(t *testing.T) {
	allowOpt := acpsdk.PermissionOption{OptionId: "allow", Kind: acpsdk.PermissionOptionKindAllowOnce}
	rejectOpt := acpsdk.PermissionOption{OptionId: "reject", Kind: acpsdk.PermissionOptionKindRejectOnce}

	readKind := acpsdk.ToolKindRead
	editKind := acpsdk.ToolKindEdit
	execKind := acpsdk.ToolKindExecute

	if out := selectACPPermissionOutcome(true, &readKind, []acpsdk.PermissionOption{allowOpt, rejectOpt}); out.Selected == nil || out.Selected.OptionId != "allow" {
		t.Fatalf("read tool in read-only session outcome = %#v, want allow", out)
	}
	for _, kind := range []*acpsdk.ToolKind{&editKind, &execKind, nil} {
		out := selectACPPermissionOutcome(true, kind, []acpsdk.PermissionOption{allowOpt, rejectOpt})
		if out.Selected == nil || out.Selected.OptionId != "reject" {
			t.Fatalf("mutating/unknown tool outcome = %#v, want reject", out)
		}
		noReject := selectACPPermissionOutcome(true, kind, []acpsdk.PermissionOption{allowOpt})
		if noReject.Cancelled == nil {
			t.Fatalf("without reject option, read-only outcome = %#v, want Cancelled", noReject)
		}
	}

	proc := &Process{
		sessions:     map[string]*sessionState{},
		sessionsByID: map[string]*sessionState{},
	}
	st := &sessionState{ID: "acp-s1"}
	proc.sessions["k1"] = st
	proc.sessionsByID["acp-s1"] = st
	proc.SetReadOnly("k1", true)

	client := &mindfsClient{proc: proc}
	if _, err := client.WriteTextFile(context.Background(), acpsdk.WriteTextFileRequest{SessionId: "acp-s1"}); err == nil {
		t.Fatal("WriteTextFile succeeded on read-only ACP session, want error")
	}
	if _, err := client.CreateTerminal(context.Background(), acpsdk.CreateTerminalRequest{SessionId: "acp-s1"}); err == nil {
		t.Fatal("CreateTerminal succeeded on read-only ACP session, want error")
	}

	s := &session{proc: proc, sessionKey: "k1", readOnly: true}
	if err := s.SetMode(context.Background(), "bypass"); err == nil {
		t.Fatal("SetMode succeeded on read-only ACP session, want error")
	}
}
