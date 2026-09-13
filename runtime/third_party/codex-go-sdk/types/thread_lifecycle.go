package types

// ThreadUnsubscribeStatus describes the result of removing the current
// app-server connection's subscription to a thread.
type ThreadUnsubscribeStatus string

const (
	ThreadUnsubscribeStatusUnsubscribed  ThreadUnsubscribeStatus = "unsubscribed"
	ThreadUnsubscribeStatusNotSubscribed ThreadUnsubscribeStatus = "notSubscribed"
	ThreadUnsubscribeStatusNotLoaded     ThreadUnsubscribeStatus = "notLoaded"
)

// ThreadUnsubscribeResponse is returned by thread/unsubscribe.
type ThreadUnsubscribeResponse struct {
	Status ThreadUnsubscribeStatus `json:"status"`
}
