import React, { useState } from "react";
import type { AgentStatus } from "../../services/agents";
import type { CollabRun } from "../../services/collab";
import { formatCollabMemberBadge } from "./collabModelDisplay";

export type RunFilter = "all" | "wait" | "running";

export interface RunProject {
  id: string;
  name: string;
  path?: string;
}

/** 其他项目的列表读取状态：读取中、已读到、失败（带原因，不当成「没有记录」）。 */
export type OtherProjectRuns =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; items: CollabRun[] };

const FOLD_LIMIT = 6;

/** 一条记录的类型：开大会 / 快速模式 / 开大会已转入快速实现。 */
export function runKind(run: CollabRun): { key: "quick" | "group" | "both"; label: string } {
  if (run.mode === "group") return run.quick_run_id ? { key: "both", label: "大会 → 快速" } : { key: "group", label: "大会" };
  return { key: "quick", label: "快速" };
}

/** 状态说明：类型已由标签表示，这里只写进度。 */
export function runStatusLabel(run: CollabRun): string {
  if (run.mode === "group") {
    if (run.quick_run_id) {
      switch (run.quick_run_status) {
        case "completed": return "实现已完成";
        case "failed": return "实现出错";
        case "waiting_user": return "实现中 · 等你继续";
        default: return "实现中";
      }
    }
    if (run.current_step === "ready") return "正式计划待确认";
    return run.status === "running" ? `第 ${run.round || 1} 轮讨论中` : "等待作者";
  }
  if (run.status === "waiting_user") return run.current_step === "decisions" ? "分歧待你拍板" : "等你继续";
  if (run.status === "running") {
    const current = run.steps?.find((step) => step.key === run.current_step);
    return current ? `正在：${current.title}` : "执行中";
  }
  if (run.status === "completed") {
    if (run.test_status === "passed") return "已完成 · 测试通过";
    if (run.test_status === "failed") return "已完成 · 测试失败";
    return "已完成 · 一写一审";
  }
  if (run.status === "failed") return "执行出错";
  return "待开始";
}

export function runMatchesFilter(run: CollabRun, filter: RunFilter): boolean {
  const status = run.quick_run_status || run.status;
  if (filter === "wait") return status === "waiting_user";
  if (filter === "running") return status === "running";
  return true;
}

interface Props {
  projects: RunProject[];
  currentRootId: string | null;
  currentRuns: CollabRun[];
  others: Record<string, OtherProjectRuns>;
  filter: RunFilter;
  activeRunId: string | null;
  agents: AgentStatus[];
  onOpen: (rootId: string, runId: string) => void;
  onDelete: (event: React.MouseEvent, rootId: string, runId: string) => void;
  onRetry: () => void;
}

