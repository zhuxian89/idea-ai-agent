//go:build windows

package backend

import (
	"os/exec"
	"syscall"
)

func Detach(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x00000008 | 0x00000200, HideWindow: true}
}
