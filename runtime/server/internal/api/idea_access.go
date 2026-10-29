package api

import (
	"context"
	"net/http"
)

type ideaAccessKey struct{}

// LocalIDEAccess must only wrap handlers behind the IDEA cookie/token boundary.
// Request headers and browser parameters cannot grant this access.
func LocalIDEAccess(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ideaAccessKey{}, true)))
	})
}

func isLocalIDEAccess(r *http.Request) bool {
	value, _ := r.Context().Value(ideaAccessKey{}).(bool)
	return value
}
