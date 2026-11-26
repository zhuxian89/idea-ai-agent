package session

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"os"
	"sort"
	"strings"
	"unicode/utf8"
)

func (m *Manager) Search(_ context.Context, opts SearchOptions) ([]SearchHit, error) {
	query := strings.TrimSpace(opts.Query)
	if query == "" {
		return []SearchHit{}, nil
	}
	limit := normalizeSearchLimit(opts.Limit)
	qLower := strings.ToLower(query)

	m.mu.Lock()
	allSessions, err := m.listSessionMetasUnsafe()
	m.mu.Unlock()
	if err != nil {
		return nil, err
	}
	collabKeys := make(map[string]bool)
	for _, item := range allSessions {
		if IsCollabSource(item.Source) {
			collabKeys[item.Key] = true
		}
	}
	sessions := make([]*Session, 0, len(allSessions))
	for _, item := range allSessions {
		if collabKeys[item.Key] || collabKeys[item.ParentSessionKey] {
			continue
		}
		sessions = append(sessions, item)
	}

	nameHits := make([]SearchHit, 0, limit)
	hitsByKey := make(map[string]SearchHit, limit)
	for _, item := range sessions {
		score := scoreSessionName(item.Name, qLower)
		if score <= 0 {
			continue
		}
		hit := buildSearchHit(item, "name", score, 0, item.Name)
		nameHits = append(nameHits, hit)
		hitsByKey[item.Key] = hit
	}
	sortSearchHits(nameHits)
	if len(nameHits) >= limit {
		return append([]SearchHit(nil), nameHits[:limit]...), nil
	}

	for _, item := range sessions {
		if len(hitsByKey) >= limit {
			break
		}
		if _, exists := hitsByKey[item.Key]; exists {
			continue
		}
		hit, ok, err := m.searchSessionContent(item, qLower)
		if err != nil {
			return nil, err
		}
		if !ok {
			continue
		}
		hitsByKey[item.Key] = hit
	}

	results := make([]SearchHit, 0, len(hitsByKey))
	for _, hit := range hitsByKey {
		results = append(results, hit)
	}
	sortSearchHits(results)
	if len(results) > limit {
		results = results[:limit]
	}
	return results, nil
}

func normalizeSearchLimit(limit int) int {
	switch {
	case limit <= 0:
		return 20
	case limit > 50:
		return 50
	default:
		return limit
	}
}

func scoreSessionName(name, qLower string) int {
	name = strings.TrimSpace(name)
	if name == "" || qLower == "" {
		return 0
	}
	nameLower := strings.ToLower(name)
	switch {
	case nameLower == qLower:
		return 120
	case strings.HasPrefix(nameLower, qLower):
		return 100
	case strings.Contains(nameLower, qLower):
		return 80
	default:
		return 0
	}
}

func buildSearchHit(s *Session, matchType string, score, seq int, snippet string) SearchHit {
	return SearchHit{
		Key:              s.Key,
		Type:             s.Type,
		ParentSessionKey: s.ParentSessionKey,
		ParentToolCallID: s.ParentToolCallID,
		Agent:            InferAgentFromSession(s),
		Model:            s.Model,
		Shell:            s.Shell,
		Name:             s.Name,
		CreatedAt:        s.CreatedAt,
		UpdatedAt:        s.UpdatedAt,
		ClosedAt:         s.ClosedAt,
		MatchType:        matchType,
		MatchScore:       score,
		Seq:              seq,
		Snippet:          strings.TrimSpace(snippet),
	}
}

func sortSearchHits(items []SearchHit) {
	sort.SliceStable(items, func(i, j int) bool {
		left := items[i]
		right := items[j]
		if left.MatchType != right.MatchType {
			return searchMatchTypeRank(left.MatchType) < searchMatchTypeRank(right.MatchType)
		}
		if left.MatchScore != right.MatchScore {
			return left.MatchScore > right.MatchScore
		}
		if !left.UpdatedAt.Equal(right.UpdatedAt) {
			return left.UpdatedAt.After(right.UpdatedAt)
		}
		return left.Key < right.Key
	})
}

func searchMatchTypeRank(matchType string) int {
	switch strings.TrimSpace(matchType) {
	case "name":
		return 0
	case "user":
		return 1
	case "reply":
		return 2
	default:
		return 3
	}
}

func (m *Manager) searchSessionContent(s *Session, qLower string) (SearchHit, bool, error) {
	path, err := m.exchangePath(s.Key)
	if err != nil {
		return SearchHit{}, false, err
	}
	file, err := m.root.OpenMetaFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return SearchHit{}, false, nil
		}
		return SearchHit{}, false, err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	best := SearchHit{}
	bestFound := false
	bestRoleUser := false
	bestPos := 0
	bestSeq := 0

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if !strings.Contains(strings.ToLower(line), qLower) {
			continue
		}
		var entry Exchange
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			continue
		}
		content := strings.TrimSpace(entry.Content)
		if content == "" {
			continue
		}
		lowerContent := strings.ToLower(content)
		pos := strings.Index(lowerContent, qLower)
		if pos < 0 {
			continue
		}
		roleUser := strings.EqualFold(strings.TrimSpace(entry.Role), "user")
		matchRunes := utf8.RuneCountInString(lowerContent[:pos])
		queryRunes := utf8.RuneCountInString(qLower)
		matchType := "reply"
		matchScore := 60
		if roleUser {
			matchType = "user"
			matchScore = 65
		}
		hit := buildSearchHit(s, matchType, matchScore, entry.Seq, buildSearchSnippet(content, matchRunes, queryRunes))
		if !bestFound || roleUser && !bestRoleUser || roleUser == bestRoleUser && (pos < bestPos || pos == bestPos && entry.Seq < bestSeq) {
			best = hit
			bestFound = true
			bestRoleUser = roleUser
			bestPos = pos
			bestSeq = entry.Seq
		}
	}
	if err := scanner.Err(); err != nil {
		return SearchHit{}, false, err
	}
	if !bestFound {
		return SearchHit{}, false, nil
	}
	return best, true, nil
}

func buildSearchSnippet(content string, matchRunes, queryRunes int) string {
	content = strings.TrimSpace(content)
	if content == "" {
		return ""
	}
	runes := []rune(content)
	start := 0
	end := len(runes)
	if matchRunes >= 0 {
		const contextBefore = 10
		const contextAfter = 18
		start = matchRunes - contextBefore
		if start < 0 {
			start = 0
		}
		end = matchRunes + queryRunes + contextAfter
		if end > len(runes) {
			end = len(runes)
		}
	}
	snippet := strings.TrimSpace(string(runes[start:end]))
	if start > 0 {
		snippet = "..." + snippet
	}
	if end < len(runes) {
		snippet += "..."
	}
	return snippet
}
