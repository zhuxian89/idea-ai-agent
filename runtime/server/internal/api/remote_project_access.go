package api

import (
	"context"
	"net/http"
)

type remoteProjectKey struct{}
type remoteProjectRequest struct {
	proofPath string
	allowed   func() bool
}

// RemoteProjectAccess is only applied after the private host credential and
// project mount have been verified. It preserves the signed path while the
// router sees the unmounted path; it never grants native IDEA privileges.
func RemoteProjectAccess(r *http.Request, escapedPath string, allowed func() bool) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), remoteProjectKey{}, remoteProjectRequest{escapedPath, allowed}))
}

func isRemoteProjectAccess(r *http.Request) bool {
	_, ok := r.Context().Value(remoteProjectKey{}).(remoteProjectRequest)
	return ok
}

func remoteProjectAllowed(r *http.Request) bool {
	access, ok := r.Context().Value(remoteProjectKey{}).(remoteProjectRequest)
	return ok && access.allowed()
}

func remoteProofPath(r *http.Request) string {
	if access, ok := r.Context().Value(remoteProjectKey{}).(remoteProjectRequest); ok {
		return access.proofPath
	}
	return r.URL.Path
}
