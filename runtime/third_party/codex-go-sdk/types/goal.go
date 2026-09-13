package types

// ThreadGoalStatus is the lifecycle status for a Codex thread goal.
type ThreadGoalStatus string

const (
	ThreadGoalStatusActive        ThreadGoalStatus = "active"
	ThreadGoalStatusPaused        ThreadGoalStatus = "paused"
	ThreadGoalStatusBlocked       ThreadGoalStatus = "blocked"
	ThreadGoalStatusUsageLimited  ThreadGoalStatus = "usageLimited"
	ThreadGoalStatusBudgetLimited ThreadGoalStatus = "budgetLimited"
	ThreadGoalStatusComplete      ThreadGoalStatus = "complete"
)

// ThreadGoal describes the active goal persisted for a Codex thread.
type ThreadGoal struct {
	ThreadID        string           `json:"threadId"`
	Objective       string           `json:"objective"`
	Status          ThreadGoalStatus `json:"status"`
	TokenBudget     *int64           `json:"tokenBudget"`
	TokensUsed      int64            `json:"tokensUsed"`
	TimeUsedSeconds int64            `json:"timeUsedSeconds"`
	CreatedAt       int64            `json:"createdAt"`
	UpdatedAt       int64            `json:"updatedAt"`
}

// ThreadGoalSetParams configures thread/goal/set.
type ThreadGoalSetParams struct {
	ThreadID    string            `json:"threadId"`
	Objective   *string           `json:"objective,omitempty"`
	Status      *ThreadGoalStatus `json:"status,omitempty"`
	TokenBudget *int64            `json:"tokenBudget,omitempty"`
}

// ThreadGoalSetResponse contains the updated goal.
type ThreadGoalSetResponse struct {
	Goal ThreadGoal `json:"goal"`
}

// ThreadGoalGetParams configures thread/goal/get.
type ThreadGoalGetParams struct {
	ThreadID string `json:"threadId"`
}

// ThreadGoalGetResponse contains the current goal, when present.
type ThreadGoalGetResponse struct {
	Goal *ThreadGoal `json:"goal"`
}

// ThreadGoalClearParams configures thread/goal/clear.
type ThreadGoalClearParams struct {
	ThreadID string `json:"threadId"`
}

// ThreadGoalClearResponse reports whether a goal was cleared.
type ThreadGoalClearResponse struct {
	Cleared bool `json:"cleared"`
}

// ThreadGoalUpdatedEvent is emitted when the thread goal changes.
type ThreadGoalUpdatedEvent struct {
	Type     string     `json:"type"`
	ThreadID string     `json:"threadId"`
	TurnID   *string    `json:"turnId"`
	Goal     ThreadGoal `json:"goal"`
}

// GetType returns the event type discriminator.
func (e ThreadGoalUpdatedEvent) GetType() string {
	return e.Type
}

// ThreadGoalClearedEvent is emitted when the thread goal is cleared.
type ThreadGoalClearedEvent struct {
	Type     string  `json:"type"`
	ThreadID string  `json:"threadId"`
	TurnID   *string `json:"turnId"`
}

// GetType returns the event type discriminator.
func (e ThreadGoalClearedEvent) GetType() string {
	return e.Type
}
