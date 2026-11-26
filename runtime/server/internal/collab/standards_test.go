package collab

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadStandardsAndSkillsInjection(t *testing.T) {
	home := t.TempDir()
	project := t.TempDir()

	if err := os.WriteFile(filepath.Join(project, "AGENTS.md"), []byte("# 项目开发约束\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(home, ".codex", "skills", "clean-go"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(home, ".claude"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, ".codex", "AGENTS.md"), []byte("避免过度防御和过度设计\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Comment-only CLAUDE.md should not be injected as noise.
	if err := os.WriteFile(filepath.Join(home, ".claude", "CLAUDE.md"), []byte("<!-- empty placeholder -->\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	skillPath := filepath.Join(home, ".codex", "skills", "clean-go", "SKILL.md")
	if err := os.WriteFile(skillPath, []byte("---\nname: clean-go\ndescription: >-\n  Go style\n  checks\n---\nAlways check error wrapping.\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	discovered := DiscoverUserSkills(home)
	if len(discovered) != 1 || discovered[0].Name != "clean-go" || discovered[0].Description != "Go style checks" {
		t.Fatalf("DiscoverUserSkills = %#v", discovered)
	}

	loaded := LoadStandards(StandardsOptions{
		RootPath:   project,
		HomeDir:    home,
		SkillPaths: []string{"~/.codex/skills/clean-go"},
	})
	if loaded.ProjectAgentsPath != "AGENTS.md" {
		t.Fatalf("ProjectAgentsPath = %q", loaded.ProjectAgentsPath)
	}
	if len(loaded.SelectedSkills) != 1 || loaded.SelectedSkills[0].Name != "clean-go" {
		t.Fatalf("SelectedSkills = %#v", loaded.SelectedSkills)
	}

	section := BuildReviewerStandardsSection(loaded)
	for _, want := range []string{"AGENTS.md", "clean-go", "Go style checks", skillPath} {
		if !strings.Contains(section, filepath.ToSlash(want)) {
			t.Fatalf("section missing %q:\n%s", want, section)
		}
	}
	// Global rule files of any agent and skill bodies must never be inlined.
	for _, banned := range []string{"避免过度防御和过度设计", "Always check error wrapping."} {
		if strings.Contains(section, banned) {
			t.Fatalf("section must not inline %q:\n%s", banned, section)
		}
	}
	fullDoc := reviewInstructions(Run{ID: "run-1", Round: 1}, section)
	if lines := strings.Count(fullDoc, "\n") + 1; lines > 55 {
		t.Fatalf("02-审核依据.md line count = %d, want <= 55:\n%s", lines, fullDoc)
	}

	// Arbitrary files outside allowed skill roots or non-SKILL.md files must be ignored.
	outsideDir := t.TempDir()
	secretFile := filepath.Join(outsideDir, "SKILL.md")
	if err := os.WriteFile(secretFile, []byte("TOP_SECRET_TOKEN\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	escapeDir := filepath.Join(home, ".codex", "skills", "escape-link")
	_ = os.Symlink(outsideDir, escapeDir)
	nonSkillInProject := filepath.Join(project, "notes.md")
	if err := os.WriteFile(nonSkillInProject, []byte("NOT_A_SKILL\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	filtered := LoadStandards(StandardsOptions{
		RootPath:   project,
		HomeDir:    home,
		SkillPaths: []string{secretFile, escapeDir, nonSkillInProject},
	})
	if len(filtered.SelectedSkills) != 0 {
		t.Fatalf("expected unauthorized skill paths rejected, got %#v", filtered.SelectedSkills)
	}
}

func TestParseSkillFrontmatterLiteralDescription(t *testing.T) {
	name, description := parseSkillFrontmatter("---\r\nname: example\r\ndescription: |\r\n  First line\r\n  Second line: with punctuation\r\n---\r\nBody", "fallback")
	if name != "example" || description != "First line Second line: with punctuation" {
		t.Fatalf("name=%q description=%q", name, description)
	}
}

func TestParseSkillFrontmatterLegacyDescription(t *testing.T) {
	name, description := parseSkillFrontmatter("---\nname: example\ndescription: Use when X: Y\n---\nBody", "fallback")
	if name != "example" || description != "Use when X: Y" {
		t.Fatalf("name=%q description=%q", name, description)
	}
}
