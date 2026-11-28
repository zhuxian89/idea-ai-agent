package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"unicode"

	"mindfs/server/internal/agent"
	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/commandexec"
	"mindfs/server/internal/session"
	"mindfs/server/internal/turndiff"
)

type CreateSessionInput struct {
	RootID string
	Input  session.CreateInput
}

func (s *Service) CreateSession(ctx context.Context, in CreateSessionInput) (*session.Session, error) {
	if err := s.ensureRegistry(); err != nil {
		return nil, err
	}
	manager, err := s.Registry.GetSessionManager(in.RootID)
	if err != nil {
		return nil, err
	}
	return manager.Create(ctx, in.Input)
}

type ForkSessionInput struct {
	RootID string
	Key    string
	Seq    int
}

type ForkSessionOutput struct {
	Session *session.Session
}

func (s *Service) ForkSession(ctx context.Context, in ForkSessionInput) (ForkSessionOutput, error) {
	if err := s.ensureRegistry(); err != nil {
		return ForkSessionOutput{}, err
	}
	if strings.TrimSpace(in.Key) == "" {
		return ForkSessionOutput{}, errors.New("session key required")
	}
	if in.Seq <= 0 {
		return ForkSessionOutput{}, errors.New("seq required")
	}
	root, err := s.Registry.GetRoot(in.RootID)
	if err != nil {
		return ForkSessionOutput{}, err
	}
	manager, err := s.Registry.GetSessionManager(in.RootID)
	if err != nil {
		return ForkSessionOutput{}, err
	}
	current, err := manager.Get(ctx, in.Key, 0)
	if err != nil {
		return ForkSessionOutput{}, err
	}
	target, agentTurnIndex, err := resolveForkTarget(current, in.Seq)
	if err != nil {
		return ForkSessionOutput{}, err
	}
	agentName := strings.TrimSpace(target.Agent)
	if agentName == "" {
		agentName = strings.TrimSpace(session.InferAgentFromSession(current))
	}
	if agentName == "" {
		return ForkSessionOutput{}, errors.New("agent not found for fork target")
	}
	binding, err := manager.FindAgentBinding(ctx, current.Key, agentName)
	if err != nil {
		return ForkSessionOutput{}, err
	}
	if binding == nil || strings.TrimSpace(binding.AgentSessionID) == "" {
		return ForkSessionOutput{}, errors.New("agent session binding not found")
	}
	pool := s.Registry.GetAgentPool()
	if pool == nil {
		return ForkSessionOutput{}, errors.New("agent pool not configured")
	}
	isACP := isACPAgent(pool, agentName)
	var forkPoint agenttypes.ResolveForkPointOutput
	if !isACP {
		importer, err := s.resolveExternalSessionImporter(agentName)
		if err != nil {
			return ForkSessionOutput{}, err
		}
		resolver, ok := importer.(agenttypes.ForkPointResolver)
		if !ok {
			return ForkSessionOutput{}, errors.New("agent does not support fork point resolution")
		}
		forkPoint, err = resolver.ResolveForkPointByAgentTurnIndex(ctx, agenttypes.ResolveForkPointInput{
			RootPath:       root.RootPath,
			AgentSessionID: binding.AgentSessionID,
			AgentTurnIndex: agentTurnIndex,
		})
		if err != nil {
			return ForkSessionOutput{}, err
		}
	}
	sourceJSON, err := json.Marshal(map[string]any{
		"type":             "fork",
		"session_key":      current.Key,
		"seq":              target.Seq,
		"agent":            agentName,
		"agent_session_id": binding.AgentSessionID,
	})
	if err != nil {
		return ForkSessionOutput{}, err
	}
	created, err := manager.Create(ctx, session.CreateInput{
		Type:             session.TypeChat,
		ParentSessionKey: current.Key,
		Source:           string(sourceJSON),
		Agent:            agentName,
		Model:            resolveForkModel(current, target),
		Name:             buildForkSessionName(current, target.Seq),
		PlanMode:         current.PlanMode,
	})
	if err != nil {
		return ForkSessionOutput{}, err
	}
	copiedCount, err := copyForkHistory(ctx, manager, current, created, target.Seq, agentName)
	if err != nil {
		_ = manager.Delete(ctx, created.Key)
		return ForkSessionOutput{}, err
	}
	openCtx := pool.Context()
	if openCtx == nil {
		openCtx = ctx
	}
	agentCtxSeq := copiedCount
	if isACP {
		agentCtxSeq = 0
	}
	sess, err := pool.GetOrCreate(openCtx, agenttypes.OpenSessionInput{
		SessionKey:     agentPoolSessionKey(created.Key, agentName),
		AgentName:      agentName,
		Model:          resolveForkModel(current, target),
		Mode:           strings.TrimSpace(target.Mode),
		Effort:         strings.TrimSpace(target.Effort),
		FastService:    strings.TrimSpace(target.FastService),
		PlanMode:       current.PlanMode,
		RootPath:       root.RootPath,
		AgentSessionID: "",
		AgentCtxSeq:    agentCtxSeq,
		ForkPoint:      forkPoint,
	})
	if err != nil {
		_ = manager.Delete(ctx, created.Key)
		return ForkSessionOutput{}, err
	}
	agentSessionID := strings.TrimSpace(sess.SessionID())
	if agentSessionID == "" {
		_ = manager.Delete(ctx, created.Key)
		return ForkSessionOutput{}, errors.New("forked agent session id not found")
	}
	latest, err := manager.Get(ctx, created.Key, 0)
	if err != nil {
		_ = manager.Delete(ctx, created.Key)
		return ForkSessionOutput{}, err
	}
	if err := manager.UpdateAgentState(ctx, latest, agentName, agentCtxSeq, agentSessionID); err != nil {
		_ = manager.Delete(ctx, created.Key)
		return ForkSessionOutput{}, err
	}
	out, err := manager.Get(ctx, created.Key, 0)
	if err != nil {
		return ForkSessionOutput{}, err
	}
	log.Printf("[session/fork] done root=%s parent=%s child=%s agent=%s seq=%d turn=%d source_agent_session=%s fork_agent_session=%s", strings.TrimSpace(in.RootID), current.Key, out.Key, agentName, target.Seq, agentTurnIndex, binding.AgentSessionID, agentSessionID)
	return ForkSessionOutput{Session: out}, nil
}

