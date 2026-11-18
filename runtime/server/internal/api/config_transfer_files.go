package api

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func readTransferBytes(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > transferMaxBytes {
		return nil, errors.New("configuration file is not a regular file or exceeds 32 MB")
	}
	b, err := io.ReadAll(io.LimitReader(f, transferMaxBytes+1))
	if len(b) > transferMaxBytes {
		return nil, errors.New("configuration file exceeds 32 MB")
	}
	return b, err
}

func validTransferSegment(s string) bool {
	return s != "." && filepath.IsLocal(s) && strings.TrimRight(s, " .") == s && !strings.ContainsAny(s, "/\\:\x00")
}

func validTransferBackupPath(id, path string) bool {
	parts := strings.Split(path, "/")
	return validTransferSegment(id) && len(parts) == 2 && parts[0] == id && validTransferSegment(parts[1])
}

// Reject symlinks under the destination root, including existing parent directories.
func checkTransferPath(root, path string) error {
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return errors.New("invalid configuration destination")
	}
	current := root
	for _, part := range append([]string{""}, strings.Split(rel, string(filepath.Separator))...) {
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return errors.New("configuration destination must not be a symlink")
		}
	}
	return nil
}

func atomicTransferWrite(path string, data []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".mindfs-import-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(data); err != nil {
		_ = f.Close()
		return err
	}
	if err = f.Chmod(mode); err != nil {
		_ = f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}

// Validate and save all old contents before the first mutation. A write failure
// restores completed writes; preference validation also happens before this call.
func writeTransferFiles(root string, files map[string][]byte) error {
	type previous struct {
		data   []byte
		exists bool
		mode   os.FileMode
	}
	old := map[string]previous{}
	paths := make([]string, 0, len(files))
	for path := range files {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	for _, path := range paths {
		base := root
		if rel, _ := filepath.Rel(root, path); rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			base = filepath.Dir(path)
		}
		if err := checkTransferPath(base, path); err != nil {
			return err
		}
		b, err := readTransferBytes(path)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		p := previous{data: b, exists: err == nil, mode: 0o600}
		if p.exists {
			info, err := os.Stat(path)
			if err != nil {
				return err
			}
			p.mode = info.Mode().Perm()
		}
		old[path] = p
	}
	written := []string{}
	rollback := func() error {
		var result error
		for i := len(written) - 1; i >= 0; i-- {
			path := written[i]
			p := old[path]
			var err error
			if p.exists {
				err = atomicTransferWrite(path, p.data, p.mode)
			} else {
				err = os.Remove(path)
			}
			result = errors.Join(result, err)
		}
		return result
	}
	for _, path := range paths {
		if err := atomicTransferWrite(path, files[path], 0o600); err != nil {
			return errors.Join(err, rollback())
		}
		written = append(written, path)
	}
	return nil
}
