package types

import (
	"context"
	"errors"
	"sync"
)

// PendingQuestion gives native cancellation and answer admission one terminal
// state. Once admitted, an answer cannot be replaced by a later cancellation.
type PendingQuestion[T any] struct {
	mu       sync.Mutex
	ctx      context.Context
	done     chan struct{}
	finished bool
	answer   T
	err      error
}

func NewPendingQuestion[T any](ctx context.Context) *PendingQuestion[T] {
	if ctx == nil {
		ctx = context.Background()
	}
	return &PendingQuestion[T]{ctx: ctx, done: make(chan struct{})}
}

func (q *PendingQuestion[T]) Answer(ctx context.Context, answer T) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.finished {
		return errors.New("question is not pending")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := q.ctx.Err(); err != nil {
		q.finish(q.answer, err)
		return err
	}
	q.finish(answer, nil)
	return nil
}

func (q *PendingQuestion[T]) Cancel(err error) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.finished {
		return false
	}
	if err == nil {
		err = context.Canceled
	}
	q.finish(q.answer, err)
	return true
}

func (q *PendingQuestion[T]) Wait() (T, error) {
	select {
	case <-q.done:
	case <-q.ctx.Done():
		q.Cancel(q.ctx.Err())
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.answer, q.err
}

// Caller holds q.mu.
func (q *PendingQuestion[T]) finish(answer T, err error) {
	q.answer, q.err, q.finished = answer, err, true
	close(q.done)
}
