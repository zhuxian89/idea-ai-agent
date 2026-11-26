package usecase

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"mindfs/server/internal/agent"
	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/collab"
	rootfs "mindfs/server/internal/fs"
	"mindfs/server/internal/session"
)

func init() {
	if os.Getenv("IDE_AGENT_SUFFIX_TEST_HELPER") != "1" {
		return
	}
	failTurn := os.Getenv("IDE_AGENT_SUFFIX_TEST_FAIL") == "1"
	enc := json.NewEncoder(os.Stdout)
	input := bufio.NewScanner(os.Stdin)
	input.Buffer(make([]byte, 4096), 1<<20)
	for input.Scan() {
		var req struct {
			ID     any            `json:"id"`
			Method string         `json:"method"`
			Params map[string]any `json:"params"`
		}
		if json.Unmarshal(input.Bytes(), &req) != nil {
			os.Exit(2)
		}
		if req.ID == nil {
			continue
		}
		result := any(map[string]any{})
		if req.Method == "thread/start" {
			result = map[string]any{"thread": map[string]any{"id": "suffix-thread"}}
		}
		if req.Method == "turn/start" {
			result = map[string]any{"turn": map[string]any{"id": "suffix-turn"}}
		}
		_ = enc.Encode(map[string]any{"id": req.ID, "result": result})
		if req.Method != "turn/start" {
			continue
		}
		notify := func(method string, extra map[string]any) {
			extra["threadId"], extra["turnId"] = "suffix-thread", "suffix-turn"
			_ = enc.Encode(map[string]any{"method": method, "params": extra})
		}
		notify("turn/started", map[string]any{"turn": map[string]any{"id": "suffix-turn"}})
		notify("item/agentMessage/delta", map[string]any{"itemId": "msg-pre", "delta": "正在执行检查，等待完成。\n\n"})
		item := map[string]any{"id": "exec-check", "type": "commandExecution", "command": "go test ./...", "status": "completed", "exitCode": 0}
		notify("item/started", map[string]any{"item": item})
		notify("item/completed", map[string]any{"item": item})
		notify("item/agentMessage/delta", map[string]any{"itemId": "msg-1", "delta": "# 实现说明\n\n已完成修改。"})
		if failTurn {
			time.Sleep(10 * time.Second)
			continue
		}
		notify("item/agentMessage/delta", map[string]any{"itemId": "msg-1", "delta": "\n```mindfs-control\n{\"kind\":\"review\",\"items\":[]}\n```\n"})
		notify("turn/completed", map[string]any{"turn": map[string]any{"id": "suffix-turn", "status": "completed"}})
	}
	os.Exit(0)
}

func TestTransientSlashCommandPreservesReviewReadOnlyMode(t *testing.T) {
	bin, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name   string
		cached bool
	}{
		{name: "new runtime"},
		{name: "replace mismatched runtime", cached: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := rootfs.NewRootInfo("root", "Root", t.TempDir())
			manager := session.NewManager(root)
			t.Cleanup(func() { _ = manager.Shutdown() })
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			current, err := manager.Create(ctx, session.CreateInput{Type: session.TypeChat, Source: session.SourceCollabReview, Agent: "codex", Model: "test-model"})
			if err != nil {
				t.Fatal(err)
			}
			pool := agent.NewPool(agent.Config{Agents: []agent.Definition{{
				Name: "codex", Command: bin, Protocol: agent.ProtocolCodexSDK,
				Env: map[string]string{"IDE_AGENT_SUFFIX_TEST_HELPER": "1"},
			}}})
			t.Cleanup(pool.CloseAll)
			key := agentPoolSessionKey(current.Key, "codex")
			var old agenttypes.Session
			if tc.cached {
				old, err = pool.GetOrCreate(ctx, agenttypes.OpenSessionInput{SessionKey: key, AgentName: "codex", RootPath: root.RootPath})
				if err != nil {
					t.Fatal(err)
				}
			}
			service := &Service{Registry: &turnDiffRegistry{commandTestRegistry: &commandTestRegistry{root: root, manager: manager}, pool: pool}}
			if err := service.RunTransientSlashCommand(ctx, RunTransientSlashCommandInput{
				RootID: root.ID, Key: current.Key, Agent: "codex", Model: "test-model", Command: "status",
			}); err != nil {
				t.Fatal(err)
			}
			got, readOnly, ok := pool.GetWithReadOnly(key)
			if !ok || !readOnly || got == old {
				t.Fatalf("expected a read-only review runtime, found=%t readOnly=%t reusedOld=%t", ok, readOnly, got == old)
			}
		})
	}
}

