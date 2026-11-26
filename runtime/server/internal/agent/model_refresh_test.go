package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	agenttypes "mindfs/server/internal/agent/types"
)

// 子进程仅模拟版本命令和 app-server 协议，模型目录在启动时固定，不调用真实 CLI。
func init() {
	path := os.Getenv("IDE_AGENT_MODEL_REFRESH_FIXTURE")
	if path == "" {
		return
	}
	data, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	version := strings.TrimSpace(string(data))
	if len(os.Args) > 1 && os.Args[1] == "--version" {
		fmt.Println("codex-cli " + version)
		os.Exit(0)
	}
	if len(os.Args) < 2 || os.Args[1] != "app-server" {
		os.Exit(2)
	}
	model := "gpt-6-sol"
	if version == "0.169.1" {
		model = "gpt-6.2-astra"
	}
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var request struct {
			ID     *int64 `json:"id"`
			Method string `json:"method"`
		}
		if json.Unmarshal(scanner.Bytes(), &request) != nil || request.ID == nil {
			continue
		}
		var result any
		switch request.Method {
		case "initialize":
			result = map[string]any{"userAgent": "codex_cli_rs/" + version + " (Windows 10.0)"}
		case "model/list":
			result = map[string]any{"data": []any{map[string]any{"id": model, "model": model, "displayName": model, "isDefault": true}}}
		case "config/read":
			result = map[string]any{"config": map[string]any{"model": model}}
		case "thread/unsubscribe":
			result = map[string]any{"status": "unsubscribed"}
		default:
			_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"id": *request.ID, "error": map[string]any{"code": -32601, "message": "unsupported fixture method"}})
			continue
		}
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"id": *request.ID, "result": result})
	}
	os.Exit(0)
}

func TestModelRefreshAutomaticallyReplacesOlderCodex(t *testing.T) {
	for _, test := range []struct {
		name       string
		installed  string
		wantModel  string
		wantError  bool
		wantClosed bool
	}{
		{"updated", "0.169.1", "gpt-6.2-astra", false, true},
		{"same", "0.164.0", "gpt-6-sol", false, false},
		{"older-on-disk", "0.160.0", "gpt-6-sol", false, false},
		{"invalid-version", "unknown", "", true, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			dir := t.TempDir()
			t.Setenv("IDE_AGENT_DATA_DIR", dir)
			t.Setenv("CODEX_HOME", t.TempDir())
			t.Setenv("OPENAI_BASE_URL", "")
			versionFile := filepath.Join(dir, "version.txt")
			writeVersion := func(version string) {
				t.Helper()
				if err := os.WriteFile(versionFile, []byte(version), 0600); err != nil {
					t.Fatal(err)
				}
			}
			writeVersion("0.164.0")
			executable, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			cfg := Config{Agents: []Definition{{Name: "codex", Command: executable, VersionArgs: []string{"--version"}, Env: map[string]string{"IDE_AGENT_MODEL_REFRESH_FIXTURE": versionFile}}}}
			pool := NewPool(cfg)
			defer pool.CloseAll()
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			sess, err := pool.GetOrCreate(ctx, agenttypes.OpenSessionInput{AgentName: "codex", SessionKey: "chat", RootPath: dir, AgentSessionID: "existing-thread"})
			if err != nil {
				t.Fatal(err)
			}
			before, err := sess.ListModels(ctx)
			if err != nil || len(before.Models) != 1 || before.Models[0].ID != "gpt-6-sol" {
				t.Fatalf("initial catalog: %+v, %v", before, err)
			}
			other := &sessionEntry{agentName: "claude", protocol: ProtocolClaudeSDK, session: &startupProbeSession{}}
			pool.sessions["other"] = other
			writeVersion(test.installed)
			prober := NewProber(&cfg, pool, time.Hour)
			prober.MarkProbePending("codex")
			status := prober.ProbeOne(ctx, "codex")
			if status.ProbePending || (status.Error != "") != test.wantError {
				t.Fatalf("refresh status: %+v", status)
			}
			if test.wantError {
				if !strings.Contains(status.Error, "unrecognized codex CLI version") {
					t.Fatalf("lost version error: %s", status.Error)
				}
			} else if !status.Available || len(status.Models) != 1 || status.Models[0].ID != test.wantModel {
				t.Fatalf("refresh catalog: %+v", status)
			}
			_, exists := pool.sessions["chat"]
			if exists == test.wantClosed || pool.sessions["other"] != other {
				t.Fatal("refresh closed the wrong runtime sessions")
			}
			if test.wantClosed {
				// 刷新完成后再次刷新不得重复关闭已更新的运行时。
				identity, _ := pool.codex.AppServerUserAgent("codex")
				if err := pool.RestartUpdatedCodex(ctx, "codex"); err != nil {
					t.Fatal(err)
				}
				again, started := pool.codex.AppServerUserAgent("codex")
				if !started || again != identity || !strings.Contains(again, "0.169.1") {
					t.Fatal("refresh restarted the updated runtime again")
				}
			}
		})
	}
}
