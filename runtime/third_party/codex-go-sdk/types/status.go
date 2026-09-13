package types

// PlanType describes the subscription tier associated with an account or rate limit bucket.
type PlanType string

const (
	PlanTypeFree       PlanType = "free"
	PlanTypeGo         PlanType = "go"
	PlanTypePlus       PlanType = "plus"
	PlanTypePro        PlanType = "pro"
	PlanTypeTeam       PlanType = "team"
	PlanTypeBusiness   PlanType = "business"
	PlanTypeEnterprise PlanType = "enterprise"
	PlanTypeEdu        PlanType = "edu"
	PlanTypeUnknown    PlanType = "unknown"
)

// Account represents the active authentication state returned by account/read.
type Account struct {
	Type     string   `json:"type"`
	Email    string   `json:"email,omitempty"`
	PlanType PlanType `json:"planType,omitempty"`
}

// GetAccountParams configures account/read.
type GetAccountParams struct {
	RefreshToken bool `json:"refreshToken"`
}

// GetAccountResponse contains the account/read response.
type GetAccountResponse struct {
	Account            *Account `json:"account"`
	RequiresOpenAIAuth bool     `json:"requiresOpenaiAuth"`
}

// RateLimitWindow represents one usage bucket window.
type RateLimitWindow struct {
	UsedPercent        int32  `json:"usedPercent"`
	WindowDurationMins *int64 `json:"windowDurationMins"`
	ResetsAt           *int64 `json:"resetsAt"`
}

// CreditsSnapshot represents remaining credit information when present.
type CreditsSnapshot struct {
	HasCredits bool    `json:"hasCredits"`
	Unlimited  bool    `json:"unlimited"`
	Balance    *string `json:"balance"`
}

// RateLimitSnapshot mirrors the app-server rate-limit payload.
type RateLimitSnapshot struct {
	LimitID   *string          `json:"limitId"`
	LimitName *string          `json:"limitName"`
	Primary   *RateLimitWindow `json:"primary"`
	Secondary *RateLimitWindow `json:"secondary"`
	Credits   *CreditsSnapshot `json:"credits"`
	PlanType  *PlanType        `json:"planType"`
}

// GetAccountRateLimitsResponse contains the account/rateLimits/read response.
type GetAccountRateLimitsResponse struct {
	RateLimits          RateLimitSnapshot            `json:"rateLimits"`
	RateLimitsByLimitID map[string]RateLimitSnapshot `json:"rateLimitsByLimitId"`
}
