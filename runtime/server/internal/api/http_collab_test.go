package api

import (
	"bytes"
	"context"
	"encoding/json"
	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/session"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"mindfs/server/internal/collab"
	"mindfs/server/internal/fs"
)

func TestHTTPCollabTemplatesAndRunsLifecycle(t *testing.T) {
	t.Setenv("IDE_AGENT_DATA_DIR", t.TempDir())
	rootDir := t.TempDir()
	registry := fs.NewRegistry(filepath.Join(t.TempDir(), "dirs.json"))
	root, err := registry.UpsertWithMetaLocation(rootDir, fs.MetaLocationProject)
	if err != nil {
		t.Fatal(err)
	}

	appCtx := &AppContext{Dirs: registry}
	tplStore, err := collab.NewTemplateStoreAt(filepath.Join(t.TempDir(), "collab-templates.json"))
	if err != nil {
		t.Fatal(err)
	}
	svc := collab.NewService(tplStore, appCtx)
	svc.SetHomeDir(t.TempDir())
	appCtx.Collab = svc

	router := (&HTTPHandler{AppContext: appCtx}).Routes()

	// 1. Save a global Quick Mode template.
	tplBody, _ := json.Marshal(collab.Template{
		Name:      "Opus + GPT-5.4 快审",
		Mode:      collab.ModeQuick,
		IsDefault: true,
		Members: []collab.MemberSlot{
			{Role: collab.RolePrimary, Agent: "claude", Model: "claude-opus-4-6", Effort: "high"},
			{Role: collab.RoleReviewer, Agent: "codex", Model: "gpt-5.4", Effort: "xhigh"},
		},
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/collab/templates", bytes.NewReader(tplBody))
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /api/collab/templates = %d: %s", rec.Code, rec.Body.String())
	}

	var saved collab.TemplateWithAvailability
	if err := json.Unmarshal(rec.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.ID == "" || !saved.IsDefault {
		t.Fatalf("saved template = %#v", saved)
	}

	// 2. List templates.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/collab/templates?mode=quick", nil)
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/collab/templates = %d: %s", rec.Code, rec.Body.String())
	}

	// 3. Create a run directly in collab store and verify GET/DELETE endpoints.
	store, err := appCtx.GetCollabStore(root.ID)
	if err != nil {
		t.Fatal(err)
	}
	run, err := store.CreateRun(req.Context(), collab.Run{
		ID:          "run-http-1",
		RootID:      root.ID,
		Mode:        collab.ModeQuick,
		Title:       "HTTP 接口测试",
		TaskPrompt:  "测试任务",
		Status:      collab.RunStatusWaitingUser,
		CurrentStep: collab.StepDecisions,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := collab.WriteRunDoc(rootDir, run.ID, collab.DocReview, "# 审核正文"); err != nil {
		t.Fatal(err)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/collab/runs?root="+root.ID, nil)
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/collab/runs = %d: %s", rec.Code, rec.Body.String())
	}
	var listResp struct {
		Items        []collab.Run `json:"items"`
		WaitingCount int          `json:"waiting_count"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &listResp); err != nil {
		t.Fatal(err)
	}
	if len(listResp.Items) != 1 || listResp.WaitingCount != 1 {
		t.Fatalf("listResp = %#v", listResp)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/collab/runs/"+run.ID+"/docs/02-review.md?root="+root.ID, nil)
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET doc = %d: %s", rec.Code, rec.Body.String())
	}

	if _, err := collab.WriteRunDoc(rootDir, run.ID, "第02轮/02-审核意见.md", "复核结果"); err != nil {
		t.Fatal(err)
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/collab/runs/"+run.ID+"/docs/"+url.PathEscape("第02轮")+"/"+url.PathEscape("02-审核意见.md")+"?root="+root.ID, nil)
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "复核结果") {
		t.Fatalf("round doc: %d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodDelete, "/api/collab/runs/"+run.ID+"?root="+root.ID, nil)
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE run = %d: %s", rec.Code, rec.Body.String())
	}
}

func TestCollabFileHistoryUsesRecordedTurns(t *testing.T) {
	registry := fs.NewRegistry(filepath.Join(t.TempDir(), "dirs.json"))
	root, err := registry.UpsertWithMetaLocation(t.TempDir(), fs.MetaLocationProject)
	if err != nil {
		t.Fatal(err)
	}
	app := &AppContext{Dirs: registry}
	mgr, err := app.GetSessionManager(root.ID)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	now := time.Now().UTC()
	addSession := func(key, runID string, turns ...string) {
		t.Helper()
		ss, err := mgr.Create(ctx, session.CreateInput{Key: key, Name: key, Source: session.SourceCollabStage, TaskID: runID, Type: session.TypeChat})
		if err != nil {
			t.Fatal(err)
		}
		for i, file := range turns {
			ts := now.Add(time.Duration(i) * time.Minute)
			if err := mgr.AddExchangeForAgentAt(ctx, ss, "assistant", "交付路径", "codex", "", "", "", ts); err != nil {
				t.Fatal(err)
			}
			patch := "diff --git a/" + file + " b/" + file + "\n--- a/" + file + "\n+++ b/" + file + "\n@@ -1 +1 @@\n-old\n+new"
			if err := mgr.AddExchangeAux(ctx, key, session.ExchangeAux{Seq: i + 1, TurnDiff: &agenttypes.TurnDiffUpdate{Workspace: true, Partial: i == 1, Diff: patch}}); err != nil {
				t.Fatal(err)
			}
		}
	}
	addSession("implementation", "run-a", "initial.go")
	addSession("response", "run-a", "shared.go", "manual.go")
	addSession("fix", "run-a", "shared.go", "final.go")
	addSession("other", "run-b", "secret.go")
	for _, tc := range []struct {
		since time.Time
		want  []string
	}{
		{time.Time{}, []string{"final.go", "initial.go", "manual.go", "shared.go"}},
		{now.Add(time.Second), []string{"final.go", "manual.go"}},
	} {
		got, err := app.CollabChangedFiles(ctx, root.ID, "run-a", tc.since)
		if err != nil || !got.Partial || !slices.Equal(got.Paths, tc.want) {
			t.Fatalf("got %+v, want %v: %v", got, tc.want, err)
		}
	}
	router := (&HTTPHandler{AppContext: app}).Routes()
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/collab/runs/run-a/changes?root="+root.ID+"&path=shared.go", nil))
	var turns []collabFileTurn
	if err := json.Unmarshal(rec.Body.Bytes(), &turns); err != nil || rec.Code != 200 || len(turns) != 2 {
		t.Fatalf("file history: %s %v", rec.Body.String(), err)
	}
	for _, turn := range turns {
		if !strings.Contains(turn.Update.Diff, "shared.go") || strings.Contains(turn.Update.Diff, "final.go") {
			t.Fatalf("wrong file: %s", turn.Update.Diff)
		}
	}
}
