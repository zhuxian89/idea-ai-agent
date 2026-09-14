package codex

import (
	"context"
	"encoding/json"
	"sync/atomic"

	"github.com/fanwenlin/codex-go-sdk/types"
)

type nativeRequestState struct {
	claimed atomic.Bool
	ctx     context.Context
	cancel  context.CancelFunc
}

func isNativeInteractionEvent(method string) bool {
	return method == "mcpServer/elicitation/request" || method == "item/permissions/requestApproval"
}

func (a *AppServerExec) submitServerResponse(ctx context.Context, event appEvent, handler types.ServerRequestHandler) {
	if event.native == nil {
		a.submitNativeResponse(ctx, event, handler)
		return
	}
	if !event.native.claimed.CompareAndSwap(false, true) {
		return
	}
	ctx, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(event.native.ctx, cancel)
	defer func() {
		stop()
		cancel()
		event.native.cancel()
		a.nativeRequests.CompareAndDelete(*event.ID, event.native)
	}()
	if event.native.ctx.Err() != nil {
		return
	}
	a.submitNativeResponse(ctx, event, handler)
}

func (a *AppServerExec) submitNativeResponse(ctx context.Context, event appEvent, handler types.ServerRequestHandler) {
	var result any = map[string]any{"action": "cancel", "content": nil}
	if event.Method == "item/permissions/requestApproval" {
		result = map[string]any{"permissions": map[string]any{}, "scope": "turn"}
	}
	if handler != nil {
		response, err := handler(types.ServerRequest{Context: ctx, ID: *event.ID, Method: event.Method, Params: json.RawMessage(event.Params)})
		if err == nil && response != nil {
			result = response
		} else if err != nil {
			a.logf("app server: native interaction: %v", err)
		}
	}
	if event.native != nil && event.native.ctx.Err() != nil {
		return
	}
	if err := a.sendResponse(*event.ID, result); err != nil {
		a.logf("app server: native response: %v", err)
	}
}
