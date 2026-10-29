package api

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
)

func TestRemoteAndIDEConcurrentMessagesReserveOneWriter(t *testing.T) {
	hub := NewStreamHub(nil)
	var starts atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, queued := hub.reserveOrQueueSessionMessage("root", "same-thread", "Chat", QueuedUserMessage{ID: fmt.Sprint(i)})
			if !queued {
				starts.Add(1)
			}
		}(i)
	}
	wg.Wait()
	if starts.Load() != 1 {
		t.Fatalf("started %d writers", starts.Load())
	}
	if _, _, ok := hub.reserveNextQueuedSessionMessage("same-thread"); ok {
		t.Fatal("started queued turn while previous writer active")
	}
	seen := map[string]bool{}
	for i := 0; i < 31; i++ {
		hub.ClearSessionPending("same-thread")
		item, _, ok := hub.reserveNextQueuedSessionMessage("same-thread")
		if !ok || seen[item.ID] {
			t.Fatal("lost or duplicated queued turn")
		}
		seen[item.ID] = true
		if _, _, ok := hub.reserveNextQueuedSessionMessage("same-thread"); ok {
			t.Fatal("double queue dispatch")
		}
	}
}
