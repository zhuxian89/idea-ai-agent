package types

// ThreadShellCommandParams configures thread/shellCommand.
type ThreadShellCommandParams struct {
	ThreadID string `json:"threadId"`
	Command  string `json:"command"`
}

// ThreadShellCommandResponse is the empty success response for thread/shellCommand.
type ThreadShellCommandResponse struct{}
