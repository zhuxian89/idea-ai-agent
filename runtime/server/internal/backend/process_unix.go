//go:build !windows

package backend

import (
	"os/exec"
	"syscall"
)

func Detach(command *exec.Cmd) { command.SysProcAttr = &syscall.SysProcAttr{Setsid: true} }
