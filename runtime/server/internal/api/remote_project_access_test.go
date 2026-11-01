package api

import (
	"net/http/httptest"
	"testing"
)

func TestRemoteProjectProofPreservesMountAndEscaping(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/files/a%2Fb?x=%E4%B8%AD", nil)
	r = RemoteProjectAccess(r, "/p/P/api/files/a%2Fb", func() bool { return true })
	if got := requestProofPath(r); got != "/p/P/api/files/a%2Fb?x=%E4%B8%AD" {
		t.Fatal(got)
	}
	r = httptest.NewRequest("GET", "/ws?client_id=c&e2ee_ts=now&e2ee_proof=x", nil)
	r = RemoteProjectAccess(r, "/p/P/ws", func() bool { return false })
	if got := wsProofPath(r); got != "/p/P/ws?client_id=c" {
		t.Fatal(got)
	}
	if isLocalIDEAccess(r) || remoteProjectAllowed(r) {
		t.Fatal("remote context granted native access or ignored revoke")
	}
}
