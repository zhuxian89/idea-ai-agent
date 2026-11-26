import type { TurnDiffUpdate } from "./session";
import { protectedFetch, protectedJSON } from "./api";
import { appURL } from "./base";

export interface CollabFileTurn {
  session_key: string;
  title: string;
  seq: number;
  update: TurnDiffUpdate;
}

function changesURL(rootId: string, runId: string, path?: string) {
  const query = new URLSearchParams({ root: rootId });
  if (path) query.set("path", path);
  return appURL(`/api/collab/runs/${encodeURIComponent(runId)}/changes?${query}`);
}

export type CollabMode = "quick" | "group";
export type CollabRole = "primary" | "reviewer" | "member" | "author";

export interface CollabMemberSlot {
  slot_id: string;
  role: string;
  agent: string;
  model?: string;
  effort?: string;
  permission_mode?: string;
}

export interface CollabMemberAvailability {
  slot_id: string;
  role: string;
  agent: string;
  model?: string;
  available: boolean;
  reason?: string;
}

export interface CollabTemplate {
  id: string;
  name: string;
  mode: CollabMode;
  is_default?: boolean;
  members: CollabMemberSlot[];
  skill_paths?: string[];
  final_author_slot_id?: string;
  max_rounds?: number;
  created_at: string;
  updated_at: string;
}

export interface CollabTemplateWithAvailability extends CollabTemplate {
  availability: CollabMemberAvailability[];
  all_available: boolean;
}

export interface CollabSkillSummary {
  name: string;
  description?: string;
  path: string;
  source: string;
}

export interface CollabStepCard {
  key: string;
  title: string;
  role: string;
  slot_id?: string;
  agent?: string;
  model?: string;
  effort?: string;
  read_only?: boolean;
  author_note?: string;
  session_key?: string;
  doc_path?: string;
  status: "pending" | "running" | "waiting_user" | "done" | "skipped" | "failed";
  summary?: string;
  started_at?: string;
  finished_at?: string;
}

export interface CollabReviewItem {
  item_id: string;
  ordinal: number;
  dimension: "functional" | "standard" | string;
  severity: "high" | "medium" | "low" | string;
  file_path: string;
  line_start: number;
  line_end?: number;
  citation_verified: boolean;
  citation_note?: string;
  rule_ref?: string;
  title: string;
  description: string;
  primary_status?: "accepted" | "disputed" | string;
  primary_note?: string;
  parse_fallback?: boolean;
  author_decision?: "accept_review" | "keep_primary" | "custom" | string;
  author_note?: string;
  updated_at?: string;
}

export interface CollabRun {
  round?: number;
  id: string;
  root_id: string;
  mode: CollabMode;
  title: string;
  task_prompt: string;
  template_id?: string;
  template_name?: string;
  snapshot: {
    template_id?: string;
    template_name?: string;
    mode: CollabMode;
    members: CollabMemberSlot[];
    skill_paths?: string[];
  };
  status: "running" | "waiting_user" | "completed" | "failed" | "canceled" | string;
  current_step: string;
  steps: CollabStepCard[];
  readonly_check_state?: "clean" | "modified" | "unobserved" | string;
  readonly_check_note?: string;
  test_status?: "passed" | "failed" | "skipped" | string;
  test_command?: string;
  test_summary?: string;
  docs_cleaned?: boolean;
  error_message?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface CollabRunDetail {
  run: CollabRun;
  review_items: CollabReviewItem[];
  docs?: string[];
  progress_action?: "running" | "resumed" | "waiting_for_decisions" | "changed" | "unchanged";
}

export interface CollabItemDecision {
  item_id: string;
  decision: "accept_review" | "keep_primary" | "custom";
  note?: string;
}

export const collabService = {
  async listTemplates(mode: CollabMode = "quick"): Promise<{
    items: CollabTemplateWithAvailability[];
    skills: CollabSkillSummary[];
  }> {
    return protectedJSON<{
      items: CollabTemplateWithAvailability[];
      skills: CollabSkillSummary[];
    }>(appURL(`/api/collab/templates?mode=${encodeURIComponent(mode)}`));
  },

  async saveTemplate(
    tpl: Partial<CollabTemplate> & { name: string; mode: CollabMode; members: CollabMemberSlot[] },
  ): Promise<CollabTemplateWithAvailability> {
    const isUpdate = Boolean(tpl.id);
    const url = isUpdate
      ? appURL(`/api/collab/templates/${encodeURIComponent(tpl.id!)}`)
      : appURL("/api/collab/templates");
    return protectedJSON<CollabTemplateWithAvailability>(url, {
      method: isUpdate ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tpl),
    });
  },

