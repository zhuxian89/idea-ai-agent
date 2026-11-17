package fs

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestSameNameRootsPreserveMetadataAndSurviveReload(t *testing.T) {
	for _, location := range []string{MetaLocationProject, MetaLocationHome} {
		t.Run(location, func(t *testing.T) {
			originalHome := userHomeDir
			home := t.TempDir()
			userHomeDir = func() (string, error) { return home, nil }
			t.Cleanup(func() { userHomeDir = originalHome })
			base := t.TempDir()
			registryPath := filepath.Join(base, "registry.json")
			registry := NewRegistry(registryPath)
			var roots []RootInfo
			for _, parent := range []string{"Z", "D"} {
				path := filepath.Join(base, parent, "project")
				if err := os.MkdirAll(path, 0700); err != nil {
					t.Fatal(err)
				}
				root, err := registry.UpsertWithMetaLocation(path, location)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := root.EnsureMetaDir(); err != nil {
					t.Fatal(err)
				}
				if err := root.WriteMetaFile("history.jsonl", []byte(parent+" history\n")); err != nil {
					t.Fatal(err)
				}
				roots = append(roots, root)
			}
			if roots[0].ID != "project" || roots[0].ID == roots[1].ID || roots[0].Name != roots[1].Name || roots[0].MetaDir() == roots[1].MetaDir() {
				t.Fatalf("same-name project identities or metadata overlap: %+v", roots)
			}
			registry = NewRegistry(registryPath)
			if err := registry.Load(); err != nil {
				t.Fatal(err)
			}
			for i, root := range roots {
				// 请求的存储偏好变化不能迁移已登记项目的数据。
				got, err := registry.UpsertWithMetaLocation(root.RootPath, MetaLocationProject)
				if err != nil || got.ID != root.ID || got.MetaLocation != location || got.MetaDir() != root.MetaDir() {
					t.Fatalf("reopen changed identity: %+v, %v", got, err)
				}
				want := []string{"Z history\n", "D history\n"}[i]
				data, err := got.ReadMetaFile("history.jsonl")
				if err != nil || string(data) != want {
					t.Fatalf("history changed: %q, %v", data, err)
				}
			}
			removed, err := registry.Remove(roots[1].RootPath)
			if err != nil || removed.ID != roots[1].ID {
				t.Fatalf("remove targeted the wrong project: %+v, %v", removed, err)
			}
			if first, exists := registry.Get(roots[0].ID); !exists || first.RootPath != roots[0].RootPath {
				t.Fatal("removing the second project changed the first")
			}
			if _, err := registry.Remove(roots[0].RootPath); err != nil {
				t.Fatal(err)
			}
			// 两条登记均移除后，home 数据仍须按路径找回原来的摘要 ID。
			location, err := MetaLocationForNewRoot(roots[1].RootPath, MetaLocationProject)
			if err != nil {
				t.Fatal(err)
			}
			readded, err := registry.UpsertWithMetaLocation(roots[1].RootPath, location)
			if err != nil || (roots[1].MetaLocation == MetaLocationHome && readded.ID != roots[1].ID) {
				t.Fatalf("re-add did not reuse home identity: %+v, %v", readded, err)
			}
			data, err := readded.ReadMetaFile("history.jsonl")
			if err != nil || string(data) != "D history\n" {
				t.Fatalf("re-add lost history: %q, %v", data, err)
			}
		})
	}
}

