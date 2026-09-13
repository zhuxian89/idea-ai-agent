package types

// ReviewDelivery controls whether a review runs inline or on a detached thread.
type ReviewDelivery string

const (
	ReviewDeliveryInline   ReviewDelivery = "inline"
	ReviewDeliveryDetached ReviewDelivery = "detached"
)

// ReviewTarget describes what the reviewer should inspect.
type ReviewTarget struct {
	Type         string  `json:"type"`
	Branch       string  `json:"branch,omitempty"`
	SHA          string  `json:"sha,omitempty"`
	Title        *string `json:"title,omitempty"`
	Instructions string  `json:"instructions,omitempty"`
}

// ReviewStartParams configures review/start.
type ReviewStartParams struct {
	ThreadID string          `json:"threadId"`
	Target   ReviewTarget    `json:"target"`
	Delivery *ReviewDelivery `json:"delivery,omitempty"`
}

// ReviewTurn identifies the active review turn.
type ReviewTurn struct {
	ID string `json:"id"`
}

// ReviewStartResponse contains the immediate review/start response.
type ReviewStartResponse struct {
	Turn           ReviewTurn `json:"turn"`
	ReviewThreadID string     `json:"reviewThreadId"`
}
