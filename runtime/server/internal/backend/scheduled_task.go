package backend

import _ "embed"

//go:embed scheduled_task_control.ps1
var scheduledTaskControl []byte

//go:embed scheduled_task_run.ps1
var scheduledTaskRunner []byte

type scheduledTaskConfig struct {
	Name        string            `json:"name"`
	UserID      string            `json:"user_id"`
	PowerShell  string            `json:"powershell"`
	Runner      string            `json:"runner"`
	Executable  string            `json:"executable"`
	Arguments   []string          `json:"arguments"`
	Environment map[string]string `json:"environment"`
	Log         string            `json:"log"`
}