  async deleteTemplate(id: string): Promise<void> {
    const resp = await protectedFetch(
      appURL(`/api/collab/templates/${encodeURIComponent(id)}`),
      { method: "DELETE" },
    );
    if (!resp.ok) {
      throw new Error(`删除模板失败 (${resp.status})`);
    }
  },

  async listRuns(
    rootId: string,
    mode = "",
  ): Promise<{ items: CollabRun[]; waiting_count: number }> {
    const params = new URLSearchParams({ root: rootId });
    if (mode) params.set("mode", mode);
    return protectedJSON<{ items: CollabRun[]; waiting_count: number }>(
      appURL(`/api/collab/runs?${params.toString()}`),
    );
  },

  async startQuickRun(input: {
    root_id: string;
    title?: string;
    task_prompt: string;
    template_id?: string;
    template_name?: string;
    members: CollabMemberSlot[];
    skill_paths?: string[];
  }): Promise<CollabRunDetail> {
    return protectedJSON<CollabRunDetail>(appURL("/api/collab/runs"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },

  async getRunDetail(rootId: string, runId: string): Promise<CollabRunDetail> {
    return protectedJSON<CollabRunDetail>(
      appURL(
        `/api/collab/runs/${encodeURIComponent(runId)}?root=${encodeURIComponent(rootId)}`,
      ),
    );
  },

  async readRunDoc(
    rootId: string,
    runId: string,
    docName: string,
  ): Promise<{ name: string; content: string }> {
    return protectedJSON<{ name: string; content: string }>(
      appURL(
        `/api/collab/runs/${encodeURIComponent(runId)}/docs/${docName.split("/").map(encodeURIComponent).join("/")}?root=${encodeURIComponent(rootId)}`,
      ),
    );
  },

  async submitDecisions(
    rootId: string,
    runId: string,
    decisions: CollabItemDecision[],
    round = 0,
  ): Promise<CollabRunDetail> {
    return protectedJSON<CollabRunDetail>(
      appURL(`/api/collab/runs/${encodeURIComponent(runId)}/decisions`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root_id: rootId, decisions, round }),
      },
    );
  },

  async pauseRun(rootId: string, runId: string): Promise<CollabRunDetail> {
    return protectedJSON<CollabRunDetail>(
      appURL(
        `/api/collab/runs/${encodeURIComponent(runId)}/pause?root=${encodeURIComponent(rootId)}`,
      ),
      { method: "POST" },
    );
  },

  async continueRun(rootId: string, runId: string): Promise<CollabRunDetail> {
    return protectedJSON<CollabRunDetail>(
      appURL(
        `/api/collab/runs/${encodeURIComponent(runId)}/continue?root=${encodeURIComponent(rootId)}`,
      ),
      { method: "POST" },
    );
  },

  changedFiles(rootId: string, runId: string) {
    return protectedJSON<{ paths: string[]; partial: boolean }>(changesURL(rootId, runId));
  },

  fileTurns(rootId: string, runId: string, path: string) {
    return protectedJSON<CollabFileTurn[]>(changesURL(rootId, runId, path));
  },

  async reviewAgain(
    rootId: string,
    runId: string,
    round: number,
    authorNote = "",
  ): Promise<CollabRunDetail> {
    const query = new URLSearchParams({ root: rootId, round: String(round) });
    return protectedJSON<CollabRunDetail>(
      appURL(`/api/collab/runs/${encodeURIComponent(runId)}/review-again?${query}`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root_id: rootId, author_note: authorNote }),
      },
    );
  },

  async cleanupDocs(
    rootId: string,
    runId: string,
    keepDocs: string[] = [],
  ): Promise<{ detail: CollabRunDetail; removed: string[] }> {
    return protectedJSON<{ detail: CollabRunDetail; removed: string[] }>(
      appURL(`/api/collab/runs/${encodeURIComponent(runId)}/cleanup-docs`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root_id: rootId, keep_docs: keepDocs }),
      },
    );
  },

  async deleteRun(rootId: string, runId: string): Promise<void> {
    const resp = await protectedFetch(
      appURL(
        `/api/collab/runs/${encodeURIComponent(runId)}?root=${encodeURIComponent(rootId)}`,
      ),
      { method: "DELETE" },
    );
    if (!resp.ok) {
      throw new Error(`删除协作记录失败 (${resp.status})`);
    }
  },
};
