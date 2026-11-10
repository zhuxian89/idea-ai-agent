package api

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

func TestTaskStopErrorMessageExplainsATimeout(t *testing.T) {
	if got := taskStopErrorMessage(context.DeadlineExceeded); got != "the agent did not answer the stop request in time" {
		t.Fatalf("timeout message = %q", got)
	}
	if got := taskStopErrorMessage(fmt.Errorf("wrapped: %w", context.DeadlineExceeded)); got != "the agent did not answer the stop request in time" {
		t.Fatalf("wrapped timeout message = %q", got)
	}
	if got := taskStopErrorMessage(errors.New("session has no running turn")); got != "session has no running turn" {
		t.Fatalf("other errors must pass through, got %q", got)
	}
}