func isACPAgent(pool *agent.Pool, agentName string) bool {
	if pool == nil {
		return false
	}
	def, ok := pool.Config().GetAgent(agentName)
	if !ok {
		return false
	}
	protocol := def.Protocol
	if protocol == "" {
		protocol = agent.DefaultProtocol(agentName)
	}
	return protocol == agent.ProtocolACP
}

func resolveForkTarget(current *session.Session, seq int) (session.Exchange, int, error) {
	if current == nil {
		return session.Exchange{}, 0, errors.New("session required")
	}
	var target session.Exchange
	found := false
	for _, exchange := range current.Exchanges {
		if exchange.Seq == seq {
			target = exchange
			found = true
			break
		}
	}
	if !found {
		return session.Exchange{}, 0, errors.New("message not found")
	}
	if !isAgentExchangeRole(target.Role) {
		return session.Exchange{}, 0, errors.New("fork target must be an agent message")
	}
	agentName := strings.TrimSpace(target.Agent)
	if agentName == "" {
		agentName = strings.TrimSpace(session.InferAgentFromSession(current))
	}
	turnIndex := 0
	for _, exchange := range current.Exchanges {
		if exchange.Seq > target.Seq {
			break
		}
		if !isAgentExchangeRole(exchange.Role) {
			continue
		}
		exchangeAgent := strings.TrimSpace(exchange.Agent)
		if agentName != "" && exchangeAgent != "" && exchangeAgent != agentName {
			continue
		}
		turnIndex++
	}
	if turnIndex <= 0 {
		return session.Exchange{}, 0, errors.New("agent turn not found")
	}
	return target, turnIndex, nil
}

func isAgentExchangeRole(role string) bool {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "agent", "assistant":
		return true
	default:
		return false
	}
}

