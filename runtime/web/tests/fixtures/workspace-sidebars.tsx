import { useState } from "react";
import { SessionList, MultiProjectSessionList, type SessionItem, type ProjectSessionGroup } from "../../src/components/SessionList";
import { FileTree } from "../../src/components/FileTree";
import { HandoffPackDialog } from "../../src/components/HandoffPackDialog";
import { ScheduledAgentTaskDialog } from "../../src/components/ScheduledAgentTaskDialog";
import { ActionBar } from "../../src/components/ActionBar";
import { AppShell } from "../../src/layout/AppShell";

const stamp = new Date(Date.now() - 120000).toISOString();
const make = (key: string, name: string, patch: Partial<SessionItem> = {}): SessionItem => ({ key, session_key: key, name, agent: "codex", type: "chat", root_id: "a", updated_at: stamp, ...patch });
const initial: ProjectSessionGroup[] = [
  { rootId: "a", rootName: "idea-ai-agent", totalCount: 2, sessions: [make("main", "优化远程侧栏"), ...[1,2,3,4].map(i => make(`run-${i}`, `检查模块 ${i}`, { parent_session_key: "main", pending: true })), make("done", "已结束的检查", { parent_session_key: "main" }), make("deep", "嵌套检查", { parent_session_key: "done" }), make("other", "整理安装说明")] },
  { rootId: "b", rootName: "mindfs", totalCount: 1, sessions: [make("main", "同名 ID 的另一项目", { root_id: "b" }), make("done", "B 的子会话", { root_id: "b", parent_session_key: "main" })] },
];
const agents = [{ name: "codex", available: true, installed: true, models: [{ id: "test-model", name: "Test model" }], default_model_id: "test-model" }];

export function WorkspaceFixture() {
  const [groups, setGroups] = useState(initial);
  const [selected, setSelected] = useState(initial[0].sessions[0]);
  const [single, setSingle] = useState(false);
  const [search, setSearch] = useState(false);
  const [handoff, setHandoff] = useState<SessionItem | null>(null);
  const [schedule, setSchedule] = useState<SessionItem | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [draftRequest, setDraftRequest] = useState<{ id: number; content: string; mode?: "append" } | null>(null);
  const [left, setLeft] = useState(true);
  const [right, setRight] = useState(true);
  const w = window as typeof window & { fixture: object; actions: unknown[] };
  w.actions ||= [];
  const record = (action: string, session: SessionItem) => w.actions.push({ action, root: session.root_id, key: session.key });
  w.fixture = {
    setGroups, setSelected, setSingle, setSearch, setHandoff, setLeft, setRight,
    finish: () => setGroups(prev => prev.map(group => ({ ...group, sessions: group.sessions.map(s => s.key === "run-1" ? { ...s, pending: false } : s) }))),
    generalSchedule: () => { setSchedule(null); setScheduleOpen(true); },
  };
  const actions = {
    onSelect: setSelected,
    onScheduledTask: (s: SessionItem) => { setSchedule(s); setScheduleOpen(true); },
    onHandoffPack: setHandoff,
    onPin: (s: SessionItem) => { record("pin", s); return true; },
    onSync: (s: SessionItem) => record("sync", s),
    onRename: (s: SessionItem, name: string) => { record("rename", s); setGroups(prev => prev.map(g => ({ ...g, sessions: g.sessions.map(item => item.key === s.key && g.rootId === s.root_id ? { ...item, name } : item) }))); return true; },
    onDelete: (s: SessionItem) => record("delete", s),
    onLoadChildren: (s: SessionItem, options?: { beforeTime?: string }) => {
      record(options?.beforeTime ? "older-children" : "children", s);
      if (options?.beforeTime) setGroups(prev => prev.map(g => g.rootId === s.root_id ? { ...g, sessions: [...g.sessions, make("older", "Older child", { parent_session_key: s.key, updated_at: "2025-01-01T00:00:00Z" })] } : g));
      return { hasMore: !options?.beforeTime };
    },
  };
  const sessions = single ? <SessionList sessions={groups[0].sessions} selectedKey={selected.key} searchResultsMode={search} searchQuery="检查" {...actions} />
    : <MultiProjectSessionList groups={groups} selectedKey={selected.key} selectedRootId={selected.root_id} onProjectClick={root => w.actions.push({ action: "project", root })} {...actions} />;
  return <>
    <AppShell leftOpen={left} rightOpen={right} onCloseLeft={() => setLeft(false)} onCloseRight={() => setRight(false)} onOpenLeft={() => { setLeft(true); if (innerWidth < 768) setRight(false); }} onOpenRight={() => { setRight(true); if (innerWidth < 768) setLeft(false); }}
      sidebar={<FileTree entries={[{ name: "idea-ai-agent", path: "a", is_dir: true, is_root: true }, { name: "mindfs", path: "b", is_dir: true, is_root: true }]} childrenByPath={{}} expanded={[]} sortMode="name" rootId="a" selectedDirKey="a:." onRelayAction={() => {}} />}
      rightSidebar={sessions}
      main={<div data-testid="middle" style={{ padding: 24 }}><h2>继续优化远程工作区</h2><p>中间内容用于核对现有布局和样式。</p></div>}
      footer={<ActionBar status="connected" currentRootId="a" currentSession={{ ...selected, exchanges: [] }} editDraftRequest={draftRequest} />}
    />
    <HandoffPackDialog session={handoff} onClose={() => setHandoff(null)} onInsert={content => setDraftRequest(prev => ({ id: (prev?.id || 0) + 1, content, mode: "append" }))} />
    <ScheduledAgentTaskDialog open={scheduleOpen} rootId={schedule?.root_id || "a"} session={schedule} agents={agents} onClose={() => setScheduleOpen(false)} />
  </>;
}
