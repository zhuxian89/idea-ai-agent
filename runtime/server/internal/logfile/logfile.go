// Package logfile gives the runtime a size-bounded diagnostic log. The IDE
// plugin discards the child's stderr, so without a file a failure leaves
// nothing to inspect.
package logfile

import (
	"os"
	"path/filepath"
	"sync"
)

// Writer appends to path and, once max bytes would be exceeded, moves the
// current file to path+".1" (replacing the previous one). It never returns an
// error from Write: logging must not take down the runtime.
type Writer struct {
	mu   sync.Mutex
	path string
	max  int64
	file *os.File
	size int64
}

func Open(path string, max int64) (*Writer, error) {
	w := &Writer{path: path, max: max}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	if err := w.openLocked(); err != nil {
		return nil, err
	}
	return w, nil
}

func (w *Writer) openLocked() error {
	file, err := os.OpenFile(w.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return err
	}
	w.file, w.size = file, info.Size()
	return nil
}

func (w *Writer) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file == nil {
		return len(p), nil
	}
	if w.size > 0 && w.size+int64(len(p)) > w.max {
		w.rotateLocked()
	}
	if w.file != nil {
		n, _ := w.file.Write(p)
		w.size += int64(n)
	}
	return len(p), nil
}

// rotateLocked is best effort. Another process (an old remote host that is
// being replaced) or Windows may keep the file busy; then keep appending and
// retry on a later write rather than lose log lines.
func (w *Writer) rotateLocked() {
	w.file.Close()
	w.file = nil
	if err := os.Rename(w.path, w.path+".1"); err != nil {
		w.size = 0
	}
	_ = w.openLocked()
}

func (w *Writer) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file == nil {
		return nil
	}
	err := w.file.Close()
	w.file = nil
	return err
}
