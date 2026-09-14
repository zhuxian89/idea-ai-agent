package codex

import "sync"

// Each subscriber owns an ordered backlog. Enqueue never waits for the consumer,
// so approval requests and completion events survive bursts beyond the old buffer.
// Consumed entries are cleared, and cancellation releases the entire backlog.
type appEventSubscription struct {
	out     chan appEvent
	wake    chan struct{}
	done    chan struct{}
	mu      sync.Mutex
	pending []appEvent
	stopped bool
}

func newAppEventSubscription() *appEventSubscription {
	s := &appEventSubscription{out: make(chan appEvent, appServerSubscriberBuffer), wake: make(chan struct{}, 1), done: make(chan struct{})}
	go s.run()
	return s
}

func (s *appEventSubscription) enqueue(event appEvent) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopped {
		return
	}
	s.pending = append(s.pending, event)
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

func (s *appEventSubscription) stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.stopped {
		s.stopped = true
		s.pending = nil
		close(s.done)
	}
}

func (s *appEventSubscription) run() {
	defer close(s.out)
	for {
		s.mu.Lock()
		if s.stopped {
			s.mu.Unlock()
			return
		}
		if len(s.pending) == 0 {
			s.pending = nil
			s.mu.Unlock()
			select {
			case <-s.done:
				return
			case <-s.wake:
			}
			continue
		}
		event := s.pending[0]
		s.pending[0] = appEvent{}
		s.pending = s.pending[1:]
		s.mu.Unlock()
		select {
		case <-s.done:
			return
		case s.out <- event:
		}
	}
}
