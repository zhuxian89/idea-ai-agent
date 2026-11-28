package acp

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"testing"
	"time"

	types "mindfs/server/internal/agent/types"

	acpsdk "github.com/coder/acp-go-sdk"
)

func TestACPContextWindowUsesLatestUsageUpdateNotCumulativePromptUsage(t *testing.T) {
	serverR, clientW := io.Pipe()
	clientR, serverW := io.Pipe()
	defer serverR.Close()
	defer clientW.Close()
	defer clientR.Close()
	defer serverW.Close()

	proc := &Process{
		agentName:    "antigravity",
		sessions:     map[string]*sessionState{},
		sessionsByID: map[string]*sessionState{},
	}
	st := &sessionState{ID: "acp-s1"}
	proc.sessions["k1"] = st
	proc.sessionsByID["acp-s1"] = st
	proc.client = &mindfsClient{proc: proc}
	proc.conn = acpsdk.NewClientSideConnection(proc.client, clientW, clientR)

	sess := &session{proc: proc, sessionKey: "k1"}
	var doneWindows []types.ContextWindow
	sess.OnUpdate(func(ev types.Event) {
		if ev.Type == types.EventTypeMessageDone {
			doneWindows = append(doneWindows, ev.Data.(types.MessageDone).ContextWindow)
		}
	})

	errCh := make(chan error, 1)
	go func() {
		reader := bufio.NewReader(serverR)
		writeJSON := func(v any) error {
			payload, err := json.Marshal(v)
			if err != nil {
				return err
			}
			_, err = serverW.Write(append(payload, '\n'))
			return err
		}
		line, err := reader.ReadBytes('\n')
		if err != nil {
			errCh <- err
			return
		}
		var req map[string]any
		if err := json.Unmarshal(line, &req); err != nil {
			errCh <- err
			return
		}
		for _, update := range []map[string]any{
			{"sessionUpdate": "usage_update", "used": 42000, "size": 1048576},
			{"sessionUpdate": "usage_update", "used": 128500, "size": 1048576},
			{"sessionUpdate": "usage_update", "used": 95000, "size": 1048576},
		} {
			if err := writeJSON(map[string]any{
				"jsonrpc": "2.0",
				"method":  "session/update",
				"params": map[string]any{
					"sessionId": "acp-s1",
					"update":    update,
				},
			}); err != nil {
				errCh <- err
				return
			}
		}
		// PromptResponse.usage carries cumulative billing tokens across all tool
		// calls in the turn (exceeding the 1M context window) and must never
		// overwrite current context occupancy.
		if err := writeJSON(map[string]any{
			"jsonrpc": "2.0",
			"id":      req["id"],
			"result": map[string]any{
				"stopReason": "end_turn",
				"usage": map[string]any{
					"inputTokens":  1400000,
					"outputTokens": 151196,
					"totalTokens":  1551196,
				},
			},
		}); err != nil {
			errCh <- err
			return
		}
		errCh <- nil
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := sess.SendMessage(ctx, "inspect the repository"); err != nil {
		t.Fatalf("SendMessage: %v", err)
	}
	if err := <-errCh; err != nil {
		t.Fatalf("fake ACP server: %v", err)
	}

	want := types.ContextWindow{TotalTokens: 95000, ModelContextWindow: 1048576}
	if len(doneWindows) != 1 || doneWindows[0] != want {
		t.Fatalf("doneWindows = %#v, want [%#v]", doneWindows, want)
	}
	got, err := sess.ContextWindow(ctx)
	if err != nil {
		t.Fatalf("ContextWindow: %v", err)
	}
	if got != want {
		t.Fatalf("ContextWindow = %#v, want %#v", got, want)
	}
}

func TestACPContextWindowDoesNotLeakAcrossTurns(t *testing.T) {
	serverR, clientW := io.Pipe()
	clientR, serverW := io.Pipe()
	defer serverR.Close()
	defer clientW.Close()
	defer clientR.Close()
	defer serverW.Close()

	proc := &Process{
		agentName:    "antigravity",
		sessions:     map[string]*sessionState{},
		sessionsByID: map[string]*sessionState{},
	}
	st := &sessionState{ID: "acp-s1"}
	proc.sessions["k1"] = st
	proc.sessionsByID["acp-s1"] = st
	proc.client = &mindfsClient{proc: proc}
	proc.conn = acpsdk.NewClientSideConnection(proc.client, clientW, clientR)

	sess := &session{proc: proc, sessionKey: "k1"}
	var doneWindows []types.ContextWindow
	sess.OnUpdate(func(ev types.Event) {
		if ev.Type == types.EventTypeMessageDone {
			doneWindows = append(doneWindows, ev.Data.(types.MessageDone).ContextWindow)
		}
	})

	errCh := make(chan error, 1)
	go func() {
		reader := bufio.NewReader(serverR)
		writeJSON := func(v any) error {
			payload, err := json.Marshal(v)
			if err != nil {
				return err
			}
			_, err = serverW.Write(append(payload, '\n'))
			return err
		}
		turns := []struct {
			usageUpdate map[string]any
			promptUsage map[string]any
		}{
			{
				usageUpdate: map[string]any{"sessionUpdate": "usage_update", "used": 64000, "size": 1048576},
				promptUsage: map[string]any{"inputTokens": 400000, "outputTokens": 66037, "totalTokens": 466037},
			},
			{
				usageUpdate: nil,
				promptUsage: map[string]any{"inputTokens": 500000, "outputTokens": 12000, "totalTokens": 512000},
			},
			{
				usageUpdate: map[string]any{"sessionUpdate": "usage_update", "used": 0, "size": 1048576},
				promptUsage: nil,
			},
		}
		for _, turn := range turns {
			line, err := reader.ReadBytes('\n')
			if err != nil {
				errCh <- err
				return
			}
			var req map[string]any
			if err := json.Unmarshal(line, &req); err != nil {
				errCh <- err
				return
			}
			if turn.usageUpdate != nil {
				if err := writeJSON(map[string]any{
					"jsonrpc": "2.0",
					"method":  "session/update",
					"params": map[string]any{
						"sessionId": "acp-s1",
						"update":    turn.usageUpdate,
					},
				}); err != nil {
					errCh <- err
					return
				}
			}
			result := map[string]any{"stopReason": "end_turn"}
			if turn.promptUsage != nil {
				result["usage"] = turn.promptUsage
			}
			if err := writeJSON(map[string]any{
				"jsonrpc": "2.0",
				"id":      req["id"],
				"result":  result,
			}); err != nil {
				errCh <- err
				return
			}
		}
		errCh <- nil
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	wantSessionWindows := []types.ContextWindow{
		{TotalTokens: 64000, ModelContextWindow: 1048576},
		{TotalTokens: 64000, ModelContextWindow: 1048576},
		{TotalTokens: 0, ModelContextWindow: 1048576},
	}
	for i, prompt := range []string{"turn 1", "turn 2", "turn 3"} {
		if err := sess.SendMessage(ctx, prompt); err != nil {
			t.Fatalf("SendMessage(%q): %v", prompt, err)
		}
		gotSession, err := sess.ContextWindow(ctx)
		if err != nil {
			t.Fatalf("turn %d ContextWindow: %v", i+1, err)
		}
		if gotSession != wantSessionWindows[i] {
			t.Fatalf("turn %d session ContextWindow = %#v, want %#v", i+1, gotSession, wantSessionWindows[i])
		}
	}
	if err := <-errCh; err != nil {
		t.Fatalf("fake ACP server: %v", err)
	}

	want := []types.ContextWindow{
		{TotalTokens: 64000, ModelContextWindow: 1048576},
		{},
		{TotalTokens: 0, ModelContextWindow: 1048576},
	}
	if len(doneWindows) != len(want) {
		t.Fatalf("doneWindows = %#v, want %#v", doneWindows, want)
	}
	for i := range want {
		if doneWindows[i] != want[i] {
			t.Fatalf("turn %d ContextWindow = %#v, want %#v", i+1, doneWindows[i], want[i])
		}
	}
}

func TestACPContextWindowPreservedOnPromptErrorAndCancel(t *testing.T) {
	serverR, clientW := io.Pipe()
	clientR, serverW := io.Pipe()
	defer serverR.Close()
	defer clientW.Close()
	defer clientR.Close()
	defer serverW.Close()

	proc := &Process{
		agentName:    "antigravity",
		sessions:     map[string]*sessionState{},
		sessionsByID: map[string]*sessionState{},
	}
	st := &sessionState{ID: "acp-s1"}
	proc.sessions["k1"] = st
	proc.sessionsByID["acp-s1"] = st
	proc.client = &mindfsClient{proc: proc}
	proc.conn = acpsdk.NewClientSideConnection(proc.client, clientW, clientR)

	sess := &session{proc: proc, sessionKey: "k1"}
	var doneWindows []types.ContextWindow
	sess.OnUpdate(func(ev types.Event) {
		if ev.Type == types.EventTypeMessageDone {
			doneWindows = append(doneWindows, ev.Data.(types.MessageDone).ContextWindow)
		}
	})

	cancelReached := make(chan struct{})
	cancelRelease := make(chan struct{})
	promptReqs := make(chan map[string]any, 8)
	readErrCh := make(chan error, 1)
	go func() {
		reader := bufio.NewReader(serverR)
		for {
			line, err := reader.ReadBytes('\n')
			if err != nil {
				if err != io.EOF {
					readErrCh <- err
				}
				close(promptReqs)
				return
			}
			var msg map[string]any
			if err := json.Unmarshal(line, &msg); err != nil {
				readErrCh <- err
				close(promptReqs)
				return
			}
			if msg["method"] == "session/prompt" {
				promptReqs <- msg
			}
		}
	}()

	errCh := make(chan error, 1)
	go func() {
		writeJSON := func(v any) error {
			payload, err := json.Marshal(v)
			if err != nil {
				return err
			}
			_, err = serverW.Write(append(payload, '\n'))
			return err
		}
		readReq := func() (map[string]any, error) {
			req, ok := <-promptReqs
			if !ok {
				select {
				case err := <-readErrCh:
					return nil, err
				default:
					return nil, io.EOF
				}
			}
			return req, nil
		}

		// Turn 1: succeeds with valid usage_update.
		req, err := readReq()
		if err != nil {
			errCh <- err
			return
		}
		if err := writeJSON(map[string]any{
			"jsonrpc": "2.0",
			"method":  "session/update",
			"params": map[string]any{
				"sessionId": "acp-s1",
				"update":    map[string]any{"sessionUpdate": "usage_update", "used": 64000, "size": 1048576},
			},
		}); err != nil {
			errCh <- err
			return
		}
		if err := writeJSON(map[string]any{
			"jsonrpc": "2.0",
			"id":      req["id"],
			"result":  map[string]any{"stopReason": "end_turn"},
		}); err != nil {
			errCh <- err
			return
		}

		// Turn 2: fails with RPC error before emitting any usage_update.
		req, err = readReq()
		if err != nil {
			errCh <- err
			return
		}
		if err := writeJSON(map[string]any{
			"jsonrpc": "2.0",
			"id":      req["id"],
			"error":   map[string]any{"code": -32603, "message": "backend error"},
		}); err != nil {
			errCh <- err
			return
		}

		// Turn 3: client cancels while waiting for prompt response.
		req, err = readReq()
		if err != nil {
			errCh <- err
			return
		}
		close(cancelReached)
		<-cancelRelease
		if err := writeJSON(map[string]any{
			"jsonrpc": "2.0",
			"id":      req["id"],
			"error":   map[string]any{"code": -32800, "message": "cancelled"},
		}); err != nil {
			errCh <- err
			return
		}

		// Turn 4: emits a newer usage_update, then fails with RPC error.
		req, err = readReq()
		if err != nil {
			errCh <- err
			return
		}
		if err := writeJSON(map[string]any{
			"jsonrpc": "2.0",
			"method":  "session/update",
			"params": map[string]any{
				"sessionId": "acp-s1",
				"update":    map[string]any{"sessionUpdate": "usage_update", "used": 88000, "size": 1048576},
			},
		}); err != nil {
			errCh <- err
			return
		}
		if err := writeJSON(map[string]any{
			"jsonrpc": "2.0",
			"id":      req["id"],
			"error":   map[string]any{"code": -32603, "message": "mid-turn error"},
		}); err != nil {
			errCh <- err
			return
		}

		// Turn 5: succeeds without emitting usage_update.
		req, err = readReq()
		if err != nil {
			errCh <- err
			return
		}
		if err := writeJSON(map[string]any{
			"jsonrpc": "2.0",
			"id":      req["id"],
			"result":  map[string]any{"stopReason": "end_turn"},
		}); err != nil {
			errCh <- err
			return
		}

		errCh <- nil
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Turn 1: establishes baseline snapshot.
	if err := sess.SendMessage(ctx, "turn 1"); err != nil {
		t.Fatalf("turn 1 SendMessage: %v", err)
	}
	want1 := types.ContextWindow{TotalTokens: 64000, ModelContextWindow: 1048576}
	if got, err := sess.ContextWindow(ctx); err != nil || got != want1 {
		t.Fatalf("after turn 1 ContextWindow = (%#v, %v), want (%#v, nil)", got, err, want1)
	}

	// Turn 2: RPC error must preserve previous valid session context window.
	if err := sess.SendMessage(ctx, "turn 2"); err == nil {
		t.Fatal("turn 2 expected error, got nil")
	}
	if got, err := sess.ContextWindow(ctx); err != nil || got != want1 {
		t.Fatalf("after turn 2 error ContextWindow = (%#v, %v), want (%#v, nil)", got, err, want1)
	}

	// Turn 3: context cancel must preserve previous valid session context window.
	cancelCtx, cancelTurn := context.WithCancel(ctx)
	doneTurn3 := make(chan error, 1)
	go func() {
		doneTurn3 <- sess.SendMessage(cancelCtx, "turn 3")
	}()
	<-cancelReached
	cancelTurn()
	if err := <-doneTurn3; err == nil {
		t.Fatal("turn 3 expected cancel error, got nil")
	}
	close(cancelRelease)
	if got, err := sess.ContextWindow(ctx); err != nil || got != want1 {
		t.Fatalf("after turn 3 cancel ContextWindow = (%#v, %v), want (%#v, nil)", got, err, want1)
	}

	// Turn 4: mid-turn usage_update followed by error must keep the newer snapshot.
	if err := sess.SendMessage(ctx, "turn 4"); err == nil {
		t.Fatal("turn 4 expected error, got nil")
	}
	want4 := types.ContextWindow{TotalTokens: 88000, ModelContextWindow: 1048576}
	if got, err := sess.ContextWindow(ctx); err != nil || got != want4 {
		t.Fatalf("after turn 4 mid-turn error ContextWindow = (%#v, %v), want (%#v, nil)", got, err, want4)
	}

	// Turn 5: succeeds without usage_update -> MessageDone stays empty (no stale
	// per-reply stamp), while session ContextWindow keeps latest valid snapshot.
	if err := sess.SendMessage(ctx, "turn 5"); err != nil {
		t.Fatalf("turn 5 SendMessage: %v", err)
	}
	if got, err := sess.ContextWindow(ctx); err != nil || got != want4 {
		t.Fatalf("after turn 5 ContextWindow = (%#v, %v), want (%#v, nil)", got, err, want4)
	}

	if err := <-errCh; err != nil {
		t.Fatalf("fake ACP server: %v", err)
	}

	wantDone := []types.ContextWindow{want1, {}}
	if len(doneWindows) != len(wantDone) || doneWindows[0] != wantDone[0] || doneWindows[1] != wantDone[1] {
		t.Fatalf("doneWindows = %#v, want %#v", doneWindows, wantDone)
	}
}

func TestParseACPUsageUpdateValidationAndHandlerlessRecording(t *testing.T) {
	for _, tc := range []struct {
		name   string
		update *acpsdk.SessionUsageUpdate
		want   types.ContextWindow
		ok     bool
	}{
		{"nil", nil, types.ContextWindow{}, false},
		{"negative used", &acpsdk.SessionUsageUpdate{Used: -1, Size: 1048576}, types.ContextWindow{}, false},
		{"zero size", &acpsdk.SessionUsageUpdate{Used: 1000, Size: 0}, types.ContextWindow{}, false},
		{"negative size", &acpsdk.SessionUsageUpdate{Used: 1000, Size: -10}, types.ContextWindow{}, false},
		{"zero used valid", &acpsdk.SessionUsageUpdate{Used: 0, Size: 1048576}, types.ContextWindow{TotalTokens: 0, ModelContextWindow: 1048576}, true},
		{"positive used valid", &acpsdk.SessionUsageUpdate{Used: 52000, Size: 1048576}, types.ContextWindow{TotalTokens: 52000, ModelContextWindow: 1048576}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := parseACPUsageUpdate(tc.update)
			if ok != tc.ok || got != tc.want {
				t.Fatalf("parseACPUsageUpdate(%#v) = (%#v, %v), want (%#v, %v)", tc.update, got, ok, tc.want, tc.ok)
			}
		})
	}

	proc := &Process{
		agentName:    "antigravity",
		sessions:     map[string]*sessionState{},
		sessionsByID: map[string]*sessionState{},
	}
	st := &sessionState{ID: "acp-s1"}
	proc.sessions["k1"] = st
	proc.sessionsByID["acp-s1"] = st
	client := &mindfsClient{proc: proc}

	// Recording must work even before an onUpdate callback is registered, and
	// invalid updates must not clobber a previously recorded valid snapshot.
	if err := client.SessionUpdate(context.Background(), acpsdk.SessionNotification{
		SessionId: "acp-s1",
		Update: acpsdk.SessionUpdate{
			UsageUpdate: &acpsdk.SessionUsageUpdate{Used: 77000, Size: 1048576},
		},
	}); err != nil {
		t.Fatalf("SessionUpdate(valid): %v", err)
	}
	if err := client.SessionUpdate(context.Background(), acpsdk.SessionNotification{
		SessionId: "acp-s1",
		Update: acpsdk.SessionUpdate{
			UsageUpdate: &acpsdk.SessionUsageUpdate{Used: -5, Size: 1048576},
		},
	}); err != nil {
		t.Fatalf("SessionUpdate(invalid): %v", err)
	}
	want := types.ContextWindow{TotalTokens: 77000, ModelContextWindow: 1048576}
	if got := proc.SessionContextWindow("k1"); got != want {
		t.Fatalf("SessionContextWindow = %#v, want %#v", got, want)
	}
}
