import React, { useState } from "react";
import { AppShell } from "../../src/layout/AppShell";
import { SessionList, type SessionItem } from "../../src/components/SessionList";
import { FileTree } from "../../src/components/FileTree";
import { SessionViewer } from "../../src/components/SessionViewer";
import { setRemoteDeviceMode } from "../../src/services/remoteDevice";
import type { PhoneSessionFacts, PhoneSessionFilter } from "../../src/components/remoteui/phoneSessionFacts";

const first: SessionItem = { key: "same", session_key: "same", root_id: "a", name: "Main conversation", pending: true, agent: "codex" };
const second: SessionItem = { key: "same", session_key: "same", root_id: "b", name: "Other conversation", pending: true, agent: "codex" };
const older: SessionItem = { key: "older", session_key: "older", root_id: "a", name: "Older finished", updated_at: "2026-11-19T10:00:00Z" };
const recent: SessionItem = { key: "recent", session_key: "recent", root_id: "a", name: "Recently finished", updated_at: "2026-11-21T10:00:00Z" };
const pinned: SessionItem = { key: "pinned", session_key: "pinned", root_id: "a", name: "Pinned finished", pinned_at: "2026-11-18T10:00:00Z" };
const initialGroups = [
  { rootId: "a", rootName: "Alpha project", sessions: [first, older, recent, pinned], totalCount: 4 },
  { rootId: "b", rootName: "Beta project", sessions: [second], totalCount: 1 },
  { rootId: "c", rootName: "Empty project", sessions: [], totalCount: 0 },
];
const command = Array.from({ length: 18 }, (_, index) => `echo line-${index + 1}`).join("\n");
const question = { kind: "ask_user", status: "running", callId: "request", title: "Run command",
  meta: { questions: [{ question: "Run command" }], nativeInteraction: { kind: "approval", title: "Run command", message: "", details: { command }, actions: ["allow_turn", "decline"] } },
};

export function PhoneFixture() {
  const [groups, setGroups] = useState(initialGroups);
  const [selected, setSelected] = useState(first);
  const [left, setLeft] = useState(false);
  const [right, setRight] = useState(false);
  const [multi, setMulti] = useState(false);
  const [filter, setFilter] = useState<PhoneSessionFilter>("");
  const [submitted, setSubmitted] = useState(false);
  const w = window as unknown as {
    setTestDevice: typeof setRemoteDeviceMode;
    answer?: unknown;
    newSessionCount?: number;
    addExtraAlphaSessions?: (count: number) => void;
  };
  w.setTestDevice = setRemoteDeviceMode;
  w.addExtraAlphaSessions = (count: number) => {
    setGroups((prev) =>
      prev.map((group) => {
        if (group.rootId !== "a") return group;
        const extras: SessionItem[] = Array.from({ length: count }, (_, idx) => ({
          key: `extra-${idx + 1}`,
          session_key: `extra-${idx + 1}`,
          root_id: "a",
          name: `Extra session ${idx + 1}`,
          updated_at: `2026-11-10T10:0${idx}:00Z`,
        }));
        const nextSessions = [...group.sessions, ...extras];
        return { ...group, sessions: nextSessions, totalCount: nextSessions.length };
      }),
    );
  };
  const common = { facts: (item: SessionItem): PhoneSessionFacts => ({
    state: item.root_id === "b" ? "wait" : item.pending ? "work" : "idle",
    project: item.root_id === "a" ? "Alpha project" : item.root_id === "b" ? "Beta project" : "Empty project",
    preview: "Recent preview",
  }) };
  const options = groups.filter(group => multi || group.rootId === selected.root_id)
    .flatMap(group => group.sessions).filter(item => !filter || common.facts(item).state === filter);
  const session = {
    ...selected,
    type: "chat" as const,
    exchanges: [
      { role: "user", seq: 1, content: "Run checks" },
      ...(selected.root_id === "a" && !submitted ? [{ role: "tool", seq: 2, toolCall: question }] : []),
    ],
  };
  return <AppShell
    leftOpen={left} rightOpen={right}
    onCloseLeft={() => setLeft(false)} onCloseRight={() => setRight(false)}
    onOpenLeft={() => setLeft(true)} onOpenRight={() => setRight(true)}
    sidebar={<FileTree
      entries={[{name:"Alpha project", path:"a", is_dir:true, is_root:true}]}
      childrenByPath={{}} expanded={[]} sortMode="name" rootId={selected.root_id}
      multiProjectSessionsEnabled={multi} onMultiProjectSessionsChange={setMulti}
      relayActionLabel="Public access" relayActionHelp="Standalone test" onRelayAction={() => {}}
    />}
    rightSidebar={<SessionList sessions={options} onSelect={item => { setSelected(item); setRight(false); }} />}
    main={<SessionViewer phone session={session} rootId={selected.root_id} onAskUserAnswer={answer => { w.answer = answer; setSubmitted(true); }} />}
    footer={<textarea aria-label="Composer" />}
    remotePhoneProps={{
      ...common,
      title: selected.name!,
      root: selected.root_id!,
      project: selected.root_id === "a" ? "Alpha project" : "Beta project",
      activeKey: selected.key,
      groups,
      filter,
      onFilter: setFilter,
      onSession: setSelected,
      onNewSession: () => {
        w.newSessionCount = (w.newSessionCount || 0) + 1;
        const created: SessionItem = {
          key: `new-${w.newSessionCount}`,
          session_key: `new-${w.newSessionCount}`,
          root_id: selected.root_id,
          name: `New session ${w.newSessionCount}`,
          updated_at: "2026-11-28T00:00:00Z",
        };
        setGroups((prev) =>
          prev.map((group) =>
            group.rootId === selected.root_id
              ? { ...group, sessions: [created, ...group.sessions], totalCount: group.totalCount + 1 }
              : group,
          ),
        );
        setSelected(created);
      },
      onDeleteSession: (target) => {
        setGroups((prev) =>
          prev.map((group) =>
            group.rootId === target.root_id
              ? {
                  ...group,
                  sessions: group.sessions.filter((item) => item.key !== target.key),
                  totalCount: Math.max(0, group.totalCount - 1),
                }
              : group,
          ),
        );
      },
      multiProjectSessionsEnabled: multi,
      connection: "connected",
    }}
  />;
}
