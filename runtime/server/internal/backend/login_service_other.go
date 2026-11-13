//go:build !darwin && !windows

package backend

import "context"

func InstallLoginServices(dir, executable string) error { return nil }

func StartLoginService(ctx context.Context, dir, kind, executable string, args []string) (bool, error) {
	return false, nil
}

func UnloadLoginService(ctx context.Context, dir, kind string) error { return nil }

func RemoveLoginServices(ctx context.Context, dir string) error { return nil }

func RemoveLoginService(ctx context.Context, dir, kind string) error { return nil }
