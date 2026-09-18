//go:build !windows

package turndiff

import "os/exec"

func configureCommand(cmd *exec.Cmd) {}
