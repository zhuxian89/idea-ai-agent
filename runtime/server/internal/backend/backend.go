// Package backend defines discovery and ownership for the user-level backend.
package backend

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type Installation struct {
	Executable string `json:"executable"`
}

func RecordInstallation(dir, executable string) error {
	abs, err := filepath.Abs(executable)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	data, err := json.Marshal(Installation{Executable: abs})
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(dir, "installation-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	_, err = file.Write(append(data, '\n'))
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(file.Name(), filepath.Join(dir, "installation.json"))
}

// A shared lease permits the existing per-project IDE processes. The shared
// local core requires exclusive ownership; the remote gateway does not write project data.
func Acquire(dir string, shared bool) (*os.File, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(filepath.Join(dir, "backend.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = lock(file, shared); err != nil {
		file.Close()
		return nil, fmt.Errorf("another backend is using project data; close its IDEA projects or stop Local AI Agent before switching: %w", err)
	}
	return file, nil
}
