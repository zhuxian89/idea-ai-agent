package usecase

import (
	"context"
	"crypto/sha256"
	"errors"
	"strings"
	"time"

	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/session"
)

// SessionHistoryDisplayInput identifies the session whose history display
// overrides should be computed.
type SessionHistoryDisplayInput struct {
	RootID string
	Key    string
}

// SessionHistoryDisplayOverrides computes display-only content overrides for
// persisted user exchanges that the native CLI generated as background task
// notifications (origin.kind = task-notification). The returned map is keyed
// by exchange seq; an empty override value hides the bubble while the exchange
// itself (role, seq, timestamp) stays on the wire so client caches still
// advance their maxSeq.
//
// Overrides are matched against the native source through the session's agent
// binding, by exact persisted content plus canonical timestamp, and only when
// the source unambiguously proves the notification origin. Any failure —
// missing binding, missing native file, ambiguous match — yields an error or a
// nil map, and callers must fall back to the stored content so history
// rendering never fails because of the projection.
func (s *Service) SessionHistoryDisplayOverrides(ctx context.Context, in SessionHistoryDisplayInput) (map[int]string, error) {
	if err := s.ensureRegistry(); err != nil {
		return nil, err
	}
	key := strings.TrimSpace(in.Key)
	if key == "" {
		return nil, errors.New("session key required")
	}
	root, err := s.Registry.GetRoot(in.RootID)
	if err != nil {
		return nil, err
	}
	manager, err := s.Registry.GetSessionManager(in.RootID)
	if err != nil {
		return nil, err
	}
	current, err := manager.Get(ctx, key, 0)
	if err != nil {
		return nil, err
	}
	if current == nil || !hasPersistedUserExchange(current) {
		return nil, nil
	}
	fallbackAgent := session.InferAgentFromSession(current)
	groups := make(map[string][]session.Exchange)
	for _, exchange := range current.Exchanges {
		if exchange.Seq <= 0 || !strings.EqualFold(strings.TrimSpace(exchange.Role), "user") || strings.TrimSpace(exchange.Content) == "" {
			continue
		}
		agentName := strings.TrimSpace(exchange.Agent)
		if agentName == "" {
			agentName = fallbackAgent
		}
		if agentName != "" {
			groups[agentName] = append(groups[agentName], exchange)
		}
	}
	var overrides map[int]string
	var failures []error
	for agentName, exchanges := range groups {
		binding, err := manager.FindAgentBinding(ctx, current.Key, agentName)
		if err != nil {
			failures = append(failures, err)
			continue
		}
		if binding == nil || strings.TrimSpace(binding.AgentSessionID) == "" {
			continue
		}
		importer, err := s.resolveExternalSessionImporter(agentName)
		if err != nil {
			failures = append(failures, err)
			continue
		}
		projector, ok := importer.(agenttypes.ExternalSessionDisplayProjector)
		if !ok {
			continue
		}
		projection, err := projector.ProjectExternalSessionDisplay(ctx, agenttypes.ImportExternalSessionInput{
			RootPath: root.RootPath, Agent: agentName, AgentSessionID: binding.AgentSessionID,
		})
		if err != nil {
			failures = append(failures, err)
			continue
		}
		if projection.AgentSessionID != "" && projection.AgentSessionID != binding.AgentSessionID {
			failures = append(failures, errors.New("display projection belongs to a different native session"))
			continue
		}
		for seq, display := range matchSessionDisplayOverrides(exchanges, projection) {
			if overrides == nil {
				overrides = make(map[int]string)
			}
			overrides[seq] = display
		}
	}
	return overrides, errors.Join(failures...)
}

func hasPersistedUserExchange(current *session.Session) bool {
	if current == nil {
		return false
	}
	for _, exchange := range current.Exchanges {
		if exchange.Seq > 0 && strings.EqualFold(strings.TrimSpace(exchange.Role), "user") && strings.TrimSpace(exchange.Content) != "" {
			return true
		}
	}
	return false
}

// matchSessionDisplayOverrides matches persisted exchanges against the native
// source snapshots by hashed exact content plus canonical timestamp. Snapshot
// conflicts (same content and timestamp provenance resolving to different
// display bodies) are resolved conservatively: the stored content is kept.
func matchSessionDisplayOverrides(exchanges []session.Exchange, projection agenttypes.ExternalSessionDisplayProjection) map[int]string {
	if len(projection.Users) == 0 {
		return nil
	}
	type snapshotEntry struct {
		content   string
		timestamp time.Time
		display   string
	}
	byContentHash := make(map[[sha256.Size]byte][]snapshotEntry)
	for _, snapshots := range projection.Users {
		for _, snapshot := range snapshots {
			if strings.TrimSpace(snapshot.Content) == "" {
				continue
			}
			sum := sha256.Sum256([]byte(snapshot.Content))
			byContentHash[sum] = append(byContentHash[sum], snapshotEntry{
				content:   snapshot.Content,
				timestamp: snapshot.Timestamp,
				display:   snapshot.Display,
			})
		}
	}
	var overrides map[int]string
	for _, exchange := range exchanges {
		if exchange.Seq <= 0 || !strings.EqualFold(strings.TrimSpace(exchange.Role), "user") {
			continue
		}
		if strings.TrimSpace(exchange.Content) == "" {
			continue
		}
		sum := sha256.Sum256([]byte(exchange.Content))
		entries := byContentHash[sum]
		if len(entries) == 0 {
			continue
		}
		selected := make([]snapshotEntry, 0, len(entries))
		for _, entry := range entries {
			if entry.content != exchange.Content {
				continue
			}
			switch {
			case !entry.timestamp.IsZero() && !exchange.Timestamp.IsZero():
				if entry.timestamp.Equal(exchange.Timestamp) {
					selected = append(selected, entry)
				}
			case entry.timestamp.IsZero() != exchange.Timestamp.IsZero():
				continue
			default:
				selected = append(selected, entry)
			}
		}
		if len(selected) == 0 {
			continue
		}
		display := selected[0].display
		consistent := true
		for _, entry := range selected[1:] {
			if entry.display != display {
				consistent = false
				break
			}
		}
		if !consistent || display == exchange.Content {
			continue
		}
		if overrides == nil {
			overrides = make(map[int]string)
		}
		overrides[exchange.Seq] = display
	}
	return overrides
}
