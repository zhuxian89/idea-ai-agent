package collab

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"mindfs/server/internal/agent"
	"mindfs/server/internal/config"
)

const (
	templatesFileName      = "collab-templates.json"
	templatesSchemaVersion = 1

	ModeQuick = "quick"
	ModeGroup = "group"

	RolePrimary  = "primary"
	RoleReviewer = "reviewer"
	RoleMember   = "member"
)

type MemberSlot struct {
	SlotID         string `json:"slot_id"`
	Role           string `json:"role"`
	Agent          string `json:"agent"`
	Model          string `json:"model,omitempty"`
	Effort         string `json:"effort,omitempty"`
	PermissionMode string `json:"permission_mode,omitempty"`
}

type Template struct {
	ID                string       `json:"id"`
	Name              string       `json:"name"`
	Mode              string       `json:"mode"`
	IsDefault         bool         `json:"is_default,omitempty"`
	Members           []MemberSlot `json:"members"`
	SkillPaths        []string     `json:"skill_paths,omitempty"`
	FinalAuthorSlotID string       `json:"final_author_slot_id,omitempty"`
	MaxRounds         int          `json:"max_rounds,omitempty"`
	CreatedAt         string       `json:"created_at"`
	UpdatedAt         string       `json:"updated_at"`
}

type TemplateSnapshot struct {
	TemplateID        string       `json:"template_id,omitempty"`
	TemplateName      string       `json:"template_name,omitempty"`
	Mode              string       `json:"mode"`
	Members           []MemberSlot `json:"members"`
	SkillPaths        []string     `json:"skill_paths,omitempty"`
	FinalAuthorSlotID string       `json:"final_author_slot_id,omitempty"`
	MaxRounds         int          `json:"max_rounds,omitempty"`
}

type MemberAvailability struct {
	SlotID    string `json:"slot_id"`
	Role      string `json:"role"`
	Agent     string `json:"agent"`
	Model     string `json:"model,omitempty"`
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}

type templatesFile struct {
	Version int        `json:"version"`
	Items   []Template `json:"items"`
}

type TemplateStore struct {
	mu   sync.RWMutex
	path string
	now  func() time.Time
}

func NewTemplateStore() (*TemplateStore, error) {
	configDir, err := config.MindFSConfigDir()
	if err != nil {
		return nil, err
	}
	return NewTemplateStoreAt(filepath.Join(configDir, templatesFileName))
}

func NewTemplateStoreAt(path string) (*TemplateStore, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("template store path required")
	}
	store := &TemplateStore{
		path: path,
		now:  time.Now,
	}
	if _, err := store.loadAndMigrate(); err != nil {
		return nil, err
	}
	return store, nil
}

func (s *TemplateStore) List(mode string) ([]Template, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	file, err := s.readUnlocked()
	if err != nil {
		return nil, err
	}
	filterMode := strings.TrimSpace(mode)
	out := make([]Template, 0, len(file.Items))
	for _, item := range file.Items {
		if filterMode != "" && item.Mode != filterMode {
			continue
		}
		out = append(out, cloneTemplate(item))
	}
	return out, nil
}

