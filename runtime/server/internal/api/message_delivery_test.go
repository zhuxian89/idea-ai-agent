package api

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func deliveryTestClient(t *testing.T, hub *StreamHub) *websocket.Conn {
	t.Helper()
	connected := make(chan *websocket.Conn, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		hub.RegisterClient("sender", conn)
		hub.BindSessionClient("session", "sender")
		connected <- conn
	}))
	t.Cleanup(server.Close)
	client, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	remote := <-connected
	t.Cleanup(func() { client.Close(); remote.Close() })
	return client
}

func readDeliveryMessage(t *testing.T, client *websocket.Conn) map[string]any {
	t.Helper()
	client.SetReadDeadline(time.Now().Add(time.Second))
	var message map[string]any
	if err := client.ReadJSON(&message); err != nil {
		t.Fatalf("expected delivery update: %v", err)
	}
	return message
}

func assertEmptyDeliveryQueue(t *testing.T, message map[string]any) {
	t.Helper()
	if message["type"] != "session.queue.updated" {
		t.Fatalf("expected queue snapshot, got %#v", message)
	}
	payload := message["payload"].(map[string]any)
	encoded, _ := json.Marshal(payload["queue"])
	if string(encoded) != "[]" && string(encoded) != "null" {
		t.Fatalf("already dispatched message returned to queue: %s", encoded)
	}
}

func TestDeliveryReconnectClearsDrainedQueue(t *testing.T) {
	hub := NewStreamHub(nil)
	client := deliveryTestClient(t, hub)
	hub.EnqueueSessionMessage("root", "session", "Session", QueuedUserMessage{ID: "queued", PendingUserMessage: PendingUserMessage{Content: "next"}})
	hub.PopQueuedSessionMessage("session", "")
	hub.ClearSessionPending("session")
	hub.BroadcastSessionDone("root", "session", "queued")
	readDeliveryMessage(t, client)
	hub.ReplayPending("root", "sender", "session", "")
	assertEmptyDeliveryQueue(t, readDeliveryMessage(t, client))
}

func TestDeliveryLateQueueBroadcastDoesNotRestoreDispatchedMessage(t *testing.T) {
	hub := NewStreamHub(nil)
	client := deliveryTestClient(t, hub)
	stale := hub.EnqueueSessionMessage("root", "session", "Session", QueuedUserMessage{ID: "queued", PendingUserMessage: PendingUserMessage{Content: "next"}})
	_, current, _ := hub.PopQueuedSessionMessage("session", "")
	hub.BroadcastSessionQueueUpdated("root", "session", current)
	assertEmptyDeliveryQueue(t, readDeliveryMessage(t, client))
	// An enqueue handler can resume after the previous turn drained its item.
	hub.BroadcastSessionQueueUpdated("root", "session", stale)
	assertEmptyDeliveryQueue(t, readDeliveryMessage(t, client))
}

func TestDeliveryActiveMessageAlsoReachesSender(t *testing.T) {
	hub := NewStreamHub(nil)
	client := deliveryTestClient(t, hub)
	// The UI may still think the previous turn is busy and omit its optimistic bubble.
	hub.BroadcastSessionUserMessageAt("root", "session", "chat", "Session", "codex", "", "", "", "", false, "follow up", time.Now(), "sender", false)
	message := readDeliveryMessage(t, client)
	if message["type"] != "session.user_message" {
		t.Fatalf("missing authoritative user message: %#v", message)
	}
}

func TestDeliveryStalledClientCannotBlockQueueForever(t *testing.T) {
	hub := NewStreamHub(nil)
	client := deliveryTestClient(t, hub)
	remote := hub.clients["sender"]
	if err := remote.UnderlyingConn().(*net.TCPConn).SetWriteBuffer(1024); err != nil {
		t.Fatal(err)
	}
	if err := client.UnderlyingConn().(*net.TCPConn).SetReadBuffer(1024); err != nil {
		t.Fatal(err)
	}
	queue := hub.EnqueueSessionMessage("root", "session", "Session", QueuedUserMessage{ID: "queued", PendingUserMessage: PendingUserMessage{Content: strings.Repeat("x", 4<<20)}})
	done := make(chan struct{})
	go func() { hub.BroadcastSessionQueueUpdated("root", "session", queue); close(done) }()
	select {
	case <-done:
	case <-time.After(7 * time.Second):
		t.Fatal("stalled client held the queue publication lock without a write deadline")
	}
	hub.mu.RLock()
	registered := hub.clients["sender"] != nil
	hub.mu.RUnlock()
	if registered {
		t.Fatal("failed connection remained registered")
	}
	hub.PopQueuedSessionMessage("session", "")
	reconnected := deliveryTestClient(t, hub)
	hub.ReplayPending("root", "sender", "session", "")
	assertEmptyDeliveryQueue(t, readDeliveryMessage(t, reconnected))
}
