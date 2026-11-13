//go:build !windows

package backend

import (
	"errors"
	"golang.org/x/sys/unix"
	"os"
)

func lockContended(err error) bool { return errors.Is(err, unix.EWOULDBLOCK) }

func lock(file *os.File, shared bool) error {
	mode := unix.LOCK_EX
	if shared {
		mode = unix.LOCK_SH
	}
	return unix.Flock(int(file.Fd()), mode|unix.LOCK_NB)
}
