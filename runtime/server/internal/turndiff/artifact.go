package turndiff

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	maxArtifactFiles = 500
	maxArtifactBytes = 64 << 20
	maxManifestBytes = 1 << 20
	maxArtifactAge   = 14 * 24 * time.Hour
)

type ChangedFile struct {
	Path   string
	Before FileState
	After  FileState
}

type FileState struct {
	Present bool
	Binary  bool
	Mode    uint32
	Bytes   []byte
}

type artifactManifest struct {
	Version   int                    `json:"version"`
	Session   string                 `json:"session"`
	CreatedAt time.Time              `json:"created_at"`
	Files     []artifactManifestFile `json:"files"`
}

type artifactManifestFile struct {
	Path   string           `json:"path"`
	Before artifactFileSide `json:"before"`
	After  artifactFileSide `json:"after"`
}

type artifactFileSide struct {
	Present bool   `json:"present"`
	Binary  bool   `json:"binary"`
	Mode    uint32 `json:"mode"`
	Size    int64  `json:"size"`
	Sha256  string `json:"sha256"`
	Blob    string `json:"blob,omitempty"`
}

type Artifact struct {
	ID    string
	Files []ChangedFile
}

func (r *Result) ChangedFiles() []ChangedFile {
	if r == nil {
		return nil
	}
	sectionsByPath := map[string]string{}
	for _, section := range sections(r.Diff) {
		path := mappedSectionPath(section, r.root)
		if path != "" {
			sectionsByPath[path] = section
		}
	}
	files := make([]ChangedFile, 0, len(r.changed))
	for path, value := range r.changed {
		if _, ok := sectionsByPath[path]; !ok || !r.covered[path] {
			continue
		}
		files = append(files, value)
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	return files
}

func mappedSectionPath(section, root string) string {
	for _, path := range sectionPaths(section) {
		if filepath.IsAbs(path) {
			if rel, err := filepath.Rel(root, path); err == nil {
				path = filepath.ToSlash(rel)
			}
		}
		return path
	}
	return ""
}

func SaveArtifact(parent, session string, files []ChangedFile) (string, error) {
	if strings.TrimSpace(session) == "" {
		return "", errors.New("session required")
	}
	if len(files) == 0 {
		return "", nil
	}
	if len(files) > maxArtifactFiles {
		return "", errors.New("artifact file limit exceeded")
	}
	base := filepath.Join("turn-diffs")
	dir := filepath.Join(parent, base)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	cleanupArtifacts(dir, time.Now())
	id, err := randomID()
	if err != nil {
		return "", err
	}
	snapshotDir := filepath.Join(dir, id)
	if err := os.MkdirAll(snapshotDir, 0700); err != nil {
		return "", err
	}
	manifest := artifactManifest{Version: 1, Session: session, CreatedAt: time.Now().UTC()}
	var total int64
	for index := range files {
		file := files[index]
		before, _, err := writeArtifactSide(snapshotDir, file.Path, "before", file.Before)
		if err != nil {
			_ = os.RemoveAll(snapshotDir)
			return "", err
		}
		after, _, err := writeArtifactSide(snapshotDir, file.Path, "after", file.After)
		if err != nil {
			_ = os.RemoveAll(snapshotDir)
			return "", err
		}
		file.Before.Binary = before.Binary
		file.After.Binary = after.Binary
		files[index] = file
		total += before.Size + after.Size
		if total > maxArtifactBytes {
			_ = os.RemoveAll(snapshotDir)
			return "", errors.New("artifact size limit exceeded")
		}
		manifest.Files = append(manifest.Files, artifactManifestFile{Path: file.Path, Before: before, After: after})
	}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		_ = os.RemoveAll(snapshotDir)
		return "", err
	}
	if err := atomicWrite(filepath.Join(snapshotDir, "manifest.json"), data, 0600); err != nil {
		_ = os.RemoveAll(snapshotDir)
		return "", err
	}
	return id, nil
}