func resolveForkModel(current *session.Session, target session.Exchange) string {
	if model := strings.TrimSpace(target.Model); model != "" {
		return model
	}
	if current == nil {
		return ""
	}
	return strings.TrimSpace(current.Model)
}

func buildForkSessionName(current *session.Session, seq int) string {
	base := "Fork"
	if current != nil && strings.TrimSpace(current.Name) != "" {
		base = strings.TrimSpace(current.Name)
	}
	if seq > 0 {
		name := fmt.Sprintf("%s#%d", base, seq)
		runes := []rune(name)
		if len(runes) > 80 {
			name = string(runes[:80])
		}
		return name
	}
	name := base
	runes := []rune(name)
	if len(runes) > 80 {
		name = string(runes[:80])
	}
	return name
}

func copyForkHistory(ctx context.Context, manager *session.Manager, from, to *session.Session, maxSeq int, fallbackAgent string) (int, error) {
	if manager == nil || from == nil || to == nil {
		return 0, errors.New("session required")
	}
	seqMap := make(map[int]int)
	copied := 0
	for _, exchange := range from.Exchanges {
		if exchange.Seq <= 0 || exchange.Seq > maxSeq {
			continue
		}
		agentName := strings.TrimSpace(exchange.Agent)
		if agentName == "" {
			agentName = strings.TrimSpace(fallbackAgent)
		}
		if err := manager.AddExchangeForAgentAt(ctx, to, exchange.Role, exchange.Content, agentName, exchange.Mode, exchange.Effort, exchange.FastService, exchange.Timestamp); err != nil {
			return copied, err
		}
		copied++
		seqMap[exchange.Seq] = copied
	}
	auxBySeq, err := manager.GetExchangeAux(ctx, from.Key, 0)
	if err != nil {
		return copied, err
	}
	for oldSeq, items := range auxBySeq {
		newSeq := seqMap[oldSeq]
		if newSeq <= 0 {
			continue
		}
		for _, aux := range items {
			next := aux
			next.Seq = newSeq
			if err := manager.AddExchangeAux(ctx, to.Key, next); err != nil {
				return copied, err
			}
		}
	}
	return copied, nil
}

type CloseSessionInput struct {
	RootID string
	Key    string
}

func (s *Service) CloseSession(ctx context.Context, in CloseSessionInput) (*session.Session, error) {
	if err := s.ensureRegistry(); err != nil {
		return nil, err
	}
	manager, err := s.Registry.GetSessionManager(in.RootID)
	if err != nil {
		return nil, err
	}
	closed, err := manager.Close(ctx, in.Key)
	if err != nil {
		return nil, err
	}
	if pool := s.Registry.GetAgentPool(); pool != nil && closed != nil {
		for agentName := range closed.AgentCtxSeq {
			pool.Close(agentPoolSessionKey(closed.Key, agentName))
		}
	}
	s.Registry.ReleaseFileWatcher(in.RootID, in.Key)
	return closed, nil
}

type DeleteSessionInput struct {
	RootID string
	Key    string
}

func (s *Service) DeleteSession(ctx context.Context, in DeleteSessionInput) error {
	if err := s.ensureRegistry(); err != nil {
		return err
	}
	root, err := s.Registry.GetRoot(in.RootID)
	if err != nil {
		return err
	}
	manager, err := s.Registry.GetSessionManager(in.RootID)
	if err != nil {
		return err
	}
	keys, err := deleteSessionCascadeKeys(ctx, manager, in.Key)
	if err != nil {
		return err
	}
	for _, key := range keys {
		cancelActiveSessionTurn(in.RootID, key)
	}
	for _, key := range keys {
		if err := manager.Delete(ctx, key); err != nil {
			return err
		}
		if err := root.RemoveSessionFileMeta(key); err != nil {
			return err
		}
		commandexec.CloseSession(in.RootID, key)
		s.Registry.ReleaseFileWatcher(in.RootID, key)
	}
	_ = turndiff.DeleteSessionArtifacts(root.MetaDir(), keys)
	return nil
}

