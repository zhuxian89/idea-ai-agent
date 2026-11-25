package agent

import (
	"encoding/json"
	"errors"
	configpkg "mindfs/server/internal/config"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type ProbeSessionBinding struct {
	AgentSessionID string    `json:"agent_session_id"`
	ProbeCount     int       `json:"probe_count,omitempty"`
	CreatedAt      time.Time `json:"created_at,omitempty"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type probeSessionStore struct {
	mu   sync.RWMutex
	path string
	data map[string]ProbeSessionBinding
}

func loadProbeSessionStore() (*probeSessionStore, error) {
	configDir, err := configpkg.MindFSConfigDir()
	if err != nil {
		return nil, err
	}
	store := &probeSessionStore{
		path: filepath.Join(configDir, probeSessionStoreFile),
		data: make(map[string]ProbeSessionBinding),
	}
	if err := store.load(); err != nil {
		return nil, err
	}
	return store, nil
}

func (s *probeSessionStore) Get(agentName string) (ProbeSessionBinding, bool) {
	if s == nil {
		return ProbeSessionBinding{}, false
	}
	key := strings.TrimSpace(agentName)
	if key == "" {
		return ProbeSessionBinding{}, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	binding, ok := s.data[key]
	if !ok || strings.TrimSpace(binding.AgentSessionID) == "" {
		return ProbeSessionBinding{}, false
	}
	return binding, true
}

func (s *probeSessionStore) PutBinding(agentName string, binding ProbeSessionBinding) error {
	if s == nil {
		return nil
	}
	key := strings.TrimSpace(agentName)
	if key == "" {
		return errors.New("agent required")
	}
	binding.AgentSessionID = strings.TrimSpace(binding.AgentSessionID)
	if binding.AgentSessionID == "" {
		return errors.New("agent session id required")
	}
	if binding.ProbeCount <= 0 {
		binding.ProbeCount = 1
	}
	if binding.CreatedAt.IsZero() {
		binding.CreatedAt = time.Now().UTC()
	} else {
		binding.CreatedAt = binding.CreatedAt.UTC()
	}
	if binding.UpdatedAt.IsZero() {
		binding.UpdatedAt = time.Now().UTC()
	} else {
		binding.UpdatedAt = binding.UpdatedAt.UTC()
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data == nil {
		s.data = make(map[string]ProbeSessionBinding)
	}
	s.data[key] = binding
	return s.saveLocked()
}

func (s *probeSessionStore) Delete(agentName string) error {
	if s == nil {
		return nil
	}
	key := strings.TrimSpace(agentName)
	if key == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.data) == 0 {
		return nil
	}
	if _, ok := s.data[key]; !ok {
		return nil
	}
	delete(s.data, key)
	return s.saveLocked()
}

func (s *probeSessionStore) load() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	payload, err := os.ReadFile(s.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if len(strings.TrimSpace(string(payload))) == 0 {
		return nil
	}
	var data map[string]ProbeSessionBinding
	if err := json.Unmarshal(payload, &data); err != nil {
		return err
	}
	if data == nil {
		data = make(map[string]ProbeSessionBinding)
	}
	s.data = data
	return nil
}

func (s *probeSessionStore) saveLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	payload, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, append(payload, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, s.path); err != nil {
		_ = os.Remove(s.path)
		if retryErr := os.Rename(tmp, s.path); retryErr != nil {
			return err
		}
	}
	return nil
}

func loadProbeSessionBinding(store *probeSessionStore, agentName string) (ProbeSessionBinding, bool) {
	if store == nil {
		return ProbeSessionBinding{}, false
	}
	return store.Get(agentName)
}

func clearProbeSessionBinding(store *probeSessionStore, agentName string) error {
	if store == nil {
		return nil
	}
	return store.Delete(agentName)
}

func shouldRotateProbeSession(binding ProbeSessionBinding) bool {
	if binding.ProbeCount <= probeRotateAfterCount {
		return false
	}
	if binding.CreatedAt.IsZero() {
		return false
	}
	return time.Since(binding.CreatedAt.UTC()) > probeRotateAfterAge
}

func storeProbeSessionBinding(store *probeSessionStore, agentName, agentSessionID string, previous ProbeSessionBinding, resumed bool) error {
	if store == nil {
		return nil
	}
	agentSessionID = strings.TrimSpace(agentSessionID)
	if agentSessionID == "" {
		return nil
	}
	next := ProbeSessionBinding{
		AgentSessionID: agentSessionID,
		ProbeCount:     1,
		CreatedAt:      time.Now().UTC(),
		UpdatedAt:      time.Now().UTC(),
	}
	if resumed && strings.TrimSpace(previous.AgentSessionID) == agentSessionID && previous.ProbeCount > 0 {
		next.ProbeCount = previous.ProbeCount + 1
		next.CreatedAt = previous.CreatedAt
		if next.CreatedAt.IsZero() {
			next.CreatedAt = time.Now().UTC()
		}
	}
	return store.PutBinding(agentName, next)
}
