package claude

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/apperr"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf16"
)

type ImporterOptions struct {
	AgentName string
}

type Importer struct {
	agentName string
	baseDir   string
	mu        sync.RWMutex
	index     map[string]claudeSessionFile
}

type claudeSessionFile struct {
	Path           string
	AgentSessionID string
	Cwd            string
	FirstUserText  string
	UpdatedAt      time.Time
}

type sessionFileCandidate struct {
	Path      string
	UpdatedAt time.Time
}

type importedExchangeLocator struct {
	agenttypes.ImportedExchange
	ClaudeLastMessageUUID string
	// Segments records each JSONL line's contribution to a merged exchange in
	// merge order. It is display-projection metadata only and never changes the
	// canonical ImportedExchange output shared with fork resolution.
	Segments []importedContentSegment
}

// importedContentSegment mirrors appendMergedClaudeExchangeLocator's merge
// order so the display projector can replay every intermediate merged state.
// Notification marks only lines the native CLI explicitly tagged with
// origin.kind = task-notification.
type importedContentSegment struct {
	Content      string
	Timestamp    time.Time
	Notification bool
}

type importedTurn struct {
	Users []importedExchangeLocator
	Agent importedExchangeLocator
}

type importedToolLocation struct {
	ExchangeIndex int
	AuxIndex      int
}

func NewImporter(opts ImporterOptions) *Importer {
	home, _ := os.UserHomeDir()
	return &Importer{
		agentName: strings.TrimSpace(opts.AgentName),
		baseDir:   filepath.Join(strings.TrimSpace(home), ".claude", "projects"),
		index:     make(map[string]claudeSessionFile),
	}
}

func (i *Importer) AgentName() string {
	return i.agentName
}

func (i *Importer) ListExternalSessions(ctx context.Context, in agenttypes.ListExternalSessionsInput) (agenttypes.ListExternalSessionsResult, error) {
	rootPath := normalizeComparablePath(in.RootPath)
	if rootPath == "" {
		return agenttypes.ListExternalSessionsResult{}, errors.New("root path required")
	}
	limit := in.Limit
	if limit <= 0 {
		limit = 20
	}
	items := make([]agenttypes.ExternalSessionSummary, 0, limit)
	err := i.ScanExternalSessions(ctx, in, func(item agenttypes.ExternalSessionSummary) (bool, error) {
		items = append(items, item)
		return len(items) < limit, nil
	})
	if err != nil {
		return agenttypes.ListExternalSessionsResult{}, err
	}
	return agenttypes.ListExternalSessionsResult{Items: items}, nil
}

func (i *Importer) ScanExternalSessions(ctx context.Context, in agenttypes.ListExternalSessionsInput, visit agenttypes.ExternalSessionVisitFunc) error {
	rootPath := normalizeComparablePath(in.RootPath)
	if rootPath == "" {
		return errors.New("root path required")
	}
	limit := in.Limit
	if limit <= 0 {
		limit = 20
	}
	files, err := i.scanSessionFiles(ctx, rootPath, in.BeforeTime, in.AfterTime, limit, visit)
	if err != nil {
		return err
	}
	i.storeSessionFiles(files)
	return nil
}

func (i *Importer) ImportExternalSession(_ context.Context, in agenttypes.ImportExternalSessionInput) (agenttypes.ImportedExternalSession, error) {
	rootPath := normalizeComparablePath(in.RootPath)
	if rootPath == "" {
		return agenttypes.ImportedExternalSession{}, errors.New("root path required")
	}
	targetID := strings.TrimSpace(in.AgentSessionID)
	if targetID == "" {
		return agenttypes.ImportedExternalSession{}, errors.New("agent session id required")
	}
	file, ok, err := i.resolveClaudeSessionFile(targetID, rootPath)
	if err != nil {
		return agenttypes.ImportedExternalSession{}, err
	}
	if !ok {
		return agenttypes.ImportedExternalSession{}, errors.New("external session not found")
	}
	return i.importSessionFile(file, in.AfterTimestamp, in.Cursor)
}