func deleteSessionCascadeKeys(ctx context.Context, manager *session.Manager, key string) ([]string, error) {
	rootKey := strings.TrimSpace(key)
	if rootKey == "" {
		return nil, errors.New("session key required")
	}
	items, err := manager.ListMetas(ctx)
	if err != nil {
		return nil, err
	}
	childrenByParent := make(map[string][]string)
	exists := false
	for _, item := range items {
		if item == nil {
			continue
		}
		itemKey := strings.TrimSpace(item.Key)
		if itemKey == "" {
			continue
		}
		if itemKey == rootKey {
			exists = true
		}
		parentKey := strings.TrimSpace(item.ParentSessionKey)
		if parentKey != "" {
			childrenByParent[parentKey] = append(childrenByParent[parentKey], itemKey)
		}
	}
	if !exists {
		return nil, errors.New("session not found")
	}
	keys := make([]string, 0, 1)
	seen := make(map[string]bool)
	var visit func(string)
	visit = func(current string) {
		if seen[current] {
			return
		}
		seen[current] = true
		for _, childKey := range childrenByParent[current] {
			visit(childKey)
		}
		keys = append(keys, current)
	}
	visit(rootKey)
	return keys, nil
}

func cancelActiveSessionTurn(rootID, sessionKey string) {
	active := getActiveTurn(rootID, sessionKey)
	if active == nil {
		return
	}
	active.cancel()
	if active.session != nil {
		if err := active.session.CancelCurrentTurn(); err != nil {
			log.Printf("[session] turn.cancel.error root=%s session=%s err=%v", rootID, sessionKey, err)
		}
	}
}

type RenameSessionInput struct {
	RootID string
	Key    string
	Name   string
}

func (s *Service) RenameSession(ctx context.Context, in RenameSessionInput) (*session.Session, error) {
	if err := s.ensureRegistry(); err != nil {
		return nil, err
	}
	manager, err := s.Registry.GetSessionManager(in.RootID)
	if err != nil {
		return nil, err
	}
	return manager.Rename(ctx, in.Key, in.Name)
}

type PinSessionInput struct {
	RootID string
	Key    string
	Pinned bool
}

func (s *Service) PinSession(ctx context.Context, in PinSessionInput) (*session.Session, error) {
	if err := s.ensureRegistry(); err != nil {
		return nil, err
	}
	manager, err := s.Registry.GetSessionManager(in.RootID)
	if err != nil {
		return nil, err
	}
	return manager.SetPinned(ctx, in.Key, in.Pinned)
}

func sessionNameRunner(ctx context.Context, pool *agent.Pool, rootAbs string, in SuggestSessionNameInput) (string, error) {
	agentName := strings.TrimSpace(in.Agent)
	if agentName == "" || pool == nil {
		return "", nil
	}

	tmpRoot, err := agent.EnsureStableWorkDir("title-rename", agentName)
	if err != nil {
		return "", err
	}

	sessionKey := agentPoolSessionKey("name-"+in.SessionKey, agentName)
	sess, err := pool.GetOrCreate(ctx, agenttypes.OpenSessionInput{
		SessionKey: sessionKey,
		AgentName:  agentName,
		Model:      strings.TrimSpace(in.Model),
		RootPath:   tmpRoot,
	})
	if err != nil {
		return "", err
	}
	defer pool.Close(sessionKey)

	var response strings.Builder
	sess.OnUpdate(func(update agenttypes.Event) {
		if update.Type != agenttypes.EventTypeMessageChunk {
			return
		}
		chunk, ok := update.Data.(agenttypes.MessageChunk)
		if !ok {
			return
		}
		response.WriteString(chunk.Content)
	})

	if err := sess.SendMessage(ctx, buildSessionNamePrompt(normalizeSessionNameCandidate(in.FirstMessage))); err != nil {
		return "", err
	}
	return response.String(), nil
}

