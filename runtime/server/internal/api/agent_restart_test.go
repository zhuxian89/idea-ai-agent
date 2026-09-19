package api

import (
	"testing"
	"time"

	"mindfs/server/internal/agent"
)

func TestRestartMarksAgentProbePending(t *testing.T) {
	prober := agent.NewProber(&agent.Config{Agents: []agent.Definition{{Name: "codex"}}}, nil, 0)
	pending := make(chan agent.Status, 10)
	prober.AddListener(func(status agent.Status) {
		t.Logf("status update: %+v", status)
		if status.Name == "codex" && !status.ProbePending {
			select {
			case pending <- status:
			default:
			}
		}
	})
	app := &AppContext{Agents: agent.NewPool(agent.Config{Agents: []agent.Definition{{Name: "codex"}}}), Prober: prober}
	if err := restartAgent("codex", app); err != nil {
		t.Fatal(err)
	}
	select {
	case status := <-pending:
		if status.ProbePending {
			t.Fatalf("probe did not complete: %+v", status)
		}
	case <-time.After(time.Second):
		t.Fatal("restart did not publish a completed probe status")
	}
}

func TestRestartUnknownAgentDoesNotPanic(t *testing.T) {
	prober := agent.NewProber(&agent.Config{}, nil, 0)
	app := &AppContext{Agents: agent.NewPool(agent.Config{}), Prober: prober}
	if err := restartAgent("unknown", app); err == nil {
		t.Fatal("unknown agent must be rejected")
	}
}