func (s *TemplateStore) Get(id string) (Template, bool, error) {
	trimmed := strings.TrimSpace(id)
	if trimmed == "" {
		return Template{}, false, nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	file, err := s.readUnlocked()
	if err != nil {
		return Template{}, false, err
	}
	for _, item := range file.Items {
		if item.ID == trimmed {
			return cloneTemplate(item), true, nil
		}
	}
	return Template{}, false, nil
}

func (s *TemplateStore) Save(input Template) (Template, error) {
	normalized, err := normalizeAndValidateTemplate(input, s.now().UTC())
	if err != nil {
		return Template{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.readUnlocked()
	if err != nil {
		return Template{}, err
	}
	replaced := false
	for i := range file.Items {
		if file.Items[i].ID == normalized.ID {
			if strings.TrimSpace(file.Items[i].CreatedAt) != "" {
				normalized.CreatedAt = file.Items[i].CreatedAt
			}
			file.Items[i] = normalized
			replaced = true
			break
		}
	}
	if !replaced {
		file.Items = append(file.Items, normalized)
	}
	if normalized.IsDefault {
		for i := range file.Items {
			if file.Items[i].Mode == normalized.Mode && file.Items[i].ID != normalized.ID {
				file.Items[i].IsDefault = false
			}
		}
	} else {
		hasModeDefault := false
		for _, item := range file.Items {
			if item.Mode == normalized.Mode && item.IsDefault {
				hasModeDefault = true
				break
			}
		}
		if !hasModeDefault {
			for i := range file.Items {
				if file.Items[i].ID == normalized.ID {
					file.Items[i].IsDefault = true
					normalized.IsDefault = true
					break
				}
			}
		}
	}
	file.Version = templatesSchemaVersion
	if err := s.writeUnlocked(file); err != nil {
		return Template{}, err
	}
	return cloneTemplate(normalized), nil
}

func (s *TemplateStore) Delete(id string) error {
	trimmed := strings.TrimSpace(id)
	if trimmed == "" {
		return errors.New("template id required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.readUnlocked()
	if err != nil {
		return err
	}
	next := make([]Template, 0, len(file.Items))
	removed := false
	for _, item := range file.Items {
		if item.ID == trimmed {
			removed = true
			continue
		}
		next = append(next, item)
	}
	if !removed {
		return errors.New("template not found")
	}
	file.Items = next
	file.Version = templatesSchemaVersion
	return s.writeUnlocked(file)
}

func (s *TemplateStore) loadAndMigrate() (templatesFile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	raw, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return templatesFile{Version: templatesSchemaVersion, Items: []Template{}}, nil
		}
		return templatesFile{}, err
	}
	if strings.TrimSpace(string(raw)) == "" {
		return templatesFile{Version: templatesSchemaVersion, Items: []Template{}}, nil
	}
	parsed, migrated, err := decodeTemplatesPayload(raw, s.now().UTC())
	if err != nil {
		return templatesFile{}, err
	}
	if migrated {
		if err := s.writeUnlocked(parsed); err != nil {
			return templatesFile{}, err
		}
	}
	return parsed, nil
}

func (s *TemplateStore) readUnlocked() (templatesFile, error) {
	raw, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return templatesFile{Version: templatesSchemaVersion, Items: []Template{}}, nil
		}
		return templatesFile{}, err
	}
	if strings.TrimSpace(string(raw)) == "" {
		return templatesFile{Version: templatesSchemaVersion, Items: []Template{}}, nil
	}
	parsed, _, err := decodeTemplatesPayload(raw, s.now().UTC())
	return parsed, err
}

func decodeTemplatesPayload(raw []byte, now time.Time) (templatesFile, bool, error) {
	var wrapped templatesFile
	if err := json.Unmarshal(raw, &wrapped); err == nil && (wrapped.Version > 0 || wrapped.Items != nil) {
		migrated := wrapped.Version < templatesSchemaVersion
		for i := range wrapped.Items {
			norm, normErr := normalizeLegacyTemplate(wrapped.Items[i], now)
			if normErr != nil {
				return templatesFile{}, false, normErr
			}
			wrapped.Items[i] = norm
		}
		wrapped.Version = templatesSchemaVersion
		if wrapped.Items == nil {
			wrapped.Items = []Template{}
		}
		return wrapped, migrated, nil
	}

	// Support upgrading a legacy bare JSON array of templates idempotently.
	var bare []Template
	if err := json.Unmarshal(raw, &bare); err != nil {
		return templatesFile{}, false, err
	}
	items := make([]Template, 0, len(bare))
	for _, item := range bare {
		norm, normErr := normalizeLegacyTemplate(item, now)
		if normErr != nil {
			return templatesFile{}, false, normErr
		}
		items = append(items, norm)
	}
	return templatesFile{
		Version: templatesSchemaVersion,
		Items:   items,
	}, true, nil
}

func (s *TemplateStore) writeUnlocked(file templatesFile) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	file.Version = templatesSchemaVersion
	if file.Items == nil {
		file.Items = []Template{}
	}
	payload, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, payload, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, s.path); err != nil {
		_ = os.Remove(s.path)
		if retryErr := os.Rename(tmp, s.path); retryErr != nil {
			_ = os.Remove(tmp)
			return err
		}
	}
	return nil
}

