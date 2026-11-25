package api

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"mindfs/server/internal/e2ee"
	"mindfs/server/internal/relay"
)

func (h *HTTPHandler) handleRelayStatus(w http.ResponseWriter, r *http.Request) {
	manager := h.AppContext.GetRelayManager()
	if manager == nil && h.RelayStatus == nil {
		respondError(w, http.StatusServiceUnavailable, errServiceUnavailable("relay manager not configured"))
		return
	}
	status := relay.Status{NoRelayer: true}
	if manager != nil {
		status = manager.Status()
	}
	status = h.relayStatusWithE2EE(status)
	if isLocalIDEAccess(r) {
		status.E2EERequired = false
		respondJSON(w, http.StatusOK, status)
		return
	}
	if h.RelayStatus != nil {
		var err error
		status, err = h.RelayStatus(r.Context())
		if err != nil {
			respondError(w, http.StatusServiceUnavailable, err)
			return
		}
	}
	status = h.relayStatusWithE2EE(status)
	if !status.E2EERequired {
		respondJSON(w, http.StatusOK, status)
		return
	}

	sess, err := h.relayStatusSession(r)
	if err != nil {
		respondError(w, http.StatusUnauthorized, err)
		return
	}
	if sess == nil {
		respondJSON(w, http.StatusOK, publicRelayStatus(status))
		return
	}
	if err := writeProtectedJSON(w, http.StatusOK, sess.Key, status); err != nil {
		respondError(w, http.StatusServiceUnavailable, err)
		return
	}
}

func (h *HTTPHandler) relayStatusSession(r *http.Request) (*e2ee.Session, error) {
	if strings.TrimSpace(r.Header.Get(e2eeHeaderName)) == "" {
		return nil, nil
	}
	sess, protected, err := h.requireProtectedHTTPSession(r)
	if !protected {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	sess, err = h.requireRequestProof(r)
	if err != nil {
		return nil, err
	}
	return sess, nil
}

func (h *HTTPHandler) handleRelayBindStart(w http.ResponseWriter, _ *http.Request) {
	manager := h.AppContext.GetRelayManager()
	if manager == nil {
		respondError(w, http.StatusServiceUnavailable, errServiceUnavailable("relay manager not configured"))
		return
	}
	status, err := manager.StartBinding()
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, errServiceUnavailable(err.Error()))
		return
	}
	respondJSON(w, http.StatusOK, h.relayStatusWithE2EE(status))
}

func (h *HTTPHandler) relayStatusWithE2EE(status relay.Status) relay.Status {
	if h == nil || h.AppContext == nil {
		return status
	}
	e2eeManager := h.AppContext.GetE2EEManager()
	if e2eeManager == nil || !e2eeManager.Enabled() {
		status.E2EERequired = false
		status.E2EENodeID = ""
		return status
	}
	status.E2EERequired = true
	status.E2EENodeID = e2eeManager.NodeID()
	return status
}

func publicRelayStatus(status relay.Status) relay.Status {
	return relay.Status{
		NoRelayer:         status.NoRelayer,
		TokenStationBound: status.TokenStationBound,
		E2EERequired:      status.E2EERequired,
		E2EENodeID:        status.E2EENodeID,
	}
}

func (h *HTTPHandler) handleRelayTips(w http.ResponseWriter, _ *http.Request) {
	if h.AppContext == nil || h.AppContext.GetRelayTipsService() == nil {
		respondJSON(w, http.StatusOK, nil)
		return
	}
	respondJSON(w, http.StatusOK, h.AppContext.GetRelayTipsService().Get())
}

func (h *HTTPHandler) handleE2EEOpen(w http.ResponseWriter, r *http.Request) {
	manager := h.AppContext.GetE2EEManager()
	if manager == nil || !manager.Enabled() {
		respondError(w, http.StatusForbidden, errServiceUnavailable("e2ee_required"))
		return
	}
	var req struct {
		ClientID    string `json:"client_id"`
		NodeID      string `json:"node_id"`
		ClientEphPK string `json:"client_eph_pk"`
		ClientNonce string `json:"client_nonce"`
		Proof       string `json:"proof"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("invalid e2ee open payload"))
		return
	}
	req.ClientID = strings.TrimSpace(req.ClientID)
	req.NodeID = strings.TrimSpace(req.NodeID)
	req.ClientEphPK = strings.TrimSpace(req.ClientEphPK)
	req.ClientNonce = strings.TrimSpace(req.ClientNonce)
	req.Proof = strings.TrimSpace(req.Proof)
	if req.ClientID == "" || req.NodeID == "" || req.ClientEphPK == "" || req.ClientNonce == "" || req.Proof == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("client_id, node_id, client_eph_pk, client_nonce and proof are required"))
		return
	}
	if req.NodeID != manager.NodeID() {
		respondError(w, http.StatusForbidden, errInvalidRequest("e2ee_proof_invalid"))
		return
	}
	expectedProof := e2ee.BuildOpenProof(manager.PairingSecret(), req.NodeID, req.ClientEphPK, req.ClientNonce)
	if !e2ee.VerifyProof(expectedProof, req.Proof) {
		respondError(w, http.StatusForbidden, errInvalidRequest("e2ee_proof_invalid"))
		return
	}
	nodePriv, nodeEphPK, err := e2ee.GenerateECDHKeypair()
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, err)
		return
	}
	clientPub, err := e2ee.DecodePublicKey(req.ClientEphPK)
	if err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("invalid client_eph_pk"))
		return
	}
	serverNonceBytes := make([]byte, 16)
	if _, err := rand.Read(serverNonceBytes); err != nil {
		respondError(w, http.StatusServiceUnavailable, err)
		return
	}
	serverNonce := base64.StdEncoding.EncodeToString(serverNonceBytes)
	derived, err := e2ee.DeriveKey(manager.PairingSecret(), req.NodeID, req.ClientEphPK, nodeEphPK, req.ClientNonce, serverNonce, nodePriv, clientPub)
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, err)
		return
	}
	if _, err := manager.OpenSessionForNode(req.ClientID, derived, req.NodeID); err != nil {
		respondError(w, http.StatusServiceUnavailable, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{
		"ok":           true,
		"node_eph_pk":  nodeEphPK,
		"server_nonce": serverNonce,
		"server_proof": e2ee.BuildAcceptProof(manager.PairingSecret(), req.NodeID, req.ClientEphPK, nodeEphPK, req.ClientNonce, serverNonce),
	})
}
