package collab

import (
	"strings"
	"sync"
	"time"
)

type meetingChunkSink interface {
	MeetingChunk(rootID, runID, turnID, attempt string, seq int, delta string)
}

type meetingLiveTurn struct {
	mu   sync.Mutex
	seq  int
	body strings.Builder
}

func (s *Service) streamMeetingText(run Run, turn MeetingTurn, live *meetingLiveTurn, delta string) {
	if delta == "" {
		return
	}
	live.mu.Lock()
	defer live.mu.Unlock()
	live.seq++
	live.body.WriteString(delta)
	if sink, ok := s.runner.(meetingChunkSink); ok {
		sink.MeetingChunk(run.RootID, run.ID, turn.ID, turn.At.Format(time.RFC3339Nano), live.seq, delta)
	}
}

func (s *Service) includeMeetingLive(run Run, round *MeetingRound) {
	for i := range round.Turns {
		turn := &round.Turns[i]
		if turn.Status != StepStatusRunning {
			continue
		}
		if item, ok := s.meetingLive.Load(workerKey(run.RootID, turn.SessionKey)); ok {
			live := item.(*meetingLiveTurn)
			live.mu.Lock()
			turn.Body, turn.LiveSeq = live.body.String(), live.seq
			live.mu.Unlock()
		}
	}
}
