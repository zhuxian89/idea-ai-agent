import React, { useState } from "react";
import "../../src/services/remoteUi";
import { RemoteShell } from "../../src/layout/RemoteShell";
import { GlowSettingsDialog } from "../../src/components/remoteui/GlowSettingsDialog";
import { normalizeGlowConfig } from "../../src/services/remoteGlow";
import { SessionViewer } from "../../src/components/SessionViewer";
import { SessionList, type SessionItem } from "../../src/components/SessionList";
import { FileTree } from "../../src/components/FileTree";
import { sessionService } from "../../src/services/session";

declare global { interface Window { fixture: any; configSwitchEvents: number; desktopAnswer?: unknown } }

const baseQuestion = {
  kind: "ask_user",
  status: "running",
  callId: "ask-desktop-1",
  title: "Confirm deployment target",
  meta: {
    questions: [{
      question: "Confirm deployment target",
      options: [{ label: "Staging" }, { label: "Production" }],
    }],
  },
};

export function RemoteDesignFixture() {
  const [left, setLeft] = useState(true);
  const [right, setRight] = useState(true);
  const [multi, setMulti] = useState(false);
  const [glow, setGlow] = useState(false);
  const [connected, setConnected] = useState(true);
  const [mode, setMode] = useState<"idle" | "work" | "long" | "wait" | "offline" | "recovery">("work");
  const [answered, setAnswered] = useState(false);
  const [sessionState, setSessionState] = useState<"pending" | "idle">("pending");
  const [turnSeq, setTurnSeq] = useState(1);
  window.configSwitchEvents = window.configSwitchEvents || 0;
  if (!(window as any).__listening) {
    (window as any).__listening = true;
    window.addEventListener("mindfs:open-agent-config-switch", () => { window.configSwitchEvents += 1; });
  }

  const pending = sessionState === "pending" && mode !== "idle";
  const turnTimestamp = `2026-11-27T04:00:0${turnSeq}Z`;
  const exchanges = mode === "idle"
    ? [{ role: "user", seq: 1, content: "Hello" }, { role: "assistant", seq: 2, content: "Ready" }]
    : mode === "long"
      ? [
          { role: "user", seq: turnSeq, content: "Run checks", timestamp: turnTimestamp },
          { role: "tool", seq: turnSeq + 1, toolCall: { callId: "cmd-long", kind: "execute", status: "running", title: "pnpm --filter runtime-web run verify-very-long-command-name-that-should-truncate-without-wrapping-or-moving-the-composer-input-box" } },
        ]
      : mode === "wait" && !answered
        ? [
            { role: "user", seq: turnSeq, content: "Deploy", timestamp: turnTimestamp },
            { role: "tool", seq: turnSeq + 1, toolCall: baseQuestion },
          ]
        : [
            { role: "user", seq: turnSeq, content: "Working", timestamp: turnTimestamp },
            { role: "tool", seq: turnSeq + 1, toolCall: { callId: "edit-work", kind: "edit", status: "running", title: "Update layout" } },
          ];

  const session: SessionItem = {
    key: "desk-session",
    session_key: "desk-session",
    root_id: "proj-1",
    name: "Desktop session",
    pending,
    agent: "codex",
    type: "chat",
    exchanges,
  };

  window.fixture = {
    openGlow: () => setGlow(true),
    normalize: normalizeGlowConfig,
    setMode: (next: typeof mode) => {
      setAnswered(false);
      setConnected(next !== "offline");
      setSessionState(next === "idle" ? "idle" : "pending");
      setMode(next);
      if (next === "work") {
        setTurnSeq((n) => n + 1);
      }
      if (next === "recovery") {
        sessionService.handleMessage({
          type: "session.stream",
          payload: { root_id: "proj-1", session_key: "desk-session", event: { type: "recovery", data: { message: "Recovering session" } } },
        });
      }
    },
    emitTerminal: (kind: "done" | "error") => {
      setSessionState("idle");
      sessionService.handleMessage({
        type: kind === "error" ? "session.error" : "session.done",
        payload: { root_id: "proj-1", session_key: "desk-session" },
        error: kind === "error" ? { message: "Agent exited" } : undefined,
      });
    },
  };

  return (
    <>
      <RemoteShell
        left={{
          content: (
            <div id="files-pane" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              <FileTree
                entries={[{ name: "Demo project", path: "proj-1", is_dir: true, is_root: true }]}
                childrenByPath={{}}
                expanded={[]}
                sortMode="name"
                rootId="proj-1"
                rootSessionIndicators={{ "proj-1": { bound: true, pending: true } }}
                multiProjectSessionsEnabled={multi}
                onMultiProjectSessionsChange={setMulti}
              />
            </div>
          ),
          open: left,
          width: "260px",
          toggleLabel: left ? "Collapse files" : "Expand files",
          onToggle: () => setLeft((v) => !v),
        }}
        right={{
          content: (
            <div id="sessions-pane" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              <SessionList sessions={[session]} selectedKey="desk-session" onSelect={() => {}} />
            </div>
          ),
          open: right,
          width: "280px",
          toggleLabel: right ? "Collapse sessions" : "Expand sessions",
          onToggle: () => setRight((v) => !v),
        }}
        main={
          <div id="main-body" style={{ display: "flex", flex: 1, minHeight: 0 }}>
            <SessionViewer
              connected={connected}
              session={session}
              rootId="proj-1"
              onAskUserAnswer={(answer) => {
                window.desktopAnswer = answer;
                setAnswered(true);
                setSessionState("idle");
              }}
            />
          </div>
        }
        footer={<div id="footer-body" style={{ width: "100%", padding: "0 16px 12px", boxSizing: "border-box" }}><textarea aria-label="Composer" style={{ width: "100%", height: "44px" }} /></div>}
        topBar={{ multiProjectSessionsEnabled: multi, onMultiProjectSessionsChange: setMulti }}
        fileMenuWidth="182px"
      />
      <GlowSettingsDialog open={glow} onClose={() => setGlow(false)} />
    </>
  );
}
