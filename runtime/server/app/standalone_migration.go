package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"mindfs/server/internal/fs"
)

type standaloneMigration struct {
	Projects map[string]string `json:"projects"`
}

// Import the projects shared by the previous remote entry once. Conversation
// files and the previous entry's configuration stay in their original places.
func migrateStandaloneProjects(dir string, registry *fs.Registry) (*standaloneMigration, error) {
	statePath := filepath.Join(dir, "standalone-migration.json")
	data, err := os.ReadFile(statePath)
	if err == nil {
		var migrated standaloneMigration
		if err := json.Unmarshal(data, &migrated); err != nil {
			return nil, fmt.Errorf("read standalone migration: %w", err)
		}
		return &migrated, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	migrated := &standaloneMigration{Projects: make(map[string]string)}
	data, err = os.ReadFile(filepath.Join(dir, "projects.json"))
	if errors.Is(err, os.ErrNotExist) {
		return migrated, nil
	}
	if err != nil {
		return nil, err
	}
	var previous struct {
		Enabled  bool `json:"enabled"`
		Projects []struct {
			ID            string `json:"project_id"`
			Path          string `json:"path"`
			Enabled       bool   `json:"enabled"`
			SharingPaused bool   `json:"sharing_paused"`
		} `json:"projects"`
	}
	if err := json.Unmarshal(data, &previous); err != nil {
		return nil, fmt.Errorf("read previous remote projects: %w", err)
	}
	for _, project := range previous.Projects {
		if !project.Enabled || project.SharingPaused {
			continue
		}
		if project.ID == "" || !filepath.IsAbs(project.Path) {
			return nil, fmt.Errorf("invalid previous remote project: %q", project.Path)
		}
		path, err := filepath.EvalSymlinks(project.Path)
		if errors.Is(err, os.ErrNotExist) {
			log.Printf("[standalone] previous project directory is missing: %s", project.Path)
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("resolve previous project %s: %w", project.Path, err)
		}
		info, err := os.Stat(path)
		if err != nil {
			return nil, err
		}
		if !info.IsDir() {
			return nil, fmt.Errorf("previous project is not a directory: %s", path)
		}
		if _, found := fs.FindRootByPath(registry.List(), path); !found {
			location, err := fs.MetaLocationForNewRoot(path, fs.MetaLocationProject)
			if err != nil {
				return nil, err
			}
			if _, err := registry.UpsertWithMetaLocation(path, location); err != nil {
				return nil, fmt.Errorf("import previous project %s: %w", path, err)
			}
		}
		migrated.Projects[project.ID] = path
	}

	remotePath := filepath.Join(dir, "remote-access.json")
	if _, err := os.Stat(remotePath); errors.Is(err, os.ErrNotExist) {
		data, err := json.Marshal(map[string]bool{"enabled": previous.Enabled})
		if err != nil {
			return nil, err
		}
		if err := writeStandaloneJSON(remotePath, data); err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	}
	data, err = json.Marshal(migrated)
	if err != nil {
		return nil, err
	}
	if err := writeStandaloneJSON(statePath, data); err != nil {
		return nil, err
	}
	return migrated, nil
}

func writeStandaloneJSON(path string, data []byte) error {
	if err := os.WriteFile(path+".tmp", data, 0600); err != nil {
		return err
	}
	return os.Rename(path+".tmp", path)
}

func (m *standaloneMigration) projectLinks(registry *fs.Registry) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/p/"), "/")
		path, known := m.Projects[id]
		root, found := fs.FindRootByPath(registry.List(), path)
		if !known || !found || (r.Method != http.MethodGet && r.Method != http.MethodHead) {
			http.NotFound(w, r)
			return
		}
		query := r.URL.Query()
		query.Set("root", root.ID)
		// A relative target retains Relay's /n/<node>/ prefix in the browser.
		target := "../?"
		if strings.HasSuffix(r.URL.Path, "/") {
			target = "../../?"
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Location", target+query.Encode())
		w.WriteHeader(http.StatusTemporaryRedirect)
	})
}
