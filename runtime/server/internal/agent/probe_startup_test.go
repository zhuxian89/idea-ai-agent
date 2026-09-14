package agent

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	agenttypes "mindfs/server/internal/agent/types"
)

type startupProbeSession struct {
	agenttypes.Session
	modelsReady <-chan struct{}
}

func (s *startupProbeSession) SessionID() string { return "" }
func (s *startupProbeSession) Close() error      { return nil }
func (s *startupProbeSession) ListModels(ctx context.Context) (agenttypes.ModelList, error) {
	select {
	case <-s.modelsReady:
		return agenttypes.ModelList{Models: []agenttypes.ModelInfo{{ID: "native-model", Name: "Native model"}}}, nil
	case <-ctx.Done():
		return agenttypes.ModelList{}, ctx.Err()
	}
}
func (s *startupProbeSession) ListModes(context.Context) (agenttypes.ModeList, error) {
	return agenttypes.ModeList{}, nil
}
func (s *startupProbeSession) ListCommands(context.Context) (agenttypes.CommandList, error) {
	return agenttypes.CommandList{}, nil
}

// Uses an existing fake session, so the real startup path can run on Windows,
// macOS and Linux without launching a CLI or requiring model credentials.
func TestStartupDiscoversModelsWithoutManualRestart(t *testing.T) {
	for _, addedLater := range []bool{false, true} {
		name := "startup"
		if addedLater {
			name = "config-added"
		}
		t.Run(name, func(t *testing.T) {
			executable, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			cfg := Config{Agents: []Definition{{Name: "codex", Protocol: ProtocolCodexSDK, Command: executable}}}
			pool := NewPool(cfg)
			defer pool.CloseAll()
			ready := make(chan struct{})
			pool.sessions["probe-codex"] = &sessionEntry{agentName: "codex", sessionKey: "probe-codex", session: &startupProbeSession{modelsReady: ready}}
			initialCfg := cfg
			if addedLater {
				initialCfg = Config{}
			}
			prober := NewProber(&initialCfg, pool, time.Hour)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			updates := make(chan Status, 8)
			prober.AddListener(func(status Status) { updates <- status })
			prober.Start(ctx)
			defer prober.Stop()
			if addedLater {
				prober.UpdateConfig(ctx, &cfg)
			}
			pending, _ := prober.GetStatus("codex")
			if !pending.Installed || !pending.ProbePending || pending.Available || pending.Error != "" {
				t.Fatalf("initialization must be pending, not an error: %+v", pending)
			}
			close(ready)
			select {
			case status := <-updates:
				if !status.Available || status.ProbePending || status.Error != "" || len(status.Models) != 1 || status.Models[0].ID != "native-model" {
					t.Fatalf("startup must publish native capabilities: %+v", status)
				}
			case <-ctx.Done():
				t.Fatal("model discovery required manual recovery or never completed")
			}
		})
	}
}

func TestStartupFailureLeavesPendingAndPreservesRealError(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cfg := Config{Agents: []Definition{{Name: "test", Command: executable}}}
	pool := NewPool(cfg)
	pool.CloseAll()
	prober := NewProber(&cfg, pool, time.Hour)
	status := prober.ProbeOne(context.Background(), "test")
	if status.ProbePending || status.Available || status.ProbeError == "" {
		t.Fatalf("completed failure must no longer be pending: %+v", status)
	}
	prober.ReportRuntimeFailure("test", errors.New("sign in required"))
	status, _ = prober.GetStatus("test")
	if status.ProbePending || status.Error != "sign in required" {
		t.Fatalf("real failures must remain visible: %+v", status)
	}
}
