package logfile

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRotationKeepsOnlyTwoBoundedFiles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "logs", "runtime.log")
	w, err := Open(path, 100)
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	line := strings.Repeat("x", 39) + "\n"
	for i := 0; i < 20; i++ {
		if n, err := w.Write([]byte(line)); err != nil || n != len(line) {
			t.Fatalf("write %d = %d, %v", i, n, err)
		}
	}
	entries, _ := os.ReadDir(filepath.Dir(path))
	if len(entries) != 2 {
		t.Fatalf("want runtime.log and runtime.log.1, got %d entries", len(entries))
	}
	for _, name := range []string{"runtime.log", "runtime.log.1"} {
		info, err := os.Stat(filepath.Join(filepath.Dir(path), name))
		if err != nil || info.Size() > 100 {
			t.Fatalf("%s size/err = %v/%v", name, info, err)
		}
	}
}

func TestReopenAppendsToExistingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "runtime.log")
	for _, text := range []string{"first\n", "second\n"} {
		w, err := Open(path, 1<<20)
		if err != nil {
			t.Fatal(err)
		}
		w.Write([]byte(text))
		w.Close()
	}
	data, _ := os.ReadFile(path)
	if string(data) != "first\nsecond\n" {
		t.Fatalf("got %q", data)
	}
}

func TestWriteAfterCloseDoesNotFail(t *testing.T) {
	w, err := Open(filepath.Join(t.TempDir(), "runtime.log"), 100)
	if err != nil {
		t.Fatal(err)
	}
	w.Close()
	if n, err := w.Write([]byte("late")); err != nil || n != 4 {
		t.Fatalf("got %d, %v", n, err)
	}
}
