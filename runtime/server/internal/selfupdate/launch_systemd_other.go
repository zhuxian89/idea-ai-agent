//go:build !windows && !linux

package selfupdate

func launchSystemd(plan, []string) (bool, error) { return false, nil }