func TestSendMessageStreamFilterCompletionSuffix(t *testing.T) {
	bin, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	docPath := ".mindfs/runs/run-1/01-初次实现说明.md"
	wantNotice := "阶段交付路径：" + docPath

	t.Run("appends delivery path on success without polluting VisibleText", func(t *testing.T) {
		rootDir := t.TempDir()
		root := rootfs.NewRootInfo("root", "Root", rootDir)
		manager := session.NewManager(root)
		t.Cleanup(func() { _ = manager.Shutdown() })
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()

		current, err := manager.Create(ctx, session.CreateInput{
			Type:   session.TypeChat,
			Source: session.SourceCollabStage,
			Agent:  "codex",
			Model:  "test-model",
		})
		if err != nil {
			t.Fatal(err)
		}
		pool := agent.NewPool(agent.Config{Agents: []agent.Definition{{
			Name:     "codex",
			Command:  bin,
			Protocol: agent.ProtocolCodexSDK,
			Env:      map[string]string{"IDE_AGENT_SUFFIX_TEST_HELPER": "1"},
		}}})
		t.Cleanup(pool.CloseAll)

		filter := collab.NewControlStreamFilterWithDeliveryPath(docPath)
		var streamed strings.Builder
		service := &Service{Registry: &turnDiffRegistry{
			commandTestRegistry: &commandTestRegistry{root: root, manager: manager},
			pool:                pool,
		}}
		if err := service.SendMessage(ctx, SendMessageInput{
			RootID:       root.ID,
			Key:          current.Key,
			Agent:        "codex",
			Model:        "test-model",
			Content:      "run stage",
			StreamFilter: filter,
			OnUpdate: func(event agenttypes.Event) {
				if event.Type == agenttypes.EventTypeMessageChunk {
					if chunk, ok := event.Data.(agenttypes.MessageChunk); ok {
						streamed.WriteString(chunk.Content)
					}
				}
			},
		}); err != nil {
			t.Fatalf("SendMessage failed: %v", err)
		}

		wantChat := "正在执行检查，等待完成。\n\n# 实现说明\n\n已完成修改。\n\n" + wantNotice
		if streamed.String() != wantChat {
			t.Fatalf("streamed chat = %q, want %q", streamed.String(), wantChat)
		}
		if strings.Contains(filter.VisibleText(), wantNotice) {
			t.Fatalf("VisibleText leaked delivery notice: %q", filter.VisibleText())
		}
		if gotDeliv := strings.TrimSpace(filter.DeliverableText()); gotDeliv != "# 实现说明\n\n已完成修改。" {
			t.Fatalf("DeliverableText = %q, want pre-tool chatter stripped", gotDeliv)
		}
		if strings.Contains(streamed.String(), "mindfs-control") {
			t.Fatalf("control block leaked into chat: %q", streamed.String())
		}

		fresh := session.NewManager(root)
		t.Cleanup(func() { _ = fresh.Shutdown() })
		saved, err := fresh.Get(context.Background(), current.Key, 0)
		if err != nil || len(saved.Exchanges) < 2 {
			t.Fatalf("reload session: %#v err=%v", saved, err)
		}
		if got := saved.Exchanges[1].Content; got != wantChat {
			t.Fatalf("persisted agent content = %q, want %q", got, wantChat)
		}
	})

	t.Run("skips delivery path when turn is canceled", func(t *testing.T) {
		rootDir := t.TempDir()
		root := rootfs.NewRootInfo("root", "Root", rootDir)
		manager := session.NewManager(root)
		t.Cleanup(func() { _ = manager.Shutdown() })
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()

		current, err := manager.Create(ctx, session.CreateInput{
			Type:   session.TypeChat,
			Source: session.SourceCollabStage,
			Agent:  "codex",
			Model:  "test-model",
		})
		if err != nil {
			t.Fatal(err)
		}
		pool := agent.NewPool(agent.Config{Agents: []agent.Definition{{
			Name:     "codex",
			Command:  bin,
			Protocol: agent.ProtocolCodexSDK,
			Env: map[string]string{
				"IDE_AGENT_SUFFIX_TEST_HELPER": "1",
				"IDE_AGENT_SUFFIX_TEST_FAIL":   "1",
			},
		}}})
		t.Cleanup(pool.CloseAll)

		filter := collab.NewControlStreamFilterWithDeliveryPath(docPath)
		var streamed strings.Builder
		service := &Service{Registry: &turnDiffRegistry{
			commandTestRegistry: &commandTestRegistry{root: root, manager: manager},
			pool:                pool,
		}}
		err = service.SendMessage(ctx, SendMessageInput{
			RootID:              root.ID,
			Key:                 current.Key,
			Agent:               "codex",
			Model:               "test-model",
			Content:             "run canceled stage",
			ReturnErrorOnCancel: true,
			StreamFilter:        filter,
			OnUpdate: func(event agenttypes.Event) {
				if event.Type == agenttypes.EventTypeMessageChunk {
					if chunk, ok := event.Data.(agenttypes.MessageChunk); ok {
						streamed.WriteString(chunk.Content)
						if strings.Contains(streamed.String(), "已完成修改。") {
							cancel()
						}
					}
				}
			},
		})
		if err == nil {
			t.Fatal("expected ReturnErrorOnCancel=true to return context.Canceled on canceled stage turn")
		}

		if !strings.Contains(streamed.String(), "已完成修改。") {
			t.Fatalf("expected partial streamed text before cancel, got %q", streamed.String())
		}
		if strings.Contains(streamed.String(), wantNotice) {
			t.Fatalf("canceled turn must not stream delivery notice: %q", streamed.String())
		}
		fresh := session.NewManager(root)
		t.Cleanup(func() { _ = fresh.Shutdown() })
		saved, err := fresh.Get(context.Background(), current.Key, 0)
		if err != nil || len(saved.Exchanges) < 2 {
			t.Fatalf("reload session: %#v err=%v", saved, err)
		}
		if strings.Contains(saved.Exchanges[1].Content, wantNotice) {
			t.Fatalf("canceled turn must not persist delivery notice: %q", saved.Exchanges[1].Content)
		}
		if _, statErr := os.Stat(filepath.Join(rootDir, filepath.FromSlash(docPath))); !os.IsNotExist(statErr) {
			t.Fatalf("unexpected delivery file on canceled turn: %v", statErr)
		}
	})
}