function RunRow({ run, rootId, active, agents, onOpen, onDelete }: {
  run: CollabRun;
  rootId: string;
  active: boolean;
  agents: AgentStatus[];
  onOpen: Props["onOpen"];
  onDelete: Props["onDelete"];
}) {
  const kind = runKind(run);
  const members = (run.snapshot?.members || [])
    .map((member) => formatCollabMemberBadge(member, agents, { resolveDefaultFromAgent: false }))
    .join(" → ");
  return (
    <div
      className={`collab-run-item ${active ? "active" : ""}`}
      data-kind={kind.key}
      onClick={() => onOpen(rootId, run.id)}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpen(rootId, run.id);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="collab-run-body">
        <div className="collab-run-title" title={run.title}>{run.title}</div>
        <div className="collab-run-sub">
          <span className="collab-run-kind" data-kind={kind.key}>{kind.label}</span>
          <span className={`collab-run-dot ${run.quick_run_status || run.status}`} aria-hidden="true" />
          <span className="collab-run-status">{runStatusLabel(run)}</span>
        </div>
        {members ? <div className="collab-run-sub collab-run-members collab-mono" title={members}>{members}</div> : null}
      </div>
      {(run.quick_run_status || run.status) !== "running" ? (
        <button
          type="button"
          className="collab-icon-btn collab-run-delete"
          title="删除记录"
          aria-label="删除记录"
          onClick={(event) => onDelete(event, rootId, run.id)}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

function ProjectGroup({ project, current, runs, totalRuns, filter, activeRunId, agents, onOpen, onDelete }: {
  project: RunProject;
  current: boolean;
  runs: CollabRun[];
  totalRuns: number;
  filter: RunFilter;
  activeRunId: string | null;
  agents: AgentStatus[];
  onOpen: Props["onOpen"];
  onDelete: Props["onDelete"];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const activeIndex = runs.findIndex((run) => run.id === activeRunId);
  const showAll = expanded || activeIndex >= FOLD_LIMIT;
  const visible = showAll ? runs : runs.slice(0, FOLD_LIMIT);
  const waiting = runs.filter((run) => (run.quick_run_status || run.status) === "waiting_user").length;
  return (
    <section className="collab-run-group" data-current={current ? "1" : undefined} aria-label={project.name}>
      <button
        type="button"
        className="collab-run-group-head"
        aria-expanded={!collapsed}
        title={project.path || project.name}
        onClick={() => setCollapsed((value) => !value)}
      >
        <svg className="collab-run-group-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
        <span className="collab-run-group-name">{project.name}</span>
        {current ? <span className="collab-run-group-current">当前</span> : null}
        {waiting > 0 ? <span className="collab-run-group-wait" title={`${waiting} 条等你处理`}>{waiting}</span> : null}
        <span className="collab-run-group-count">{runs.length}</span>
      </button>
      {collapsed ? null : (
        <div className="collab-run-group-body">
          {runs.length === 0 ? (
            <div className="collab-run-empty" role="status">
              {totalRuns > 0 && filter !== "all"
                ? `「${project.name}」没有符合筛选的记录`
                : `「${project.name}」暂无协作记录`}
            </div>
          ) : (
            <>
              {visible.map((run) => (
                <RunRow key={run.id} run={run} rootId={project.id} active={activeRunId === run.id} agents={agents} onOpen={onOpen} onDelete={onDelete} />
              ))}
              {runs.length > visible.length ? (
                <button type="button" className="collab-run-more" onClick={() => setExpanded(true)}>
                  还有 {runs.length - visible.length} 条
                </button>
              ) : null}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** 多 Agent 侧栏的记录列表：所有项目按项目分组，当前项目在最上，每条带类型标签。 */
export function CollabRunList({ projects, currentRootId, currentRuns, others, filter, activeRunId, agents, onOpen, onDelete, onRetry }: Props) {
  const currentProject = projects.find((item) => item.id === currentRootId) || (currentRootId ? { id: currentRootId, name: "当前项目" } : null);
  const groups: Array<{ project: RunProject; current: boolean; all: CollabRun[] }> = [];
  if (currentProject) groups.push({ project: currentProject, current: true, all: currentRuns });
  let loading = 0;
  let failed = 0;
  for (const project of projects) {
    if (project.id === currentRootId) continue;
    const entry = others[project.id];
    if (!entry || entry.state === "loading") { loading += 1; continue; }
    if (entry.state === "error") { failed += 1; continue; }
    // 其他项目没有记录就不占位，避免一长串空分组。
    if (entry.items.length > 0) groups.push({ project, current: false, all: entry.items });
  }
  const everyoneEmpty = groups.every((group) => group.all.length === 0) && loading === 0 && failed === 0;
  return (
    <div className="collab-run-list">
      {everyoneEmpty && !currentProject ? <div className="collab-run-empty" role="status">暂无协作记录</div> : null}
      {groups.map((group) => (
        <ProjectGroup
          key={group.project.id}
          project={group.project}
          current={group.current}
          runs={group.all.filter((run) => runMatchesFilter(run, filter))}
          totalRuns={group.all.length}
          filter={filter}
          activeRunId={activeRunId}
          agents={agents}
          onOpen={onOpen}
          onDelete={onDelete}
        />
      ))}
      {loading > 0 ? <div className="collab-run-note" role="status">正在读取其他项目的记录…</div> : null}
      {failed > 0 ? (
        <div className="collab-run-note collab-run-note--error" role="alert">
          {failed} 个项目的记录读取失败
          <button type="button" className="collab-ghost-btn" onClick={onRetry}>重试</button>
        </div>
      ) : null}
    </div>
  );
}