func LoadArtifact(parent, session, id, path string) (*ChangedFile, error) {
	if strings.TrimSpace(session) == "" || !validArtifactID(id) {
		return nil, errors.New("turn diff artifact unavailable")
	}
	root, err := os.OpenRoot(parent)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	manifestPath := filepath.FromSlash(filepath.Join("turn-diffs", id, "manifest.json"))
	manifestFile, err := root.Open(manifestPath)
	if err != nil {
		return nil, err
	}
	defer manifestFile.Close()
	data, err := io.ReadAll(io.LimitReader(manifestFile, maxManifestBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > maxManifestBytes {
		return nil, errors.New("turn diff manifest size limit exceeded")
	}
	var manifest artifactManifest
	if err := json.Unmarshal(data, &manifest); err != nil || manifest.Version != 1 || manifest.Session != session {
		return nil, errors.New("turn diff artifact unavailable")
	}
	for _, item := range manifest.Files {
		if item.Path != path {
			continue
		}
		before, err := readArtifactSide(root, id, item.Before)
		if err != nil {
			return nil, err
		}
		after, err := readArtifactSide(root, id, item.After)
		if err != nil {
			return nil, err
		}
		return &ChangedFile{Path: item.Path, Before: before, After: after}, nil
	}
	return nil, errors.New("path not in turn diff artifact")
}

func writeArtifactSide(snapshotDir, path, side string, state FileState) (artifactFileSide, string, error) {
	metadata := artifactFileSide{Present: state.Present, Binary: state.Binary, Mode: state.Mode}
	if !state.Present {
		return metadata, "", nil
	}
	metadata.Size = int64(len(state.Bytes))
	sum := sha256.Sum256(state.Bytes)
	metadata.Sha256 = hex.EncodeToString(sum[:])
	metadata.Binary = isBinaryBytes(state.Bytes)
	blob := fmt.Sprintf("%s-%s", metadata.Sha256, strconv.FormatUint(uint64(metadata.Mode), 8))
	name := filepath.Join(snapshotDir, "blobs", blob)
	if info, err := os.Stat(name); err != nil || info.Size() != metadata.Size {
		if err := os.MkdirAll(filepath.Dir(name), 0700); err != nil {
			return metadata, "", err
		}
		if err := atomicWrite(name, state.Bytes, 0600); err != nil {
			return metadata, "", err
		}
	}
	metadata.Blob = blob
	return metadata, blob, nil
}

func readArtifactSide(root *os.Root, id string, metadata artifactFileSide) (FileState, error) {
	state := FileState{Present: metadata.Present, Binary: metadata.Binary, Mode: metadata.Mode}
	if !metadata.Present {
		return state, nil
	}
	if metadata.Size < 0 || metadata.Size > maxFileBytes || !validBlobID(metadata.Blob) {
		return state, errors.New("invalid turn diff blob")
	}
	blobPath := filepath.FromSlash(filepath.Join("turn-diffs", id, "blobs", metadata.Blob))
	blob, err := root.Open(blobPath)
	if err != nil {
		return state, err
	}
	defer blob.Close()
	data, err := io.ReadAll(io.LimitReader(blob, metadata.Size+1))
	if err != nil {
		return state, err
	}
	sum := sha256.Sum256(data)
	if int64(len(data)) != metadata.Size || hex.EncodeToString(sum[:]) != metadata.Sha256 {
		return state, errors.New("turn diff blob checksum mismatch")
	}
	state.Bytes = data
	return state, nil
}

func isBinaryBytes(data []byte) bool {
	limit := len(data)
	if limit > 8000 {
		limit = 8000
	}
	for _, b := range data[:limit] {
		if b == 0 {
			return true
		}
	}
	return false
}

func atomicWrite(path string, data []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	ok := false
	defer func() {
		if !ok {
			_ = os.Remove(name)
		}
	}()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(name, mode); err != nil {
		return err
	}
	if err := os.Rename(name, path); err != nil {
		return err
	}
	ok = true
	return nil
}

func randomID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func validArtifactID(id string) bool {
	if len(id) != 32 {
		return false
	}
	for _, char := range id {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
			return false
		}
	}
	return true
}

func validBlobID(id string) bool {
	hash, mode, ok := strings.Cut(id, "-")
	if !ok || len(hash) != 64 || len(mode) == 0 || len(mode) > 5 {
		return false
	}
	for _, char := range hash {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
			return false
		}
	}
	for _, char := range mode {
		if char < '0' || char > '7' {
			return false
		}
	}
	return true
}

func cleanupArtifacts(dir string, now time.Time) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	var candidates []fs.DirEntry
	for _, entry := range entries {
		if !entry.IsDir() || !validArtifactID(entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err == nil && now.Sub(info.ModTime()) > maxArtifactAge {
			candidates = append(candidates, entry)
		}
	}
	const keep = 20
	if len(entries) < keep || len(candidates) < 1 {
		return
	}
	sort.Slice(candidates, func(i, j int) bool {
		left, _ := candidates[i].Info()
		right, _ := candidates[j].Info()
		return left.ModTime().Before(right.ModTime())
	})
	remove := len(candidates) - max(0, keep-(len(entries)-len(candidates)))
	for _, entry := range candidates[:remove] {
		_ = os.RemoveAll(filepath.Join(dir, entry.Name()))
	}
}
