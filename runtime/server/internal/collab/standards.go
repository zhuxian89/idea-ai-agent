package collab

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

type SkillSummary struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Path        string `json:"path"`
	Source      string `json:"source"`
}

type StandardsOptions struct {
	RootPath   string
	HomeDir    string
	SkillPaths []string
}

type LoadedStandards struct {
	ProjectAgentsPath string
	SelectedSkills    []LoadedSkill
}

// LoadedSkill only carries the index entry. The SKILL.md body is left for the
// reviewer to read on demand, like any agent's progressive skill loading.
type LoadedSkill struct {
	Name        string
	Description string
	Path        string
}

func resolveHomeDir(explicit string) string {
	if trimmed := strings.TrimSpace(explicit); trimmed != "" {
		return trimmed
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return home
}

func LoadStandards(opts StandardsOptions) LoadedStandards {
	var out LoadedStandards
	if root := strings.TrimSpace(opts.RootPath); root != "" {
		candidate := filepath.Join(root, "AGENTS.md")
		if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() {
			out.ProjectAgentsPath = "AGENTS.md"
		}
	}

	home := resolveHomeDir(opts.HomeDir)

	allowedSkillRoots := allowedSkillBaseDirs(home, opts.RootPath)
	seenSkillPath := make(map[string]bool, len(opts.SkillPaths))
	for _, rawPath := range opts.SkillPaths {
		resolved := expandHomePath(strings.TrimSpace(rawPath), home)
		if resolved == "" {
			continue
		}
		skillFile := resolved
		if info, err := os.Stat(resolved); err == nil && info.IsDir() {
			skillFile = filepath.Join(resolved, "SKILL.md")
		}
		cleanFile := filepath.Clean(skillFile)
		if !strings.EqualFold(filepath.Base(cleanFile), "SKILL.md") {
			continue
		}
		realFile, evalErr := filepath.EvalSymlinks(cleanFile)
		if evalErr != nil || !isPathWithinAnyDir(realFile, allowedSkillRoots) {
			continue
		}
		if seenSkillPath[realFile] {
			continue
		}
		data, err := os.ReadFile(realFile)
		if err != nil {
			continue
		}
		text := strings.TrimSpace(string(data))
		if text == "" {
			continue
		}
		seenSkillPath[realFile] = true
		name, desc := parseSkillFrontmatter(text, filepath.Base(filepath.Dir(cleanFile)))
		out.SelectedSkills = append(out.SelectedSkills, LoadedSkill{
			Name:        name,
			Description: desc,
			Path:        filepath.ToSlash(cleanFile),
		})
	}
	return out
}

func allowedSkillBaseDirs(home, rootPath string) []string {
	candidates := make([]string, 0, 4)
	if home != "" {
		candidates = append(candidates,
			filepath.Join(home, ".codex", "skills"),
			filepath.Join(home, ".agents", "skills"),
			filepath.Join(home, ".claude", "skills"),
		)
	}
	if trimmedRoot := strings.TrimSpace(rootPath); trimmedRoot != "" {
		candidates = append(candidates, trimmedRoot)
	}
	roots := make([]string, 0, len(candidates))
	for _, dir := range candidates {
		abs, err := filepath.Abs(dir)
		if err != nil {
			continue
		}
		if resolved, evalErr := filepath.EvalSymlinks(abs); evalErr == nil {
			abs = resolved
		}
		roots = append(roots, abs)
	}
	return roots
}

func isPathWithinAnyDir(targetReal string, allowedRoots []string) bool {
	for _, base := range allowedRoots {
		rel, err := filepath.Rel(base, targetReal)
		if err == nil && rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

// DiscoverUserSkills scans standard user skill directories so templates can let
// the author pick skills across Codex, Claude, and shared agent skill folders.
func DiscoverUserSkills(homeDir string) []SkillSummary {
	home := resolveHomeDir(homeDir)
	if home == "" {
		return []SkillSummary{}
	}
	roots := []struct {
		source string
		dir    string
	}{
		{source: "codex", dir: filepath.Join(home, ".codex", "skills")},
		{source: "agents", dir: filepath.Join(home, ".agents", "skills")},
		{source: "claude", dir: filepath.Join(home, ".claude", "skills")},
	}
	seenName := make(map[string]bool)
	seenPath := make(map[string]bool)
	items := make([]SkillSummary, 0, 16)
	for _, root := range roots {
		entries, err := os.ReadDir(root.dir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			name := entry.Name()
			if strings.HasPrefix(name, ".") {
				continue
			}
			skillDir := filepath.Join(root.dir, name)
			skillFile := filepath.Join(skillDir, "SKILL.md")
			realFile := skillFile
			if resolved, err := filepath.EvalSymlinks(skillFile); err == nil {
				realFile = resolved
			}
			if seenPath[realFile] {
				continue
			}
			data, err := os.ReadFile(skillFile)
			if err != nil {
				continue
			}
			parsedName, desc := parseSkillFrontmatter(string(data), name)
			if seenName[parsedName] {
				continue
			}
			seenPath[realFile] = true
			seenName[parsedName] = true
			items = append(items, SkillSummary{
				Name:        parsedName,
				Description: desc,
				Path:        filepath.ToSlash(skillFile),
				Source:      root.source,
			})
		}
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].Name < items[j].Name
	})
	return items
}

// BuildReviewerStandardsSection lists paths only. The project AGENTS.md is the
// single standard shared by every reviewer; per-agent global rule files are not
// injected because they differ between agents and may contradict each other.
func BuildReviewerStandardsSection(loaded LoadedStandards) string {
	var b strings.Builder
	b.WriteString("## 规范依据（所有规范类意见必须写明具体规则出处）\n\n")
	if loaded.ProjectAgentsPath != "" {
		b.WriteString("- 项目规范：请先用文件读取工具阅读项目根目录下的 `")
		b.WriteString(loaded.ProjectAgentsPath)
		b.WriteString("`，引用时注明 `AGENTS.md` 及对应小节标题。项目规范是唯一统一标准，与你自带的其他规则冲突时以它为准。\n")
	} else {
		b.WriteString("- 项目根目录下未发现 `AGENTS.md`。\n")
	}

	if len(loaded.SelectedSkills) > 0 {
		b.WriteString("- 本次模板启用的 Skill（仅当本次改动涉及该领域时再读取对应 `SKILL.md`，引用时注明 Skill 名称）：\n")
		for _, skill := range loaded.SelectedSkills {
			b.WriteString("  - `")
			b.WriteString(skill.Name)
			b.WriteString("`")
			if skill.Description != "" {
				b.WriteString("：")
				b.WriteString(skill.Description)
			}
			b.WriteString("（路径：`")
			b.WriteString(skill.Path)
			b.WriteString("`）\n")
		}
	}
	return strings.TrimSpace(b.String())
}

func expandHomePath(path, home string) string {
	if path == "" {
		return ""
	}
	if path == "~" {
		return home
	}
	if strings.HasPrefix(path, "~/") || strings.HasPrefix(path, `~\`) {
		if home == "" {
			return ""
		}
		return filepath.Join(home, path[2:])
	}
	return path
}

func parseSkillFrontmatter(content, fallbackName string) (name, description string) {
	name = strings.TrimSpace(fallbackName)
	content = strings.ReplaceAll(strings.TrimSpace(content), "\r\n", "\n")
	rest, ok := strings.CutPrefix(content, "---\n")
	if !ok {
		return name, ""
	}
	header, _, ok := strings.Cut("\n"+rest+"\n", "\n---\n")
	if !ok {
		return name, ""
	}
	var frontmatter struct {
		Name        string `yaml:"name"`
		Description string `yaml:"description"`
	}
	if err := yaml.Unmarshal([]byte(header), &frontmatter); err == nil {
		return firstNonEmpty(strings.TrimSpace(frontmatter.Name), name), strings.Join(strings.Fields(frontmatter.Description), " ")
	}

	// Older Skill files could use unquoted single-line values containing ": ".
	for line := range strings.SplitSeq(header, "\n") {
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		switch key {
		case "name":
			name = firstNonEmpty(strings.Trim(strings.TrimSpace(value), `"'`), name)
		case "description":
			description = strings.Join(strings.Fields(value), " ")
		}
	}
	return name, description
}
