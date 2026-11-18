package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"runtime"
	"sync"
	"time"

	configpkg "mindfs/server/internal/config"
)

const transferFormat = "mindfs-user-config"
const transferMaxBytes = 32 << 20

// Serialize import with the existing backup and provider management handlers.
var agentConfigMu sync.Mutex

type configArchive struct {
	Format    string                     `json:"format"`
	Version   int                        `json:"version"`
	CreatedAt string                     `json:"created_at"`
	Platform  string                     `json:"platform"`
	Sections  map[string]json.RawMessage `json:"sections"`
	Browser   json.RawMessage            `json:"browser,omitempty"`
}

type configImportRequest struct {
	Archive          configArchive `json:"archive"`
	Categories       []string      `json:"categories"`
	ConfirmOverwrite bool          `json:"confirm_overwrite,omitempty"`
}

type configImportResult struct {
	NeedsConfirm    bool `json:"needs_confirm"`
	RestartRequired bool `json:"restart_required"`
}

type configImportPlan struct {
	files      map[string][]byte
	overwrites bool
	restart    bool
}

func (p *configImportPlan) put(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	p.files[path] = append(data, '\n')
	return nil
}

func decodeTransfer(value []byte, out any) error {
	if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
		return errors.New("null configuration is not allowed")
	}
	d := json.NewDecoder(bytes.NewReader(value))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return errors.New("invalid trailing configuration data")
	}
	return nil
}

func transferSelection(categories []string) (map[string]bool, error) {
	if len(categories) == 0 {
		return nil, errors.New("select at least one configuration category")
	}
	selected := make(map[string]bool, len(categories))
	for _, category := range categories {
		switch category {
		case "providers", "api_keys", "agent_backups", "custom_agents":
		default:
			return nil, fmt.Errorf("unsupported configuration category: %s", category)
		}
		if selected[category] {
			return nil, errors.New("duplicate configuration category")
		}
		selected[category] = true
	}
	return selected, nil
}

func (h *HTTPHandler) handleConfigExport(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var req struct {
		Categories []string `json:"categories"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("invalid export request"))
		return
	}
	selected, err := transferSelection(req.Categories)
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	agentConfigMu.Lock()
	defer agentConfigMu.Unlock()
	result, err := exportAgentConfiguration(selected)
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	respondJSON(w, http.StatusOK, result)
}

func exportAgentConfiguration(selected map[string]bool) (json.RawMessage, error) {
	archive := configArchive{
		Format: transferFormat, Version: 1, Platform: runtime.GOOS,
		CreatedAt: time.Now().UTC().Format(time.RFC3339), Sections: map[string]json.RawMessage{},
	}
	if selected["providers"] || selected["api_keys"] {
		if err := exportTransferProviders(archive.Sections, selected); err != nil {
			return nil, err
		}
	}
	if selected["agent_backups"] {
		files, err := exportTransferBackups()
		if err != nil {
			return nil, err
		}
		archive.Sections["agent_backups"], err = json.Marshal(files)
		if err != nil {
			return nil, err
		}
	}
	if selected["custom_agents"] {
		if err := exportTransferCustomAgents(archive.Sections); err != nil {
			return nil, err
		}
	}
	if len(archive.Sections) == 0 {
		return nil, errors.New("no selected configuration exists on this node")
	}
	data, err := json.Marshal(archive)
	if len(data) > transferMaxBytes-(64<<10) {
		return nil, errors.New("configuration archive exceeds 32 MB")
	}
	return data, err
}

func (h *HTTPHandler) handleConfigImport(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var req configImportRequest
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, transferMaxBytes))
	if err != nil || decodeTransfer(data, &req) != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("invalid configuration archive (maximum 32 MB)"))
		return
	}
	agentConfigMu.Lock()
	defer agentConfigMu.Unlock()
	result, err := importAgentConfiguration(req)
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	respondJSON(w, http.StatusOK, result)
}

func importAgentConfiguration(req configImportRequest) (configImportResult, error) {
	if req.Archive.Format != transferFormat || req.Archive.Version != 1 {
		return configImportResult{}, errors.New("unsupported configuration archive format or version")
	}
	selected, err := transferSelection(req.Categories)
	if err != nil {
		return configImportResult{}, err
	}
	sections := req.Archive.Sections
	for _, category := range req.Categories {
		if _, ok := sections[category]; !ok {
			return configImportResult{}, fmt.Errorf("missing configuration category: %s", category)
		}
	}
	plan := configImportPlan{files: map[string][]byte{}}
	if selected["agent_backups"] {
		if err := importTransferBackups(&plan, sections["agent_backups"]); err != nil {
			return configImportResult{}, err
		}
	}
	if selected["providers"] || selected["api_keys"] {
		if err := importTransferProviders(&plan, sections, selected); err != nil {
			return configImportResult{}, err
		}
	}
	if selected["custom_agents"] {
		if err := importTransferCustomAgents(&plan, sections["custom_agents"]); err != nil {
			return configImportResult{}, err
		}
	}
	if plan.overwrites && !req.ConfirmOverwrite {
		return configImportResult{NeedsConfirm: true}, nil
	}
	dir, err := configpkg.MindFSConfigDir()
	if err != nil {
		return configImportResult{}, err
	}
	if err := writeTransferFiles(dir, plan.files); err != nil {
		return configImportResult{}, err
	}
	return configImportResult{RestartRequired: plan.restart}, nil
}