// resolveClaudeSessionFile locates the native JSONL file for one agent session
// by session id, reusing the cached index first and the regular directory scan
// as a fallback. It never hardcodes paths.
func (i *Importer) resolveClaudeSessionFile(targetID, rootPath string) (claudeSessionFile, bool, error) {
	if file, ok := i.lookupSessionFile(targetID, rootPath); ok {
		return file, true, nil
	}
	files, err := i.scanSessionFiles(context.Background(), rootPath, time.Time{}, time.Time{}, int(^uint(0)>>1), nil)
	if err != nil {
		return claudeSessionFile{}, false, err
	}
	for _, file := range files {
		if file.AgentSessionID == targetID {
			return file, true, nil
		}
	}
	return claudeSessionFile{}, false, nil
}

func (i *Importer) importSessionFile(file claudeSessionFile, after time.Time, previous agenttypes.ExternalSessionCursor) (agenttypes.ImportedExternalSession, error) {
	cursor, unchanged, err := externalSessionFileCursor(file.Path, previous)
	if err != nil {
		return agenttypes.ImportedExternalSession{}, err
	}
	if unchanged {
		return agenttypes.ImportedExternalSession{Agent: i.agentName, AgentSessionID: file.AgentSessionID, Cwd: file.Cwd, Cursor: cursor}, nil
	}
	exchanges, err := readClaudeImportedExchanges(file.Path, after)
	if err != nil {
		log.Printf("[agent/claude/importer] import session read failed session_id=%s path=%s err=%v", file.AgentSessionID, file.Path, err)
		return agenttypes.ImportedExternalSession{}, err
	}
	subagents, err := readClaudeImportedSubagents(file.Path)
	if err != nil {
		log.Printf("[agent/claude/importer] import subagents failed session_id=%s path=%s err=%v", file.AgentSessionID, file.Path, err)
		return agenttypes.ImportedExternalSession{}, err
	}
	return agenttypes.ImportedExternalSession{
		Agent:          i.agentName,
		AgentSessionID: file.AgentSessionID,
		Cwd:            file.Cwd,
		Exchanges:      exchanges,
		Subagents:      subagents,
		Cursor:         cursor,
	}, nil
}

func externalSessionFileCursor(path string, previous agenttypes.ExternalSessionCursor) (agenttypes.ExternalSessionCursor, bool, error) {
	info, err := os.Stat(path)
	if err != nil {
		return agenttypes.ExternalSessionCursor{}, false, err
	}
	cursor := agenttypes.ExternalSessionCursor{SourcePath: filepath.Clean(path), Offset: info.Size(), ModTimeUnixNano: info.ModTime().UnixNano()}
	unchanged := previous.Offset > 0 && filepath.Clean(previous.SourcePath) == cursor.SourcePath && previous.Offset == cursor.Offset && previous.ModTimeUnixNano == cursor.ModTimeUnixNano
	return cursor, unchanged, nil
}

type claudeSubagentRelation struct {
	AgentID          string
	ParentAgentID    string
	ParentToolCallID string
	Title            string
	Model            string
}

func (i *Importer) scanSessionFiles(ctx context.Context, rootPath string, before, after time.Time, limit int, visit agenttypes.ExternalSessionVisitFunc) ([]claudeSessionFile, error) {
	if strings.TrimSpace(i.baseDir) == "" {
		return nil, nil
	}
	dir := i.projectDir(rootPath)
	if strings.TrimSpace(dir) == "" {
		return nil, nil
	}
	info, err := os.Stat(dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, apperr.Wrap("stat", dir, err)
	}
	if !info.IsDir() {
		return nil, nil
	}
	if limit <= 0 {
		limit = 20
	}
	items := make([]claudeSessionFile, 0)
	paths, err := sortedSessionJSONLFiles(dir)
	if err != nil {
		return nil, err
	}
	for _, candidate := range paths {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if !before.IsZero() && !candidate.UpdatedAt.Before(before) {
			continue
		}
		if !after.IsZero() && !candidate.UpdatedAt.After(after) {
			break
		}
		item, ok, err := inspectClaudeSessionFile(candidate.Path)
		if err != nil {
			if apperr.IsPermission(err) {
				return nil, err
			}
			log.Printf("[agent/claude/importer] inspect session file failed path=%s err=%v", candidate.Path, err)
			continue
		}
		if !ok {
			continue
		}
		if visit != nil {
			shouldContinue, err := visit(agenttypes.ExternalSessionSummary{
				Agent:          i.agentName,
				AgentSessionID: item.AgentSessionID,
				Cwd:            item.Cwd,
				FirstUserText:  item.FirstUserText,
				UpdatedAt:      item.UpdatedAt,
			})
			if err != nil {
				return nil, err
			}
			items = append(items, item)
			if !shouldContinue {
				return items, nil
			}
			continue
		}
		items = appendSortedClaudeSession(items, item)
		if len(items) > limit {
			items = items[:limit]
		}
	}
	i.storeSessionFiles(items)
	return items, nil
}