func TestSameNameRootPreservesLegacyRegistryEntry(t *testing.T) {
	originalHome := userHomeDir
	home := t.TempDir()
	userHomeDir = func() (string, error) { return home, nil }
	t.Cleanup(func() { userHomeDir = originalHome })
	base := t.TempDir()
	first := filepath.Join(base, "Z", "project")
	second := filepath.Join(base, "D", "project")
	for _, path := range []string{first, second} {
		if err := os.MkdirAll(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	registryPath := filepath.Join(base, "registry.json")
	// 旧 JSON 没有 id 和 meta_location；加载默认值必须继续有效。
	payload, err := json.Marshal(map[string]any{"dirs": []map[string]string{{"name": "project", "root_path": first}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(registryPath, payload, 0600); err != nil {
		t.Fatal(err)
	}
	registry := NewRegistry(registryPath)
	if err := registry.Load(); err != nil {
		t.Fatal(err)
	}
	before := registry.List()[0]
	other, err := registry.Upsert(second)
	if err != nil || other.ID == before.ID {
		t.Fatalf("new same-name project failed: %+v, %v", other, err)
	}
	if err := registry.Load(); err != nil {
		t.Fatal(err)
	}
	after, exists := registry.Get(before.ID)
	if !exists || after != before || len(registry.List()) != 2 {
		t.Fatalf("legacy record changed: before=%+v after=%+v", before, after)
	}
}

func TestSameNameRootRenameKeepsOtherProjectAndHomeHistory(t *testing.T) {
	originalHome := userHomeDir
	home := t.TempDir()
	userHomeDir = func() (string, error) { return home, nil }
	t.Cleanup(func() { userHomeDir = originalHome })
	base := t.TempDir()
	first := filepath.Join(base, "Z", "project")
	oldPath := filepath.Join(base, "D", "other")
	for _, path := range []string{first, oldPath} {
		if err := os.MkdirAll(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	registry := NewRegistry(filepath.Join(base, "registry.json"))
	original, err := registry.Upsert(first)
	if err != nil {
		t.Fatal(err)
	}
	root, err := registry.UpsertWithMetaLocation(oldPath, MetaLocationHome)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := root.EnsureMetaDir(); err != nil {
		t.Fatal(err)
	}
	if err := root.WriteMetaFile("history.jsonl", []byte("keep D history\n")); err != nil {
		t.Fatal(err)
	}
	newPath := filepath.Join(filepath.Dir(oldPath), "project")
	if err := os.Rename(oldPath, newPath); err != nil {
		t.Fatal(err)
	}
	renamed, err := registry.Rename(root.ID, "project", newPath)
	if err != nil || renamed.ID == original.ID || renamed.Name != "project" || renamed.RootPath != newPath {
		t.Fatalf("same-name rename failed: %+v, %v", renamed, err)
	}
	if _, err := renamed.EnsureMetaDir(); err != nil {
		t.Fatal(err)
	}
	data, err := renamed.ReadMetaFile("history.jsonl")
	if err != nil || string(data) != "keep D history\n" {
		t.Fatalf("rename lost history: %q, %v", data, err)
	}
	if got, exists := registry.Get(original.ID); !exists || got != original {
		t.Fatal("rename changed the other same-name project")
	}
}

func TestSameNameWindowsRootsTreatIDsCaseInsensitively(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows ID and filesystem comparison")
	}
	originalHome := userHomeDir
	home := t.TempDir()
	userHomeDir = func() (string, error) { return home, nil }
	t.Cleanup(func() { userHomeDir = originalHome })
	base := t.TempDir()
	registry := NewRegistry(filepath.Join(base, "registry.json"))
	var roots []RootInfo
	for i, name := range []string{"Project", "project"} {
		path := filepath.Join(base, []string{"Z", "D"}[i], name)
		if err := os.MkdirAll(path, 0700); err != nil {
			t.Fatal(err)
		}
		root, err := registry.Upsert(path)
		if err != nil {
			t.Fatal(err)
		}
		roots = append(roots, root)
	}
	if strings.EqualFold(roots[0].ID, roots[1].ID) {
		t.Fatal("case-insensitive home metadata IDs overlap")
	}
	again, err := registry.Upsert(strings.ToUpper(roots[1].RootPath))
	if err != nil || again.ID != roots[1].ID || len(registry.List()) != 2 {
		t.Fatalf("path casing created a duplicate: %+v, %v", again, err)
	}
}
