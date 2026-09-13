package types

import "sync"

// SubscribeTurnUpdates serializes native tool callbacks with streamed output.
// Unsubscribe waits for an active callback and rejects late events, allowing
// the caller to persist the completed turn without racing a pending question.
func SubscribeTurnUpdates(session Session, handler func(Event)) func() {
	var mu sync.Mutex
	active := true
	session.OnUpdate(func(event Event) {
		mu.Lock()
		defer mu.Unlock()
		if active {
			handler(event)
		}
	})
	return func() {
		mu.Lock()
		active = false
		mu.Unlock()
	}
}