func sortedSessionJSONLFiles(baseDir string) ([]sessionFileCandidate, error) {
	items := make([]sessionFileCandidate, 0)
	err := filepath.WalkDir(baseDir, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			if apperr.IsPermission(walkErr) {
				return apperr.Wrap("walk", path, walkErr)
			}
			return nil
		}
		if d == nil || d.IsDir() || filepath.Ext(path) != ".jsonl" {
			return nil
		}
		if isClaudeSubagentSessionFile(baseDir, path) {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			if apperr.IsPermission(err) {
				return apperr.Wrap("stat", path, err)
			}
			return nil
		}
		items = append(items, sessionFileCandidate{
			Path:      path,
			UpdatedAt: info.ModTime().UTC(),
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(items, func(i, j int) bool {
		if !items[i].UpdatedAt.Equal(items[j].UpdatedAt) {
			return items[i].UpdatedAt.After(items[j].UpdatedAt)
		}
		return items[i].Path > items[j].Path
	})
	return items, nil
}

func isClaudeSubagentSessionFile(baseDir, path string) bool {
	rel, err := filepath.Rel(baseDir, path)
	if err != nil {
		return false
	}
	for _, part := range strings.Split(rel, string(os.PathSeparator)) {
		if part == "subagents" {
			return true
		}
	}
	return false
}

func (i *Importer) projectDir(rootPath string) string {
	dirName := claudeProjectDirName(rootPath)
	if dirName == "" {
		return ""
	}
	return filepath.Join(i.baseDir, dirName)
}

func claudeProjectDirName(rootPath string) string {
	rootPath = normalizeComparablePath(rootPath)
	if rootPath == "" {
		return ""
	}
	return sanitizeClaudeProjectPath(rootPath)
}

const claudeProjectDirMaxLength = 200

// sanitizeClaudeProjectPath mirrors Claude Code's JavaScript project-directory
// encoding. Replacement and truncation operate on UTF-16 code units, not
// Unicode code points; long names include a base-36 hash of the original path.
func sanitizeClaudeProjectPath(path string) string {
	units := utf16.Encode([]rune(path))
	encodedLength := min(len(units), claudeProjectDirMaxLength)

	var b strings.Builder
	b.Grow(encodedLength)
	for _, unit := range units[:encodedLength] {
		if (unit >= 'a' && unit <= 'z') || (unit >= 'A' && unit <= 'Z') || (unit >= '0' && unit <= '9') {
			b.WriteByte(byte(unit))
		} else {
			b.WriteByte('-')
		}
	}
	if len(units) > claudeProjectDirMaxLength {
		b.WriteByte('-')
		b.WriteString(claudeProjectPathHash(units))
	}
	return b.String()
}

func claudeProjectPathHash(units []uint16) string {
	var hash uint32
	for _, unit := range units {
		// JavaScript: hash = ((hash << 5) - hash + charCodeAt(i)) | 0
		hash = hash*31 + uint32(unit)
	}
	signed := int64(int32(hash))
	if signed < 0 {
		signed = -signed
	}
	return strconv.FormatInt(signed, 36)
}

func (i *Importer) storeSessionFiles(items []claudeSessionFile) {
	i.mu.Lock()
	defer i.mu.Unlock()
	for _, item := range items {
		if strings.TrimSpace(item.AgentSessionID) == "" {
			continue
		}
		i.index[item.AgentSessionID] = item
	}
}

func (i *Importer) lookupSessionFile(sessionID, rootPath string) (claudeSessionFile, bool) {
	i.mu.RLock()
	defer i.mu.RUnlock()
	item, ok := i.index[strings.TrimSpace(sessionID)]
	if !ok {
		return claudeSessionFile{}, false
	}
	if normalizeComparablePath(item.Cwd) != normalizeComparablePath(rootPath) {
		return claudeSessionFile{}, false
	}
	return item, true
}

func inspectClaudeSessionFile(path string) (claudeSessionFile, bool, error) {
	file, err := os.Open(path)
	if err != nil {
		return claudeSessionFile{}, false, apperr.Wrap("open", path, err)
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return claudeSessionFile{}, false, err
	}
	var sessionID, cwd, firstUserText string
	err = forEachJSONLLine(file, func(line string) error {
		line = strings.TrimSpace(line)
		if line == "" {
			return nil
		}
		var raw map[string]any
		if err := json.Unmarshal([]byte(line), &raw); err != nil {
			return nil
		}
		if sessionID == "" {
			sessionID = strings.TrimSpace(asString(raw["sessionId"]))
		}
		if cwd == "" {
			candidate := normalizeComparablePath(asString(raw["cwd"]))
			if candidate != "" {
				cwd = candidate
			}
		}
		if firstUserText == "" && strings.EqualFold(asString(raw["type"]), "user") {
			if message, _ := raw["message"].(map[string]any); message != nil {
				if text := extractClaudeUserPreview(message["content"]); text != "" {
					firstUserText = text
				}
			}
		}
		if sessionID != "" && cwd != "" && firstUserText != "" {
			return errStopJSONL
		}
		return nil
	})
	if err != nil && !errors.Is(err, errStopJSONL) {
		return claudeSessionFile{}, false, err
	}
	if sessionID == "" || cwd == "" {
		return claudeSessionFile{}, false, nil
	}
	return claudeSessionFile{
		Path:           path,
		AgentSessionID: sessionID,
		Cwd:            cwd,
		FirstUserText:  firstUserText,
		UpdatedAt:      info.ModTime().UTC(),
	}, true, nil
}

func readClaudeImportedExchanges(path string, after time.Time) ([]agenttypes.ImportedExchange, error) {
	locators, err := readClaudeImportedExchangeLocators(path, after)
	if err != nil {
		return nil, err
	}
	items := make([]agenttypes.ImportedExchange, 0, len(locators))
	for _, item := range locators {
		items = append(items, item.ImportedExchange)
	}
	return items, nil
}

func readClaudeImportedExchangeLocators(path string, after time.Time) ([]importedExchangeLocator, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, apperr.Wrap("open", path, err)
	}
	defer file.Close()

	items := make([]importedExchangeLocator, 0)
	toolLocations := make(map[string]importedToolLocation)
	err = forEachJSONLLine(file, func(line string) error {
		line = strings.TrimSpace(line)
		if line == "" {
			return nil
		}
		var raw map[string]any
		if err := json.Unmarshal([]byte(line), &raw); err != nil {
			return nil
		}
		role := strings.ToLower(strings.TrimSpace(asString(raw["type"])))
		if role == "permission_denied" || (role == "system" && asString(raw["subtype"]) == "permission_denied") {
			importedClaudePermissionDenied(items, toolLocations, raw)
			return nil
		}
		if role != "user" && role != "assistant" {
			return nil
		}
		uuid := strings.TrimSpace(asString(raw["uuid"]))
		message, _ := raw["message"].(map[string]any)
		if message == nil {
			return nil
		}
		ts := parseTimeRFC3339(asString(raw["timestamp"]))
		if role == "user" {
			applyClaudeToolResults(items, toolLocations, message["content"], raw["toolUseResult"], ts)
			text := extractClaudeImportedUserText(message["content"])
			if text != "" && isMeaningfulClaudeUserText(text) {
				items, _, _ = appendMergedClaudeExchangeLocator(items, "user", text, ts, uuid, nil, importedContentSegment{
					Content:      text,
					Timestamp:    ts,
					Notification: isClaudeTaskNotificationLine(raw),
				})
			}
			return nil
		}
		text := strings.TrimSpace(extractClaudeMessageText(message["content"]))
		aux := mergeImportedClaudeTools(items, toolLocations, extractClaudeToolUseAux(message["content"]), strings.TrimSpace(asString(raw["parent_tool_use_id"])))
		if text == "" && len(aux) == 0 {
			return nil
		}
		var exchangeIndex, auxStart int
		items, exchangeIndex, auxStart = appendMergedClaudeExchangeLocator(
			items,
			"agent",
			text,
			ts,
			uuid,
			aux,
			importedContentSegment{},
		)
		for index := auxStart; index < len(items[exchangeIndex].Aux); index++ {
			toolCall := items[exchangeIndex].Aux[index].ToolCall
			if toolCall == nil || strings.TrimSpace(toolCall.CallID) == "" {
				continue
			}
			toolLocations[strings.TrimSpace(toolCall.CallID)] = importedToolLocation{
				ExchangeIndex: exchangeIndex,
				AuxIndex:      index,
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if after.IsZero() {
		return items, nil
	}
	filtered := make([]importedExchangeLocator, 0, len(items))
	for _, item := range items {
		if item.Timestamp.IsZero() || !item.Timestamp.After(after) {
			continue
		}
		filtered = append(filtered, item)
	}
	return filtered, nil
}

var errStopJSONL = errors.New("stop jsonl")

func forEachJSONLLine(file *os.File, fn func(string) error) error {
	reader := bufio.NewReader(file)
	for {
		line, err := reader.ReadBytes('\n')
		if len(line) > 0 {
			if callErr := fn(string(line)); callErr != nil {
				return callErr
			}
		}
		if err == nil {
			continue
		}
		if errors.Is(err, io.EOF) {
			return nil
		}
		return err
	}
}

// claudeUserDisplaySnapshots replays the merge rule over the line-level
// segments of one canonical user exchange and records each intermediate state.
// Display content drops only segments whose source line was proven to be a
// native task notification; segments without an explicit notification origin
// are always kept.
func claudeUserDisplaySnapshots(segments []importedContentSegment) []agenttypes.ExternalSessionDisplaySnapshot {
	snapshots := make([]agenttypes.ExternalSessionDisplaySnapshot, 0, len(segments))
	kept := make([]string, 0, len(segments))
	merged := make([]string, 0, len(segments))
	timestamp := time.Time{}
	for _, segment := range segments {
		if strings.TrimSpace(segment.Content) == "" {
			continue
		}
		merged = append(merged, segment.Content)
		if !segment.Notification {
			kept = append(kept, segment.Content)
		}
		if !segment.Timestamp.IsZero() {
			timestamp = segment.Timestamp
		}
		snapshots = append(snapshots, agenttypes.ExternalSessionDisplaySnapshot{
			Content:   strings.TrimSpace(strings.Join(merged, "\n\n")),
			Timestamp: timestamp,
			Display:   strings.TrimSpace(strings.Join(kept, "\n\n")),
		})
	}
	return snapshots
}

func buildImportedTurns(items []importedExchangeLocator) []importedTurn {
	turns := make([]importedTurn, 0)
	users := make([]importedExchangeLocator, 0)
	for _, item := range items {
		switch item.Role {
		case "user":
			users = append(users, item)
		case "agent":
			turns = append(turns, importedTurn{
				Users: append([]importedExchangeLocator(nil), users...),
				Agent: item,
			})
			users = nil
		}
	}
	return turns
}

func appendSortedClaudeSession(items []claudeSessionFile, item claudeSessionFile) []claudeSessionFile {
	idx := sort.Search(len(items), func(i int) bool {
		return compareClaudeSessionFile(item, items[i]) < 0
	})
	items = append(items, claudeSessionFile{})
	copy(items[idx+1:], items[idx:])
	items[idx] = item
	return items
}

func compareClaudeSessionFile(left, right claudeSessionFile) int {
	if left.UpdatedAt.After(right.UpdatedAt) {
		return -1
	}
	if left.UpdatedAt.Before(right.UpdatedAt) {
		return 1
	}
	switch {
	case left.AgentSessionID > right.AgentSessionID:
		return -1
	case left.AgentSessionID < right.AgentSessionID:
		return 1
	default:
		return 0
	}
}

func normalizeComparablePath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	clean := filepath.Clean(path)
	if resolved, err := filepath.EvalSymlinks(clean); err == nil && strings.TrimSpace(resolved) != "" {
		clean = resolved
	}
	if abs, err := filepath.Abs(clean); err == nil {
		clean = abs
	}
	return filepath.Clean(clean)
}

func parseTimeRFC3339(raw string) time.Time {
	if raw == "" {
		return time.Time{}
	}
	parsed, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		return time.Time{}
	}
	return parsed.UTC()
}

func asString(v any) string {
	s, _ := v.(string)
	return s
}
