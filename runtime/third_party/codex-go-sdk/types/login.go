package types

// LoginAccountDeviceCodeResponse is returned by account/login/start for ChatGPT device code login.
type LoginAccountDeviceCodeResponse struct {
	Type            string `json:"type"`
	LoginID         string `json:"loginId"`
	VerificationURL string `json:"verificationUrl"`
	UserCode        string `json:"userCode"`
}

// AccountLoginCompletedNotification is emitted when a login attempt finishes.
type AccountLoginCompletedNotification struct {
	LoginID *string `json:"loginId"`
	Success bool    `json:"success"`
	Error   *string `json:"error"`
}

// AccountUpdatedNotification is emitted when the active account changes.
type AccountUpdatedNotification struct {
	AuthMode *string   `json:"authMode"`
	PlanType *PlanType `json:"planType"`
}

// LoginEvent reports progress for a login flow.
type LoginEvent struct {
	Status          string                      `json:"status"`
	LoginID         string                      `json:"loginId,omitempty"`
	VerificationURL string                      `json:"verificationUrl,omitempty"`
	UserCode        string                      `json:"userCode,omitempty"`
	Error           string                      `json:"error,omitempty"`
	AccountUpdated  *AccountUpdatedNotification `json:"accountUpdated,omitempty"`
}