func (s *Service) SuggestSessionName(ctx context.Context, in SuggestSessionNameInput) (*session.Session, error) {
	if err := s.ensureRegistry(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(in.RootID) == "" || strings.TrimSpace(in.SessionKey) == "" {
		return nil, nil
	}
	agentName := strings.TrimSpace(in.Agent)
	model := strings.TrimSpace(in.Model)
	if prefs := s.Registry.GetPreferences(); prefs != nil {
		namingDefaults := prefs.SessionNamingDefaults()
		if strings.TrimSpace(namingDefaults.Agent) != "" {
			agentName = strings.TrimSpace(namingDefaults.Agent)
			model = strings.TrimSpace(namingDefaults.Model)
		}
	}
	if agentName == "" {
		return nil, nil
	}
	in.Agent = agentName
	in.Model = model
	message := normalizeSessionNameCandidate(in.FirstMessage)
	if sessionNameScore(message) < sessionNameMinMessageLen {
		return nil, nil
	}

	manager, err := s.Registry.GetSessionManager(in.RootID)
	if err != nil {
		return nil, err
	}
	current, err := manager.Get(ctx, in.SessionKey, 0)
	if err != nil {
		return nil, err
	}
	fallback := BuildFallbackSessionName(in.FirstMessage)
	if strings.TrimSpace(current.Name) != fallback {
		return nil, nil
	}

	pool := s.Registry.GetAgentPool()
	if pool == nil {
		return nil, nil
	}

	rootAbs, err := manager.Root().RootDir()
	if err != nil {
		return nil, err
	}
	nameCtx, cancel := context.WithTimeout(ctx, sessionNameTimeout)
	defer cancel()

	rawName, err := sessionNameRunner(nameCtx, pool, rootAbs, in)
	if err != nil {
		log.Printf("[session-name] suggest.error root=%s session=%s agent=%s model=%q err=%v", in.RootID, in.SessionKey, agentName, model, err)
		return nil, nil
	}

	name := normalizeSessionNameCandidate(rawName)
	if name == "" || name == fallback {
		return nil, nil
	}
	renamed, err := manager.Rename(ctx, in.SessionKey, name)
	if err != nil {
		log.Printf("[session-name] rename.error root=%s session=%s err=%v", in.RootID, in.SessionKey, err)
		return nil, err
	}
	log.Printf("[session-name] rename.done root=%s session=%s name=%q", in.RootID, in.SessionKey, renamed.Name)
	return renamed, nil
}

func BuildFallbackSessionName(message string) string {
	oneLine := strings.Join(strings.Fields(strings.TrimSpace(message)), " ")
	if oneLine == "" {
		return ""
	}
	const max = 60
	runes := []rune(oneLine)
	if len(runes) <= max {
		return oneLine
	}
	return string(runes[:max]) + "..."
}

func buildSessionNamePrompt(message string) string {
	return strings.TrimSpace(strings.Join([]string{
		"Generate a concise session title for the user's first message.",
		"Rules:",
		"- Reply with the title only.",
		"- Single line only.",
		"- No quotes.",
		"- No trailing punctuation.",
		"- Keep it under 18 Chinese characters or 8 English words.",
		"",
		"User message:",
		message,
	}, "\n"))
}

func normalizeSessionNameCandidate(raw string) string {
	cleaned := strings.Join(strings.Fields(strings.TrimSpace(raw)), " ")
	cleaned = strings.Trim(cleaned, "\"'`“”‘’")
	cleaned = strings.TrimSpace(cleaned)
	cleaned = strings.TrimRight(cleaned, ".,;:!?，。；：！？")
	return cleaned
}

func sessionNameScore(message string) int {
	score := 0
	tokenRun := 0

	flushTokenRun := func() {
		if tokenRun == 0 {
			return
		}
		score++
		tokenRun = 0
	}

	for _, r := range message {
		switch {
		case isSessionNameTokenRune(r):
			tokenRun++
		default:
			flushTokenRun()
			if unicode.IsSpace(r) || unicode.IsPunct(r) {
				continue
			}
			score++
		}
	}
	flushTokenRun()
	return score
}

func isSessionNameTokenRune(r rune) bool {
	if r > unicode.MaxASCII {
		return false
	}
	return unicode.IsLetter(r) || unicode.IsDigit(r)
}