func normalizeLegacyTemplate(item Template, now time.Time) (Template, error) {
	if strings.TrimSpace(item.Mode) == "" {
		item.Mode = ModeQuick
	}
	if strings.TrimSpace(item.ID) == "" {
		item.ID = newCollabID("tpl")
	}
	if strings.TrimSpace(item.Name) == "" {
		item.Name = "未命名模板"
	}
	ts := now.Format(time.RFC3339Nano)
	if strings.TrimSpace(item.CreatedAt) == "" {
		item.CreatedAt = ts
	}
	if strings.TrimSpace(item.UpdatedAt) == "" {
		item.UpdatedAt = item.CreatedAt
	}
	for i := range item.Members {
		item.Members[i].SlotID = strings.TrimSpace(item.Members[i].SlotID)
		item.Members[i].Role = strings.TrimSpace(item.Members[i].Role)
		item.Members[i].Agent = strings.TrimSpace(item.Members[i].Agent)
		item.Members[i].Model = strings.TrimSpace(item.Members[i].Model)
		item.Members[i].Effort = strings.TrimSpace(item.Members[i].Effort)
		item.Members[i].PermissionMode = strings.TrimSpace(item.Members[i].PermissionMode)
		if item.Members[i].SlotID == "" {
			if item.Members[i].Role != "" {
				item.Members[i].SlotID = fmt.Sprintf("%s-%d", item.Members[i].Role, i+1)
			} else {
				item.Members[i].SlotID = fmt.Sprintf("slot-%d", i+1)
			}
		}
	}
	item.SkillPaths = dedupeStrings(item.SkillPaths)
	return item, nil
}

func normalizeAndValidateTemplate(input Template, now time.Time) (Template, error) {
	out, err := normalizeLegacyTemplate(input, now)
	if err != nil {
		return Template{}, err
	}
	out.Name = strings.TrimSpace(input.Name)
	if out.Name == "" {
		return Template{}, errors.New("模板名称不能为空")
	}
	switch out.Mode {
	case ModeQuick:
		if len(out.Members) != 2 {
			return Template{}, errors.New("快速模式模板必须包含主模型与审核模型两个槽位")
		}
		hasPrimary := false
		hasReviewer := false
		for i := range out.Members {
			if out.Members[i].Agent == "" {
				return Template{}, errors.New("每个成员都必须指定原生 Agent 标识")
			}
			switch out.Members[i].Role {
			case RolePrimary:
				out.Members[i].SlotID = "primary"
				hasPrimary = true
			case RoleReviewer:
				out.Members[i].SlotID = "reviewer"
				out.Members[i].PermissionMode = ""
				hasReviewer = true
			}
		}
		if !hasPrimary || !hasReviewer {
			return Template{}, errors.New("快速模式模板必须分别指定 primary 和 reviewer 角色")
		}
	case ModeGroup:
		if len(out.Members) < 2 {
			return Template{}, errors.New("群组讨论模板至少需要 2 个成员槽位")
		}
		seenSlot := make(map[string]bool, len(out.Members))
		for i := range out.Members {
			if out.Members[i].Agent == "" {
				return Template{}, errors.New("每个成员都必须指定原生 Agent 标识")
			}
			if out.Members[i].Role == "" {
				out.Members[i].Role = RoleMember
			}
			if seenSlot[out.Members[i].SlotID] {
				out.Members[i].SlotID = fmt.Sprintf("slot-%d", i+1)
			}
			seenSlot[out.Members[i].SlotID] = true
		}
		if out.MaxRounds <= 0 {
			out.MaxRounds = 3
		}
		if out.MaxRounds > 5 {
			out.MaxRounds = 5
		}
	default:
		return Template{}, fmt.Errorf("不支持的协作模式：%s", out.Mode)
	}
	out.UpdatedAt = now.Format(time.RFC3339Nano)
	return out, nil
}

