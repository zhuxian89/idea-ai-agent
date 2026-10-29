package api

import (
	"testing"
	"time"
)

func TestTurnCompletionPrecedesNextAdmission(t *testing.T) {
	for _, existingQueue := range []bool{false, true} {
		name := "new-message"
		if existingQueue {
			name = "existing-queue"
		}
		t.Run(name, func(t *testing.T) {
			hub := NewStreamHub(nil)
			app := &AppContext{streamHub: hub}
			client := deliveryTestClient(t, hub)
			hub.reserveOrQueueSessionMessage("root", "session", "Chat", QueuedUserMessage{ID: "old"})
			if existingQueue {
				hub.reserveOrQueueSessionMessage("root", "session", "Chat", QueuedUserMessage{ID: "queued"})
			}
			hub.mu.RLock()
			lock := hub.connLocks[hub.clients["sender"]]
			hub.mu.RUnlock()
			lock.Lock()
			locked := true
			defer func() {
				if locked {
					lock.Unlock()
				}
			}()
			finished := make(chan struct{})
			go func() { app.BroadcastSessionDone("root", "session", "scheduled:old"); close(finished) }()
			deadline := time.Now().Add(time.Second)
			for {
				hub.mu.RLock()
				publishing := hub.completed["session"] != nil
				hub.mu.RUnlock()
				if publishing {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("completion did not begin")
				}
				time.Sleep(time.Millisecond)
			}
			_, queued := hub.reserveOrQueueSessionMessage("root", "session", "Chat", QueuedUserMessage{ID: "new"})
			if !queued {
				t.Error("new turn started before completion was delivered")
			}
			if _, _, ok := hub.reserveNextQueuedSessionMessage("session"); ok {
				t.Error("queue started before completion was delivered")
			}
			lock.Unlock()
			locked = false
			select {
			case <-finished:
			case <-time.After(time.Second):
				t.Fatal("completion did not finish")
			}
			if got := readDeliveryMessage(t, client); got["type"] != "session.done" {
				t.Fatalf("first event: %v", got)
			}
			// Reconnection after completion must still replay its terminal state.
			hub.ReplayPending("root", "sender", "session", "")
			readDeliveryMessage(t, client) // Queue snapshot.
			if got := readDeliveryMessage(t, client); got["type"] != "session.done" {
				t.Fatalf("replay: %v", got)
			}
			item, _, ok := hub.reserveNextQueuedSessionMessage("session")
			want := "new"
			if existingQueue {
				want = "queued"
			}
			if !ok || item.ID != want {
				t.Fatalf("next item: %v, %v", item, ok)
			}
			if hub.completed["session"] != nil {
				t.Fatal("new turn retained previous completion for replay")
			}
			if _, _, ok := hub.reserveNextQueuedSessionMessage("session"); ok {
				t.Fatal("duplicate queue dispatch")
			}
		})
	}
}
