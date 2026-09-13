//go:build windows

package codex

import (
	"os/exec"
	"syscall"
)

const (
	windowsCreateNewProcessGroup  = 0x00000200
	windowsCreateDefaultErrorMode = 0x04000000
	windowsCreateNoWindow         = 0x08000000
)

func windowsProcessCreationFlags() uint32 {
	return windowsCreateNewProcessGroup | windowsCreateDefaultErrorMode | windowsCreateNoWindow
}

func configurePlatformCommand(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: windowsProcessCreationFlags(),
	}
}
