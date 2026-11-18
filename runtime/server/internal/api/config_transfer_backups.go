package api

import (
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
)

type transferBackups struct {
	Manifest []agentConfigManifestEntry `json:"manifest"`
	Env      map[string][]string        `json:"env"`
	Files    map[string][]byte          `json:"files"`
}

func exportTransferBackups() (transferBackups, error) {
	backup := transferBackups{Files: map[string][]byte{}}
	var err error
	if backup.Manifest, err = readAgentConfigManifest(); err != nil {
		return backup, err
	}
	if backup.Env, err = readAgentEnvBackups(); err != nil {
		return backup, err
	}
	root, err := agentConfigRootDir()
	if err != nil {
		return backup, err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return backup, err
	}
	size := 0
	for i := range backup.Manifest {
		entry := &backup.Manifest[i]
		for j := range entry.Sources {
			source := &entry.Sources[j]
			// Keep MindFS's portable home-relative destination format.
			if relative, err := filepath.Rel(home, source.SourcePath); err == nil && relative != "." && filepath.IsLocal(relative) {
				source.SourcePath = "~/" + filepath.ToSlash(relative)
			}
			if !validTransferBackupPath(entry.ID, source.BackupPath) {
				return backup, errors.New("invalid backup path")
			}
			name := filepath.Join(root, filepath.FromSlash(source.BackupPath))
			if err := checkTransferPath(root, name); err != nil {
				return backup, err
			}
			content, err := readTransferBytes(name)
			if err != nil {
				return backup, err
			}
			size += len(content)
			if size > (transferMaxBytes*3/4)-(64<<10) {
				return backup, errors.New("Agent configuration backups exceed archive size limit")
			}
			backup.Files[source.BackupPath] = content
		}
	}
	return backup, nil
}

func importTransferBackups(plan *configImportPlan, raw []byte) error {
	var backup transferBackups
	if err := decodeTransfer(raw, &backup); err != nil {
		return err
	}
	manifest, err := readAgentConfigManifest()
	if err != nil {
		return err
	}
	env, err := readAgentEnvBackups()
	if err != nil {
		return err
	}
	root, err := agentConfigRootDir()
	if err != nil {
		return err
	}
	manifestPath, err := agentConfigManifestPath()
	if err != nil {
		return err
	}
	envPath, err := agentEnvPath()
	if err != nil {
		return err
	}
	index := map[string]int{}
	for i, entry := range manifest {
		index[strings.ToLower(entry.ID)] = i
	}
	usedFiles, usedIDs := map[string]bool{}, map[string]bool{}
	seenIDs := map[string]bool{}
	for _, entry := range backup.Manifest {
		_, _, id, err := normalizeAgentConfigRequest(entry.Agent, entry.Name)
		key := strings.ToLower(id)
		if err != nil || entry.ID != id || !validTransferSegment(id) || seenIDs[key] {
			return errors.New("invalid or duplicate backup manifest entry")
		}
		seenIDs[key] = true
		usedIDs[id] = true
		lines, keys, err := normalizeEnvLines(backup.Env[id])
		if err != nil {
			return fmt.Errorf("invalid environment variables for backup %q", entry.Name)
		}
		entry.EnvKeys = keys
		if len(entry.Sources) == 0 && len(keys) == 0 {
			return fmt.Errorf("backup %q has no configuration content", entry.Name)
		}
		position, exists := index[key]
		if exists {
			plan.overwrites = true
			entry.ID = manifest[position].ID
		}
		seenFiles := map[string]bool{}
		for i := range entry.Sources {
			source := &entry.Sources[i]
			content, found := backup.Files[source.BackupPath]
			file := path.Base(source.BackupPath)
			fileKey := strings.ToLower(file)
			if !validTransferBackupPath(id, source.BackupPath) || !found || seenFiles[fileKey] {
				return errors.New("invalid or missing backup file")
			}
			seenFiles[fileKey], usedFiles[source.BackupPath] = true, true
			source.SourcePath, err = portableTransferDestination(source.SourcePath)
			if err != nil {
				return fmt.Errorf("backup %q: %w", entry.Name, err)
			}
			source.BackupPath = entry.ID + "/" + file
			plan.files[filepath.Join(root, filepath.FromSlash(source.BackupPath))] = content
		}
		if len(lines) == 0 {
			delete(env, entry.ID)
		} else {
			env[entry.ID] = lines
		}
		if exists {
			manifest[position] = entry
		} else {
			manifest = append(manifest, entry)
		}
	}
	if len(usedFiles) != len(backup.Files) {
		return errors.New("unreferenced backup files")
	}
	for id := range backup.Env {
		if !usedIDs[id] {
			return errors.New("unreferenced backup environment")
		}
	}
	if err := plan.put(manifestPath, manifest); err != nil {
		return err
	}
	return plan.put(envPath, env)
}

func portableTransferDestination(input string) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	var relative string
	if strings.HasPrefix(input, "~/") {
		relative = strings.TrimPrefix(input, "~/")
	} else if filepath.IsAbs(input) {
		relative, err = filepath.Rel(home, input)
		if err != nil {
			return "", err
		}
		relative = filepath.ToSlash(relative)
	}
	if relative == "" || relative == "." || path.Clean(relative) != relative {
		return "", fmt.Errorf("configuration target must be a file inside the user's home directory: %q", input)
	}
	for _, segment := range strings.Split(relative, "/") {
		if !validTransferSegment(segment) {
			return "", fmt.Errorf("invalid configuration target: %q", input)
		}
	}
	return "~/" + relative, nil
}
