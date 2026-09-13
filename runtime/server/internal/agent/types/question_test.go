package types

import (
	"context"
	"errors"
	"testing"
)

func TestQuestionCancellationAndAdmissionHaveOneOutcome(t *testing.T) {
	for _, answerFirst := range []bool{false, true} {
		ctx, cancel := context.WithCancel(context.Background())
		question := NewPendingQuestion[string](ctx)
		if !answerFirst {
			cancel()
		}
		err := question.Answer(context.Background(), "choice")
		cancel()
		answer, waitErr := question.Wait()
		if answerFirst {
			if err != nil || waitErr != nil || answer != "choice" {
				t.Fatalf("accepted answer lost: %q %v %v", answer, err, waitErr)
			}
		} else if !errors.Is(err, context.Canceled) || !errors.Is(waitErr, context.Canceled) || answer != "" {
			t.Fatalf("canceled question accepted: %q %v %v", answer, err, waitErr)
		}
	}
}