// SnapshotTemplate copies member and skill settings into an immutable run snapshot
// so future edits or deletions of the global template never alter past runs.
func SnapshotTemplate(tpl Template) TemplateSnapshot {
	cloned := cloneTemplate(tpl)
	return TemplateSnapshot{
		TemplateID:        cloned.ID,
		TemplateName:      cloned.Name,
		Mode:              cloned.Mode,
		Members:           cloned.Members,
		SkillPaths:        cloned.SkillPaths,
		FinalAuthorSlotID: cloned.FinalAuthorSlotID,
		MaxRounds:         cloned.MaxRounds,
	}
}

// ValidateMembers checks whether each member's native CLI agent and model are
// currently available, without ever substituting another model silently.
func ValidateMembers(members []MemberSlot, statuses []agent.Status) []MemberAvailability {
	byAgent := make(map[string]agent.Status, len(statuses))
	for _, st := range statuses {
		byAgent[strings.TrimSpace(st.Name)] = st
	}
	out := make([]MemberAvailability, 0, len(members))
	for _, member := range members {
		agentID := strings.TrimSpace(member.Agent)
		modelID := strings.TrimSpace(member.Model)
		item := MemberAvailability{
			SlotID: member.SlotID,
			Role:   member.Role,
			Agent:  agentID,
			Model:  modelID,
		}
		st, found := byAgent[agentID]
		if !found {
			item.Available = false
			item.Reason = fmt.Sprintf("未配置的 Agent：%s", agentID)
			out = append(out, item)
			continue
		}
		if !st.Installed {
			item.Available = false
			item.Reason = fmt.Sprintf("Agent %s 未安装", agentID)
			out = append(out, item)
			continue
		}
		if !st.Available {
			reason := fmt.Sprintf("Agent %s 当前不可用", agentID)
			if strings.TrimSpace(st.Error) != "" {
				reason += "：" + strings.TrimSpace(st.Error)
			}
			item.Available = false
			item.Reason = reason
			out = append(out, item)
			continue
		}
		if modelID != "" && len(st.Models) > 0 {
			matched := false
			for _, m := range st.Models {
				if strings.TrimSpace(m.ID) == modelID {
					matched = true
					break
				}
			}
			if !matched {
				item.Available = false
				item.Reason = fmt.Sprintf("模型 %s 不在 %s 当前可用列表中（请手动重选，系统不会自动替换）", modelID, agentID)
				out = append(out, item)
				continue
			}
		}
		if member.PermissionMode != "" && len(st.Modes) > 0 {
			matched := false
			for _, mode := range st.Modes {
				if mode.ID == member.PermissionMode {
					matched = true
					break
				}
			}
			if !matched {
				item.Reason = fmt.Sprintf("权限档位 %s 不在 %s 当前可用列表中，请重新选择", member.PermissionMode, agentID)
				out = append(out, item)
				continue
			}
		}
		item.Available = true
		out = append(out, item)
	}
	return out
}

func cloneTemplate(in Template) Template {
	out := in
	if len(in.Members) > 0 {
		out.Members = make([]MemberSlot, len(in.Members))
		copy(out.Members, in.Members)
	} else {
		out.Members = []MemberSlot{}
	}
	if len(in.SkillPaths) > 0 {
		out.SkillPaths = make([]string, len(in.SkillPaths))
		copy(out.SkillPaths, in.SkillPaths)
	}
	return out
}

func dedupeStrings(items []string) []string {
	if len(items) == 0 {
		return nil
	}
	seen := make(map[string]bool, len(items))
	out := make([]string, 0, len(items))
	for _, raw := range items {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" || seen[trimmed] {
			continue
		}
		seen[trimmed] = true
		out = append(out, trimmed)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func newCollabID(prefix string) string {
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%s-%d", prefix, time.Now().UTC().UnixNano())
	}
	return fmt.Sprintf("%s-%d-%s", prefix, time.Now().UTC().Unix(), hex.EncodeToString(buf))
}
