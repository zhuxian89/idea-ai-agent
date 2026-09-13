package types

import (
	"sync"
	"testing"
)

type callbackSession struct {
	Session
	callback func(Event)
}

func (s *callbackSession) OnUpdate(callback func(Event)) { s.callback = callback }

func TestTurnUpdatesSerializeAndIgnoreLateCallbacks(t *testing.T) {
	s := &callbackSession{}
	values := map[int]bool{}
	stop := SubscribeTurnUpdates(s, func(event Event) { values[event.Data.(int)] = true })
	var group sync.WaitGroup
	for i := 0; i < 100; i++ {
		group.Add(1)
		go func(value int) { defer group.Done(); s.callback(Event{Data: value}) }(i)
	}
	group.Wait()
	stop()
	s.callback(Event{Data: 101})
	if len(values) != 100 {
		t.Fatalf("received %d events; expected only active turn callbacks", len(values))
	}
}
