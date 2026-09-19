package codex

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/fanwenlin/codex-go-sdk/types"
)

func TestTurnApprovalPolicyUsesNativeWireValues(t *testing.T) {
	for _, policy := range []string{"on-request", "untrusted", "never"} {
		t.Run(policy, func(t *testing.T) {
			params, err := (&AppServerExec{}).buildTurnParams("thread", CodexExecArgs{ApprovalPolicy: policy})
			if err != nil {
				t.Fatal(err)
			}
			if params["approvalPolicy"] != policy {
				t.Fatalf("turn approvalPolicy = %q, want %q", params["approvalPolicy"], policy)
			}
		})
	}
}

func TestTurnSandboxNetworkAccessIsBoolean(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		params, err := (&AppServerExec{}).buildTurnParams("thread", CodexExecArgs{SandboxMode: "read-only", NetworkAccessEnabled: enabled})
		if err != nil {
			t.Fatal(err)
		}
		policy := params["sandboxPolicy"].(map[string]interface{})
		if actual, ok := policy["networkAccess"].(bool); !ok || actual != enabled {
			t.Fatalf("networkAccess = %#v, want boolean %v", policy["networkAccess"], enabled)
		}
	}
}

// Run explicitly against an installed CLI. A nonexistent thread lets the real
// RPC decoder validate our exact turn payload without sending a model request.
func TestInstalledCodexAcceptsPermissionWireFormat(t *testing.T) {
	if os.Getenv("CODEX_PROTOCOL_TEST") != "1" {
		t.Skip("set CODEX_PROTOCOL_TEST=1 to validate against installed Codex")
	}
	exec := NewAppServerExec("", nil, nil, types.ClientInfo{}, "", "")
	defer exec.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	for _, mode := range []string{"read-only", "workspace-write", "danger-full-access"} {
		t.Run(mode, func(t *testing.T) {
			policy := "on-request"
			if mode == "danger-full-access" {
				policy = "never"
			}
			params, err := exec.buildTurnParams("00000000-0000-0000-0000-000000000000", CodexExecArgs{
				Input: "Hi", WorkingDirectory: t.TempDir(), SandboxMode: mode, ApprovalPolicy: policy,
			})
			if err != nil {
				t.Fatal(err)
			}
			_, err = exec.RPCCall(ctx, "turn/start", params)
			if err == nil || !strings.Contains(strings.ToLower(err.Error()), "thread not found") {
				t.Fatalf("expected thread lookup after successful protocol decoding, got %v", err)
			}
		})
	}
}
