import { CollabFileChanges } from "./CollabFileChanges";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionItem } from "../../app/sessionModel";
import type { AgentStatus } from "../../services/agents";
import {
  collabService,
  type CollabItemDecision,
  type CollabMemberSlot,
  type CollabReviewItem,
  type CollabRun,
  type CollabRunDetail,
  type CollabSkillSummary,
  type CollabStepCard,
  type CollabTemplateWithAvailability,
} from "../../services/collab";
import { isIdeaRuntime } from "../../services/ideaBridge";
import { isRemoteWebUi } from "../../services/remoteUi";
import { errorService } from "../../services/error";
import { isUploadAbortError, uploadFiles, type UploadProgress } from "../../services/upload";
import { sessionService } from "../../services/session";
import type { PendingAttachment } from "../actionBarTypes";
import { buildPendingAttachment } from "../actionBarUtils";
import { AgentIcon } from "../AgentIcon";
import { AgentSelector } from "../AgentSelector";
import { CompactUploadProgress } from "../CompactUploadProgress";
import { MarkdownViewer } from "../MarkdownViewer";
import { PanelToggle } from "../remoteui/RemoteTopBar";
import { formatUploadAttachmentToken } from "../sessionViewerUtils";
import { CollabSkillPicker } from "./CollabSkillPicker";
import { CollabReviewAgainForm } from "./CollabReviewAgainForm";
import { countSelectedSkills, filterVisibleSkillPaths } from "./collabSkillGrouping";
import { CollabTemplateModal } from "./CollabTemplateModal";
import {
  collabPermissionLabel,
  formatCollabMemberBadge,
  normalizeSlotAfterAgentChange,
  normalizeSlotForSubmission,
} from "./collabModelDisplay";

function showToast(message: string, severity: "info" | "error") {
  errorService.report({
    code: severity === "error" ? "view.render_failed" : "view.invalid",
    message,
    severity,
    recoverable: true,
  });
}

export interface CollabProjectOption {
  id: string;
  name: string;
  path?: string;
}

interface CollabShellProps {
  rootId: string | null;
  projectName: string;
  projects: CollabProjectOption[];
  onSelectProject?: (rootId: string) => void;
  agents: AgentStatus[];
  isMobile: boolean;
  remotePhone: boolean;
  latestRunEvent: { seq: number; rootId: string; run: CollabRun } | null;
  onWaitingCountChange: (count: number) => void;
  onBindStageSession: (session: SessionItem | null) => void;
  onExit: () => void;
  conversationView: React.ReactNode;
  composerView: React.ReactNode;
}

const SB_WIDTH_KEY = "mindfs.collab.sidebarWidth";
const CARDS_PCT_KEY = "mindfs.collab.cardsPercent";

function readNumberStorage(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = Number(window.localStorage.getItem(key));
    if (Number.isFinite(raw) && raw >= min && raw <= max) return raw;
  } catch {
    // storage unavailable
  }
  return fallback;
}

function writeNumberStorage(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(Math.round(value)));
  } catch {
    // storage unavailable
  }
}

function checkLocalSlotAvailability(
  slot: CollabMemberSlot,
  agents: AgentStatus[],
): { available: boolean; reason?: string } {
  if (!agents.length) return { available: true };
  const st = agents.find((a) => a.name === slot.agent);
  if (!st) {
    return { available: false, reason: `未配置的 Agent：${slot.agent}` };
  }
  if (st.probe_pending) {
    return { available: true };
  }
  if (!st.installed) {
    return { available: false, reason: `Agent ${slot.agent} 未安装` };
  }
  if (!st.available) {
    return {
      available: false,
      reason: `Agent ${slot.agent} 当前不可用${st.error ? `：${st.error}` : ""}`,
    };
  }
  if (slot.model && (st.models?.length ?? 0) > 0) {
    const found = st.models!.some((m) => m.id === slot.model);
    if (!found) {
      return {
        available: false,
        reason: `模型 ${slot.model} 不在 ${slot.agent} 当前可用列表中，请手动选择替代模型`,
      };
    }
  }
  if (slot.permission_mode && st.modes?.length && !st.modes.some((item) => item.id === slot.permission_mode)) {
    return { available: false, reason: `权限档位 ${slot.permission_mode} 已不可用，请重新选择` };
  }
  return { available: true };
}

function stepStatusLabel(status: CollabStepCard["status"]): string {
  switch (status) {
    case "running":
      return "进行中";
    case "waiting_user":
      return "待处理";
    case "done":
      return "已完成";
    case "skipped":
      return "已跳过";
    case "failed":
      return "出错";
    default:
      return "等待上一步";
  }
}

function runSubLabel(run: CollabRun): string {
  if (run.status === "waiting_user") {
    return run.current_step === "decisions" ? "分歧待你拍板" : "等你继续";
  }
  if (run.status === "running") {
    const current = run.steps?.find((s) => s.key === run.current_step);
    return current ? `正在：${current.title}` : "执行中";
  }
  if (run.status === "completed") {
    if (run.test_status === "passed") return "已完成 · 测试通过";
    if (run.test_status === "failed") return "已完成 · 测试失败";
    return "已完成 · 一写一审";
  }
  if (run.status === "failed") {
    return "执行出错";
  }
  return "快速模式";
}

export function CollabShell({
  rootId,
  projectName,
  projects,
  onSelectProject,
  agents,
  isMobile,
  remotePhone,
  latestRunEvent,
  onWaitingCountChange,
  onBindStageSession,
  onExit,
  conversationView,
  composerView,
}: CollabShellProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const cardsScrollRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const currentRootIdRef = useRef<string | null>(rootId);
  currentRootIdRef.current = rootId;
  const runsRequestSeqRef = useRef(0);
  const detailRequestSeqRef = useRef(0);
  const docRequestSeqRef = useRef(0);
  const activeRunRootRef = useRef<string | null>(null);
  const boundSessionKeyRef = useRef<string>("");

  const projectNameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of projects) {
      counts.set(item.name, (counts.get(item.name) || 0) + 1);
    }
    return counts;
  }, [projects]);

  const currentProjectOption = useMemo(
    () => (rootId ? projects.find((item) => item.id === rootId) || null : null),
    [projects, rootId],
  );
  const displayProjectName = currentProjectOption?.name || projectName || "";
  const currentProjectPath = currentProjectOption?.path || "";

  const [shellWidth, setShellWidth] = useState<number>(() =>
    typeof window !== "undefined" ? window.innerWidth : 1200,
  );
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => !isIdeaRuntime && !isMobile && !remotePhone);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() =>
    readNumberStorage(SB_WIDTH_KEY, 236, 180, 360),
  );
  const [cardsPercent, setCardsPercent] = useState<number>(() =>
    readNumberStorage(CARDS_PCT_KEY, 46, 28, 72),
  );
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [stackedLevel, setStackedLevel] = useState<"cards" | "detail">("cards");
  const [filterState, setFilterState] = useState<"all" | "wait" | "running">("all");

  const [templates, setTemplates] = useState<CollabTemplateWithAvailability[]>([]);
  const [skills, setSkills] = useState<CollabSkillSummary[]>([]);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);

  const [runs, setRuns] = useState<CollabRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const activeRunIdRef = useRef<string | null>(activeRunId);
  activeRunIdRef.current = activeRunId;
  const [loadedDetail, setDetail] = useState<CollabRunDetail | null>(null);
  const [selectedStepKey, setSelectedStepKey] = useState<string>("impl");
  const [autoFollow, setAutoFollow] = useState<boolean>(true);

  // Setup composer state (when activeRunId === null)
  const [appliedTemplateId, setAppliedTemplateId] = useState<string>("");
  const [draftMembers, setDraftMembers] = useState<CollabMemberSlot[]>([]);
  const [draftSkills, setDraftSkills] = useState<string[]>([]);
  const [skillsExpanded, setSkillsExpanded] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [taskPrompt, setTaskPrompt] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [isDragOverTask, setIsDragOverTask] = useState(false);
  const [startingRun, setStartingRun] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([]);

  useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments;
  }, [pendingAttachments]);

  useEffect(() => {
    return () => {
      uploadAbortRef.current?.abort();
      pendingAttachmentsRef.current.forEach((attachment) => {
        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      });
    };
  }, []);

  const appendPendingAttachments = useCallback((files: File[]) => {
    if (files.length === 0) return;
    setPendingAttachments((prev) => [...prev, ...files.map(buildPendingAttachment)]);
  }, []);

  const removePendingAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const clearPendingAttachments = useCallback(() => {
    setPendingAttachments((prev) => {
      prev.forEach((attachment) => {
        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      });
      return [];
    });
  }, []);

  // Dispute decisions state (strictly scoped per runId so switching runs never leaks choices)
  const [decisionsDraftByRun, setDecisionsDraftByRun] = useState<
    Record<string, Record<string, { decision: "accept_review" | "keep_primary" | "custom"; note: string }>>
  >({});
  const [submittingDecisions, setSubmittingDecisions] = useState(false);

  // Doc preview & cleanup state
  const [docPreview, setDocPreview] = useState<{
    name: string;
    content: string;
    rootId: string;
    runId: string;
  } | null>(null);
  const closeDocPreview = useCallback(() => {
    docRequestSeqRef.current += 1;
    setDocPreview(null);
  }, []);
  const [keepReportOnClean, setKeepReportOnClean] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [checkingProgress, setCheckingProgress] = useState(false);
  const [reviewAgainOpenKey, setReviewAgainOpenKey] = useState<string | null>(null);
  const [reviewAgainDrafts, setReviewAgainDrafts] = useState<Record<string, { note?: string; files?: File[] }>>({});
  const [reviewUploadProgress, setReviewUploadProgress] = useState<UploadProgress | null>(null);
  const reviewUploadAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => reviewUploadAbortRef.current?.abort(), [rootId]);

  // Observe container width so IDEA narrow toolwindow & phone switch smoothly to 2-layer mode
  useEffect(() => {
    const el = shellRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setShellWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const isNarrow = isMobile || remotePhone || shellWidth < 740;
  const availableWorkspaceWidth = isNarrow
    ? shellWidth
    : shellWidth - (sidebarOpen ? sidebarWidth : 44);
  const isStacked = isMobile || remotePhone || availableWorkspaceWidth < 640;

  // Load templates + skills
  const refreshTemplates = useCallback(async () => {
    try {
      const res = await collabService.listTemplates("quick");
      setTemplates(res.items || []);
      setSkills(res.skills || []);
      return res.items || [];
    } catch {
      return [];
    }
  }, []);

  const applyTemplateToDraft = useCallback(
    (tpl: CollabTemplateWithAvailability | undefined, agentList: AgentStatus[]) => {
      if (tpl) {
        setAppliedTemplateId(tpl.id);
        setDraftMembers(tpl.members.map((m) => ({ ...m })));
        setDraftSkills([...(tpl.skill_paths || [])]);
        return;
      }
      const primaryAgent =
        agentList.find((a) => a.available)?.name || agentList[0]?.name || "codex";
      const reviewerAgent =
        agentList.find((a) => a.available && a.name !== primaryAgent)?.name || primaryAgent;
      setAppliedTemplateId("");
      setDraftMembers([
        normalizeSlotForSubmission(
          { slot_id: "primary", role: "primary", agent: primaryAgent, model: "", effort: "" },
          agentList,
        ),
        normalizeSlotForSubmission(
          { slot_id: "reviewer", role: "reviewer", agent: reviewerAgent, model: "", effort: "" },
          agentList,
        ),
      ]);
      setDraftSkills([]);
    },
    [],
  );

  useEffect(() => {
    void refreshTemplates().then((list) => {
      const def = list.find((t) => t.is_default) || list[0];
      applyTemplateToDraft(def, agents);
    });
  }, [refreshTemplates]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fill sensible initial slots once agents arrive if draftMembers is still empty
  useEffect(() => {
    if (draftMembers.length === 0 && agents.length > 0) {
      const def = templates.find((t) => t.is_default) || templates[0];
      applyTemplateToDraft(def, agents);
    }
  }, [agents, draftMembers.length, templates, applyTemplateToDraft]);

  // Load runs for current project
  const refreshRuns = useCallback(async () => {
    const targetRootId = rootId;
    if (currentRootIdRef.current !== targetRootId) return;
    const reqSeq = ++runsRequestSeqRef.current;
    if (!targetRootId) {
      setRuns([]);
      onWaitingCountChange(0);
      return;
    }
    try {
      const res = await collabService.listRuns(targetRootId);
      if (
        runsRequestSeqRef.current !== reqSeq ||
        currentRootIdRef.current !== targetRootId
      ) {
        return;
      }
      const list = res.items || [];
      setRuns(list);
      onWaitingCountChange(res.waiting_count || 0);
    } catch {
      // ignore
    }
  }, [rootId, onWaitingCountChange]);

  const prevRootIdRef = useRef<string | null>(rootId);
  useEffect(() => {
    if (prevRootIdRef.current !== rootId) {
      if (prevRootIdRef.current) {
        activeRunRootRef.current = null;
        boundSessionKeyRef.current = "";
        detailRequestSeqRef.current += 1;
        docRequestSeqRef.current += 1;
        setRuns([]);
        setActiveRunId(null);
        setDetail(null);
        setDocPreview(null);
        setStackedLevel("cards");
        setAutoFollow(true);
        setSelectedStepKey("impl");
        onWaitingCountChange(0);
        uploadAbortRef.current?.abort();
        setUploadProgress(null);
      }
      prevRootIdRef.current = rootId;
    }
    void refreshRuns();
  }, [rootId, refreshRuns, onWaitingCountChange]);

  // Load selected run detail
  const loadDetail = useCallback(
    async (runId: string) => {
      const targetRootId = rootId;
      if (!targetRootId || currentRootIdRef.current !== targetRootId) return;
      const reqSeq = ++detailRequestSeqRef.current;
      try {
        const res = await collabService.getRunDetail(targetRootId, runId);
        if (
          detailRequestSeqRef.current !== reqSeq ||
          currentRootIdRef.current !== targetRootId
        ) {
          return;
        }
        setDetail(res);
      } catch (err) {
        if (
          detailRequestSeqRef.current !== reqSeq ||
          currentRootIdRef.current !== targetRootId
        ) {
          return;
        }
        showToast(err instanceof Error ? err.message : "读取协作详情失败", "error");
      }
    },
    [rootId],
  );

  useEffect(() => {
    if (!activeRunId || activeRunRootRef.current !== rootId) {
      setDetail(null);
      onBindStageSession(null);
      return;
    }
    void loadDetail(activeRunId);
  }, [activeRunId, rootId, loadDetail, onBindStageSession]);

  useEffect(() => sessionService.subscribeEvents((event) => {
    if (event.type !== "ws.reconnected" || currentRootIdRef.current !== rootId) return;
    void refreshRuns();
    const runId = activeRunIdRef.current;
    if (runId && activeRunRootRef.current === rootId) void loadDetail(runId);
  }), [rootId, loadDetail, refreshRuns]);

  // React to live WebSocket collab.run.updated events
  useEffect(() => {
    if (!latestRunEvent || latestRunEvent.rootId !== rootId) return;
    const incoming = latestRunEvent.run;
    if (incoming.status === "deleted") {
      setRuns((prev) => prev.filter((r) => r.id !== incoming.id));
      if (activeRunId === incoming.id) {
        activeRunRootRef.current = null;
        setActiveRunId(null);
      }
      return;
    }
    setRuns((prev) => {
      const idx = prev.findIndex((r) => r.id === incoming.id);
      if (idx === -1) return [incoming, ...prev];
      const next = [...prev];
      next[idx] = incoming;
      return next;
    });
    if (activeRunId === incoming.id) {
      void loadDetail(incoming.id);
    }
  }, [latestRunEvent, rootId, activeRunId, loadDetail]);

  const currentRun = useMemo(() => {
    if (!activeRunId || !rootId) return null;
    const eventRun = latestRunEvent?.rootId === rootId ? latestRunEvent.run : undefined;
    let latest: CollabRun | null = null;
    // Timestamps are UTC RFC3339Nano, with variable fractional precision.
    // Drop the trailing Z so a longer fractional prefix sorts after a shorter one.
    for (const run of [runs.find((item) => item.id === activeRunId), loadedDetail?.run, eventRun]) {
      if (run?.id !== activeRunId || (run.root_id && run.root_id !== rootId) || run.status === "deleted") continue;
      if (!latest || run.updated_at.replace(/Z$/, "") >= latest.updated_at.replace(/Z$/, "")) latest = run;
    }
    return latest;
  }, [activeRunId, loadedDetail, latestRunEvent, runs, rootId]);
  const detail = loadedDetail?.run.id === currentRun?.id &&
    loadedDetail?.run.root_id === currentRun?.root_id &&
    loadedDetail?.run.round === currentRun?.round ? loadedDetail : null;
  const activeStepKey = useMemo(() => {
    if (!currentRun) return "impl";
    if (currentRun.current_step === "done") return "fix_test";
    return currentRun.current_step || "impl";
  }, [currentRun]);

  // Resolve which step's session_key should drive the right-hand SessionViewer & ActionBar
  const resolveSessionStepForCard = useCallback(
    (run: CollabRun | null, stepKey: string): CollabStepCard | null => {
      if (!run?.steps?.length) return null;
      const target = run.steps.find((s) => s.key === stepKey);
      if (target?.session_key) return target;
      // When paused on Card 4 (Author Dispute Decisions), show Step 3 (Primary Response) or Step 2 (Review) conversation!
      if (stepKey === "decisions") {
        return (
          run.steps.find((s) => s.key === "response" && s.session_key) ||
          run.steps.find((s) => s.key === "review" && s.session_key) ||
          null
        );
      }
      for (let i = run.steps.length - 1; i >= 0; i--) {
        if (run.steps[i].session_key) return run.steps[i];
      }
      return null;
    },
    [],
  );

  // Auto-follow active step & bind right-hand conversation
  useEffect(() => {
    if (
      !currentRun ||
      !rootId ||
      activeRunRootRef.current !== rootId ||
      (currentRun.root_id && currentRun.root_id !== rootId)
    ) {
      return;
    }
    const targetStep = autoFollow ? activeStepKey : selectedStepKey;
    if (autoFollow && selectedStepKey !== activeStepKey) {
      setSelectedStepKey(activeStepKey);
    }
    if (autoFollow) {
      const el = cardRefs.current[activeStepKey];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
    const sessionStep = resolveSessionStepForCard(currentRun, targetStep);
    if (sessionStep?.session_key && rootId) {
      const nextKey = `${rootId}::${sessionStep.session_key}`;
      if (boundSessionKeyRef.current !== nextKey) {
        boundSessionKeyRef.current = nextKey;
        onBindStageSession({
          key: sessionStep.session_key,
          session_key: sessionStep.session_key,
          root_id: rootId,
          type: "chat",
          name: `${sessionStep.title} · ${currentRun.title}`,
          agent: sessionStep.agent || "",
          model: sessionStep.model || "",
          effort: sessionStep.effort || "",
          source: sessionStep.read_only ? "collab_review" : "collab_stage",
        });
      }
    }
  }, [
    currentRun,
    activeStepKey,
    selectedStepKey,
    autoFollow,
    rootId,
    resolveSessionStepForCard,
    onBindStageSession,
  ]);

  // Check if draft slots/skills differ from the applied template
  const appliedTemplate = useMemo(
    () => templates.find((t) => t.id === appliedTemplateId),
    [templates, appliedTemplateId],
  );
  const isTemplateModified = useMemo(() => {
    if (!appliedTemplate) return false;
    const normalizeSkills = (paths: string[]) =>
      (skills.length > 0 ? filterVisibleSkillPaths(paths, skills) : [...paths]).sort();
    const snapA = JSON.stringify({
      m: appliedTemplate.members.map((x) => ({
        role: x.role,
        agent: x.agent,
        model: x.model || "",
        effort: x.effort || "",
        permission_mode: x.permission_mode || "",
      })),
      s: normalizeSkills(appliedTemplate.skill_paths || []),
    });
    const snapB = JSON.stringify({
      m: draftMembers.map((x) => ({
        role: x.role,
        agent: x.agent,
        model: x.model || "",
        effort: x.effort || "",
        permission_mode: x.permission_mode || "",
      })),
      s: normalizeSkills(draftSkills),
    });
    return snapA !== snapB;
  }, [appliedTemplate, draftMembers, draftSkills, skills]);

  const slotChecks = useMemo(
    () => draftMembers.map((m) => ({ slot: m, ...checkLocalSlotAvailability(m, agents) })),
    [draftMembers, agents],
  );
  const anySlotUnavailable = slotChecks.some((c) => !c.available);

  const handleUpdateDraftSlot = (role: "primary" | "reviewer", patch: Partial<CollabMemberSlot>) => {
    setDraftMembers((prev) =>
      prev.map((m) => (m.role === role ? { ...m, ...patch } : m)),
    );
  };

  const handleChangeDraftAgent = (
    role: "primary" | "reviewer",
    nextAgent: string,
    nextModel?: string,
  ) => {
    setDraftMembers((prev) =>
      prev.map((m) =>
        m.role === role
          ? normalizeSlotAfterAgentChange(m, nextAgent, nextModel, agents)
          : m,
      ),
    );
  };

  const handleSaveTemplateAction = async (overwrite: boolean) => {
    try {
      const normalizedMembers = draftMembers.map((slot) =>
        normalizeSlotForSubmission(slot, agents),
      );
      const normalizedSkillPaths =
        skills.length > 0 ? filterVisibleSkillPaths(draftSkills, skills) : draftSkills;
      if (overwrite && appliedTemplate) {
        const saved = await collabService.saveTemplate({
          id: appliedTemplate.id,
          name: appliedTemplate.name,
          mode: "quick",
          is_default: appliedTemplate.is_default,
          members: normalizedMembers,
          skill_paths: normalizedSkillPaths,
        });
        await refreshTemplates();
        applyTemplateToDraft(saved, agents);
        showToast("已覆盖更新全局模板", "info");
        return;
      }
      if (!saveAsName.trim()) {
        showToast("请输入新模板名称", "error");
        return;
      }
      const saved = await collabService.saveTemplate({
        name: saveAsName.trim(),
        mode: "quick",
        is_default: templates.length === 0,
        members: normalizedMembers,
        skill_paths: normalizedSkillPaths,
      });
      await refreshTemplates();
      applyTemplateToDraft(saved, agents);
      setSaveAsOpen(false);
      setSaveAsName("");
      showToast("已保存为新全局模板", "info");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "保存模板失败", "error");
    }
  };

  const canStartRun =
    Boolean(rootId) &&
    (Boolean(taskPrompt.trim()) || pendingAttachments.length > 0) &&
    !anySlotUnavailable &&
    !startingRun;

  const handleTaskPaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (startingRun || !rootId) return;
      const clipboardItems = Array.from(event.clipboardData?.items || []);
      const files = clipboardItems
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      const pastedFiles =
        files.length > 0 ? files : Array.from(event.clipboardData?.files || []);
      if (pastedFiles.length === 0) return;
      event.preventDefault();
      appendPendingAttachments(pastedFiles);
    },
    [appendPendingAttachments, rootId, startingRun],
  );

  const handleTaskDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (startingRun || !rootId) return;
      if (Array.from(event.dataTransfer?.types || []).includes("Files")) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        if (!isDragOverTask) setIsDragOverTask(true);
      }
    },
    [isDragOverTask, rootId, startingRun],
  );

  const handleTaskDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragOverTask(false);
    }
  }, []);

  const handleTaskDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      setIsDragOverTask(false);
      const droppedFiles = Array.from(event.dataTransfer?.files || []);
      const hasFileTransfer =
        droppedFiles.length > 0 ||
        Array.from(event.dataTransfer?.types || []).includes("Files");
      if (!hasFileTransfer) return;
      event.preventDefault();
      if (startingRun || !rootId) return;
      if (droppedFiles.length > 0) {
        appendPendingAttachments(droppedFiles);
      }
    },
    [appendPendingAttachments, rootId, startingRun],
  );

  const handleStartQuickRun = async () => {
    const targetRootId = rootId;
    if (!targetRootId) {
      showToast("请先选择项目目录", "error");
      return;
    }
    const trimmedPrompt = taskPrompt.trim();
    if ((!trimmedPrompt && pendingAttachments.length === 0) || anySlotUnavailable || startingRun) {
      return;
    }
    setStartingRun(true);
    setUploadProgress(null);
    try {
      let attachmentTokens = "";
      if (pendingAttachments.length > 0) {
        const uploadAbort = new AbortController();
        uploadAbortRef.current = uploadAbort;
        const uploaded = await uploadFiles({
          rootId: targetRootId,
          files: pendingAttachments.map((attachment) => attachment.file),
          onProgress: setUploadProgress,
          signal: uploadAbort.signal,
        });
        uploadAbortRef.current = null;
        setUploadProgress(null);
        if (currentRootIdRef.current !== targetRootId) return;
        attachmentTokens = uploaded
          .map((file) => formatUploadAttachmentToken(file.agent_path || file.path))
          .filter(Boolean)
          .join("\n");
      }
      const finalTaskPrompt = [trimmedPrompt, attachmentTokens].filter(Boolean).join("\n");
      if (!finalTaskPrompt) return;
      const resolvedMembers = draftMembers.map((slot) =>
        normalizeSlotForSubmission(slot, agents),
      );
      const created = await collabService.startQuickRun({
        root_id: targetRootId,
        task_prompt: finalTaskPrompt,
        template_id: appliedTemplate?.id || "",
        template_name: appliedTemplate?.name || "",
        members: resolvedMembers,
        skill_paths:
          skills.length > 0 ? filterVisibleSkillPaths(draftSkills, skills) : draftSkills,
      });
      setTaskPrompt("");
      clearPendingAttachments();
      if (currentRootIdRef.current !== targetRootId) return;
      docRequestSeqRef.current += 1;
      setDocPreview(null);
      setAutoFollow(true);
      setStackedLevel("cards");
      activeRunRootRef.current = targetRootId;
      setActiveRunId(created.run.id);
      setDetail(created);
      await refreshRuns();
    } catch (err) {
      if (!isUploadAbortError(err) && currentRootIdRef.current === targetRootId) {
        showToast(err instanceof Error ? err.message : "启动快速协作失败", "error");
      }
    } finally {
      uploadAbortRef.current = null;
      setUploadProgress(null);
      setStartingRun(false);
    }
  };

  const draftKey = currentRun ? `${currentRun.id}:${currentRun.round ?? 0}` : "";
  const reviewDraftKey = `${rootId}/${draftKey}`;
  const reviewDraft = reviewAgainDrafts[reviewDraftKey];
  const reviewFiles = reviewDraft?.files ?? [];
  const updateReviewDraft = (patch: { note?: string; files?: File[] }) => {
    setReviewAgainDrafts((prev) => ({ ...prev, [reviewDraftKey]: { ...prev[reviewDraftKey], ...patch } }));
  };
  const currentRunDraft = useMemo(
    () => decisionsDraftByRun[draftKey] || {},
    [draftKey, decisionsDraftByRun],
  );

  const disputedItems = useMemo(
    () =>
      detail?.run?.id === currentRun?.id
        ? (detail?.review_items || []).filter((it) => it.primary_status === "disputed")
        : [],
    [detail, currentRun?.id],
  );

  const allDisputesDecided = useMemo(() => {
    if (disputedItems.length === 0) return false;
    return disputedItems.every((it) => {
      const d = currentRunDraft[it.item_id];
      if (!d) return false;
      if (d.decision === "custom" && !d.note.trim()) return false;
      return true;
    });
  }, [disputedItems, currentRunDraft]);

  const decidedCount = useMemo(
    () =>
      disputedItems.filter((it) => {
        const d = currentRunDraft[it.item_id];
        return d && (d.decision !== "custom" || d.note.trim() !== "");
      }).length,
    [disputedItems, currentRunDraft],
  );

  const handleSubmitDecisions = async () => {
    const targetRootId = rootId;
    if (!targetRootId || !currentRun || !allDisputesDecided || submittingDecisions) return;
    const targetRunId = currentRun.id;
    const runDraft = currentRunDraft;
    setSubmittingDecisions(true);
    try {
      const list: CollabItemDecision[] = disputedItems.map((it) => ({
        item_id: it.item_id,
        decision: runDraft[it.item_id].decision,
        note: runDraft[it.item_id].note,
      }));
      const updated = await collabService.submitDecisions(targetRootId, targetRunId, list, currentRun.round);
      setDecisionsDraftByRun((prev) => {
        const next = { ...prev };
        delete next[draftKey];
        return next;
      });
      if (currentRootIdRef.current !== targetRootId) return;
      if (activeRunIdRef.current === targetRunId) {
        setDetail(updated);
        setAutoFollow(true);
      }
      await refreshRuns();
      if (currentRootIdRef.current === targetRootId) {
        showToast("已提交裁决，进入最终修改与测试", "info");
      }
    } catch (err) {
      if (currentRootIdRef.current === targetRootId) {
        showToast(err instanceof Error ? err.message : "提交裁决失败", "error");
      }
    } finally {
      setSubmittingDecisions(false);
    }
  };

  const handleOpenDoc = async (e: React.MouseEvent, docRelPath?: string) => {
    e.stopPropagation();
    const targetRootId = rootId;
    if (!targetRootId || !currentRun || !docRelPath) return;
    const targetRunId = currentRun.id;
    const prefix = `.mindfs/runs/${targetRunId}/`;
    const docName = docRelPath.startsWith(prefix) ? docRelPath.slice(prefix.length) : docRelPath;
    const reqSeq = ++docRequestSeqRef.current;
    try {
      const res = await collabService.readRunDoc(targetRootId, targetRunId, docName);
      if (
        docRequestSeqRef.current !== reqSeq ||
        currentRootIdRef.current !== targetRootId ||
        activeRunIdRef.current !== targetRunId
      ) {
        return;
      }
      setDocPreview({
        ...res,
        rootId: targetRootId,
        runId: targetRunId,
      });
    } catch {
      if (
        docRequestSeqRef.current !== reqSeq ||
        currentRootIdRef.current !== targetRootId ||
        activeRunIdRef.current !== targetRunId
      ) {
        return;
      }
      showToast(`文档 ${docName} 尚未生成或已被清理`, "info");
    }
  };

  const handlePause = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const targetRootId = rootId;
    if (!targetRootId || !currentRun || actionBusy) return;
    const targetRunId = currentRun.id;
    setActionBusy(true);
    try {
      const res = await collabService.pauseRun(targetRootId, targetRunId);
      if (currentRootIdRef.current !== targetRootId) return;
      if (activeRunIdRef.current === targetRunId) {
        setDetail(res);
      }
      await refreshRuns();
    } catch (err) {
      if (currentRootIdRef.current === targetRootId) {
        showToast(err instanceof Error ? err.message : "暂停失败", "error");
      }
    } finally {
      setActionBusy(false);
    }
  };

  const handleCheckProgress = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const targetRootId = rootId;
    if (!targetRootId || !currentRun || actionBusy) return;
    const targetRunId = currentRun.id;
    setActionBusy(true);
    setCheckingProgress(true);
    try {
      const res = await collabService.continueRun(targetRootId, targetRunId);
      if (currentRootIdRef.current !== targetRootId) return;
      if (activeRunIdRef.current === targetRunId) {
        setDetail(res);
        setAutoFollow(true);
        const nextStep = res.run.steps.find((step) => step.key === res.run.current_step);
        const message = res.run.status === "completed" ? "本轮已完成"
          : res.progress_action === "waiting_for_decisions" ? "请先在当前卡片提交裁决"
          : res.progress_action === "running" ? `后台正在执行「${nextStep?.title || "当前步骤"}」`
          : res.progress_action === "resumed" ? `已继续「${nextStep?.title || "当前步骤"}」`
          : "已同步最新进度";
        showToast(message, "info");
      }
      await refreshRuns();
    } catch (err) {
      if (currentRootIdRef.current === targetRootId) {
        showToast(err instanceof Error ? err.message : "检查进度失败", "error");
      }
    } finally {
      setCheckingProgress(false);
      setActionBusy(false);
    }
  };

  const handleReviewAgain = async (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    const targetRootId = rootId;
    if (!targetRootId || !currentRun || actionBusy) return;
    const targetRunId = currentRun.id;
    const targetRound = currentRun.round || 0;
    const roundKey = reviewDraftKey;
    setActionBusy(true);
    try {
      let attachmentTokens: string[] = [];
      if (reviewFiles.length > 0) {
        const abort = new AbortController();
        reviewUploadAbortRef.current = abort;
        const uploaded = await uploadFiles({
          rootId: targetRootId,
          files: reviewFiles,
          onProgress: setReviewUploadProgress,
          signal: abort.signal,
        });
        setReviewUploadProgress(null);
        if (abort.signal.aborted || currentRootIdRef.current !== targetRootId) return;
        attachmentTokens = uploaded.map((file) => formatUploadAttachmentToken(file.agent_path || file.path));
      }
      const note = [reviewDraft?.note?.trim(), ...attachmentTokens].filter(Boolean).join("\n");
      const res = await collabService.reviewAgain(targetRootId, targetRunId, targetRound, note);
      setReviewAgainOpenKey((prev) => (prev === roundKey ? null : prev));
      setReviewAgainDrafts((prev) => {
        if (!(roundKey in prev)) return prev;
        const next = { ...prev };
        delete next[roundKey];
        return next;
      });
      if (currentRootIdRef.current !== targetRootId) return;
      if (activeRunIdRef.current === targetRunId) {
        setDetail(res);
        setAutoFollow(true);
      }
      await refreshRuns();
    } catch (err) {
      if (!isUploadAbortError(err) && currentRootIdRef.current === targetRootId) {
        showToast(err instanceof Error ? err.message : "发起再审失败", "error");
      }
    } finally {
      reviewUploadAbortRef.current = null;
      setReviewUploadProgress(null);
      setActionBusy(false);
    }
  };

  const handleCleanupDocs = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const targetRootId = rootId;
    if (!targetRootId || !currentRun || actionBusy) return;
    const targetRunId = currentRun.id;
    setActionBusy(true);
    try {
      const report = currentRun.steps.find((step) => step.key === "fix_test")?.doc_path;
      const keep = keepReportOnClean && report ? [report.slice(`.mindfs/runs/${targetRunId}/`.length)] : [];
      const res = await collabService.cleanupDocs(targetRootId, targetRunId, keep);
      if (currentRootIdRef.current !== targetRootId) return;
      if (activeRunIdRef.current === targetRunId) {
        setDetail(res.detail);
      }
      showToast(
        keepReportOnClean
          ? "已清理中间过程文档，保留最终报告"
          : "已清理本次全部过程文档",
        "info",
      );
    } catch (err) {
      if (currentRootIdRef.current === targetRootId) {
        showToast(err instanceof Error ? err.message : "清理文档失败", "error");
      }
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteRun = async (e: React.MouseEvent, runId: string) => {
    e.stopPropagation();
    const targetRootId = rootId;
    if (!targetRootId) return;
    try {
      await collabService.deleteRun(targetRootId, runId);
      setDecisionsDraftByRun((prev) => {
        if (!prev[runId]) return prev;
        const next = { ...prev };
        delete next[runId];
        return next;
      });
      setReviewAgainDrafts((prev) => {
        const prefix = `${targetRootId}/${runId}:`;
        if (!Object.keys(prev).some((k) => k.startsWith(prefix))) return prev;
        const next = { ...prev };
        for (const k of Object.keys(next)) {
          if (k.startsWith(prefix)) delete next[k];
        }
        return next;
      });
      if (currentRootIdRef.current !== targetRootId) return;
      setRuns((prev) => prev.filter((r) => r.id !== runId));
      if (activeRunIdRef.current === runId) {
        activeRunRootRef.current = null;
        docRequestSeqRef.current += 1;
        setDocPreview(null);
        setActiveRunId(null);
      }
      await refreshRuns();
    } catch (err) {
      if (currentRootIdRef.current === targetRootId) {
        showToast(err instanceof Error ? err.message : "删除失败", "error");
      }
    }
  };

  // Drag splitters
  const startSidebarDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: PointerEvent) => {
      const next = Math.min(360, Math.max(180, startW + (ev.clientX - startX)));
      setSidebarWidth(next);
      writeNumberStorage(SB_WIDTH_KEY, next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const startCardsDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const rect = workspaceRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const onMove = (ev: PointerEvent) => {
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(72, Math.max(28, pct));
      setCardsPercent(clamped);
      writeNumberStorage(CARDS_PCT_KEY, clamped);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const filteredRuns = useMemo(() => {
    return runs.filter((r) => {
      if (filterState === "wait") return r.status === "waiting_user";
      if (filterState === "running") return r.status === "running";
      return true;
    });
  }, [runs, filterState]);

  const selectedSessionStep = resolveSessionStepForCard(currentRun, autoFollow ? activeStepKey : selectedStepKey);
  const selectedSessionMember = currentRun?.snapshot.members.find((member) => member.role === selectedSessionStep?.role);
  const selectedSessionPermission = selectedSessionStep?.read_only ? "严格只读"
    : selectedSessionMember ? collabPermissionLabel(selectedSessionMember) : "";
  const verifiedCitationsCount = (detail?.review_items || []).filter(
    (it) => it.citation_verified,
  ).length;
  const unverifiedCitationsCount =
    (detail?.review_items?.length || 0) - verifiedCitationsCount;

  return (
    <div
      ref={shellRef}
      className="collab-shell"
      data-narrow={isNarrow ? "1" : "0"}
      style={
        {
          "--cb-sb-w": `${sidebarWidth}px`,
          "--cb-cards-w": `${cardsPercent}%`,
        } as React.CSSProperties
      }
    >
      {isNarrow && sidebarOpen ? (
        <div className="collab-scrim" onClick={() => setSidebarOpen(false)} />
      ) : null}

      {/* Left Pane: Run List */}
      <aside className={`collab-sidebar ${sidebarOpen ? "" : "collapsed"}`}>
        {sidebarOpen ? (
          <>
            <div className="collab-sb-top">
              <button
                type="button"
                className={isNarrow ? "collab-mobile-back" : "collab-ghost-btn"}
                onClick={onExit}
                aria-label="返回单聊"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m13 5-7 7 7 7m-7-7h14" />
                </svg>
                <span>返回单聊</span>
              </button>
              {isNarrow ? (
                <button
                  type="button"
                  className="remote-phone-icon"
                  onClick={() => setSidebarOpen(false)}
                  aria-label="收起运行列表"
                  title="收起运行列表"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              ) : (
                <PanelToggle
                  side="left"
                  open
                  label="收起运行列表"
                  onClick={() => setSidebarOpen(false)}
                />
              )}
            </div>
            <div className="collab-sb-new">
              <button
                type="button"
                className="collab-new-btn"
                onClick={() => {
                  activeRunRootRef.current = null;
                  boundSessionKeyRef.current = "";
                  closeDocPreview();
                  setActiveRunId(null);
                  setStackedLevel("cards");
                  if (isNarrow) setSidebarOpen(false);
                }}
              >
                <span>＋ 新建快速协作</span>
              </button>
            </div>
            <div className="collab-filter-row">
              {(
                [
                  { id: "all", label: "全部" },
                  { id: "wait", label: "待处理" },
                  { id: "running", label: "进行中" },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`collab-filter-pill ${filterState === f.id ? "active" : ""}`}
                  onClick={() => setFilterState(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="collab-run-list">
              {filteredRuns.length === 0 ? (
                <div
                  style={{
                    padding: "24px 12px",
                    textAlign: "center",
                    fontSize: 12,
                    color: "var(--cb-text-ter)",
                  }}
                >
                  暂无协作记录
                </div>
              ) : (
                filteredRuns.map((r) => (
                  <div
                    key={r.id}
                    className={`collab-run-item ${activeRunId === r.id ? "active" : ""}`}
                    onClick={() => {
                      boundSessionKeyRef.current = "";
                      activeRunRootRef.current = rootId;
                      closeDocPreview();
                      setActiveRunId(r.id);
                      setAutoFollow(true);
                      setStackedLevel("cards");
                      if (isNarrow) setSidebarOpen(false);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <span className={`collab-run-dot ${r.status}`} />
                    <div className="collab-run-body">
                      <div className="collab-run-title">{r.title}</div>
                      <div className="collab-run-sub">{runSubLabel(r)}</div>
                      {(r.snapshot?.members?.length || 0) > 0 ? (
                        <div
                          className="collab-run-sub collab-mono"
                          style={{ fontSize: 10.5 }}
                          title={r.snapshot.members
                            .map((m) =>
                              formatCollabMemberBadge(m, agents, {
                                resolveDefaultFromAgent: false,
                              }),
                            )
                            .join(" → ")}
                        >
                          {r.snapshot.members
                            .map((m) =>
                              formatCollabMemberBadge(m, agents, {
                                resolveDefaultFromAgent: false,
                              }),
                            )
                            .join(" → ")}
                        </div>
                      ) : null}
                    </div>
                    {r.status !== "running" ? (
                      <button
                        type="button"
                        className="collab-icon-btn"
                        style={{ width: 22, height: 22, fontSize: 12 }}
                        title="删除记录"
                        onClick={(e) => void handleDeleteRun(e, r.id)}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                ))
              )}
            </div>
            <div className="collab-sb-foot">
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={currentProjectPath || displayProjectName || "当前项目"}
              >
                {displayProjectName || "当前项目"}
              </span>
              <button
                type="button"
                className="collab-ghost-btn"
                style={{ fontSize: 12, padding: "3px 7px" }}
                onClick={() => setTemplateModalOpen(true)}
              >
                全局模板
              </button>
            </div>
          </>
        ) : (
          <div className="collab-sb-rail">
            <button
              type="button"
              className="collab-icon-btn"
              onClick={onExit}
              aria-label="返回单聊"
              title="返回单聊"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m13 5-7 7 7 7m-7-7h14" />
              </svg>
            </button>
            <PanelToggle
              side="left"
              open={false}
              label="展开运行列表"
              onClick={() => setSidebarOpen(true)}
            />
            <button
              type="button"
              className="collab-icon-btn"
              onClick={() => {
                activeRunRootRef.current = null;
                boundSessionKeyRef.current = "";
                closeDocPreview();
                setActiveRunId(null);
              }}
              aria-label="新建快速协作"
              title="新建快速协作"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
        )}
      </aside>

      {!isNarrow && sidebarOpen ? (
        <div
          className="collab-splitter"
          role="separator"
          tabIndex={0}
          onPointerDown={startSidebarDrag}
          onDoubleClick={() => {
            setSidebarWidth(236);
            writeNumberStorage(SB_WIDTH_KEY, 236);
          }}
        />
      ) : null}

      {/* Main Workspace: [Cards Stream or Setup] | [Reused Conversation Detail] */}
      <div
        ref={workspaceRef}
        className="collab-workspace"
        data-mode={isStacked ? "stacked" : "split"}
        data-level={stackedLevel}
        data-single={activeRunId ? "0" : "1"}
        data-detail={detailCollapsed ? "collapsed" : "open"}
      >
        <section className="collab-cards-pane">
          <header className="collab-pane-head">
            <div className="collab-pane-head-left">
              {isNarrow ? (
                <>
                  <button
                    type="button"
                    className="collab-mobile-back"
                    onClick={onExit}
                    aria-label="返回单聊"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m13 5-7 7 7 7m-7-7h14" />
                    </svg>
                    <span>单聊</span>
                  </button>
                  <button
                    type="button"
                    className="remote-phone-icon"
                    onClick={() => setSidebarOpen(true)}
                    aria-label="运行列表"
                    title="运行列表"
                  >
                    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <path d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  </button>
                </>
              ) : null}
              <span className="collab-pane-title">
                {currentRun
                  ? (currentRun.round && currentRun.round > 1 ? `${currentRun.title} · 第 ${currentRun.round} 轮` : currentRun.title)
                  : isNarrow
                    ? "多Agent模式"
                    : "多Agent模式 · 新建一写一审"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {currentRun ? (
                <>
                  {currentRun.status === "running" ? (
                    <button
                      type="button"
                      className="collab-btn-secondary"
                      onClick={(e) => void handlePause(e)}
                      disabled={actionBusy}
                    >
                      {isNarrow ? "暂停" : "暂停干预"}
                    </button>
                  ) : null}
                </>
              ) : (
                <button
                  type="button"
                  className="collab-btn-secondary"
                  onClick={() => setTemplateModalOpen(true)}
                >
                  {isNarrow ? "全局模板" : "管理全局模板"}
                </button>
              )}
            </div>
          </header>

          <div className="collab-project-bar">
            <label className="collab-project-field">
              <span className="collab-project-label">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
                </svg>
                <span>当前项目</span>
              </span>
              <select
                className="collab-project-select"
                aria-label="选择项目"
                value={rootId || ""}
                disabled={startingRun || projects.length === 0}
                title={currentProjectPath || displayProjectName || "未选择项目"}
                onChange={(e) => {
                  const nextRootId = e.target.value;
                  if (nextRootId && nextRootId !== rootId) {
                    onSelectProject?.(nextRootId);
                  }
                }}
              >
                {projects.length === 0 ? (
                  <option value="">未选择项目</option>
                ) : null}
                {projects.map((project) => {
                  const optionLabel =
                    (projectNameCounts.get(project.name) || 0) > 1 && project.path
                      ? `${project.name} (${project.path})`
                      : project.name;
                  return (
                    <option key={project.id} value={project.id}>
                      {optionLabel}
                    </option>
                  );
                })}
              </select>
            </label>
            {currentProjectPath ? (
              <span
                className="collab-project-path collab-mono"
                title={currentProjectPath}
              >
                {currentProjectPath}
              </span>
            ) : null}
          </div>

          {!activeRunId ? (
            /* Clean New Quick Run View */
            <div className="collab-cards-scroll">
              <div className="collab-setup-wrap">
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12.5, color: "var(--cb-text-sec)", fontWeight: 600 }}>
                      模板
                    </span>
                    <select
                      value={appliedTemplateId}
                      onChange={(e) => {
                        const found = templates.find((t) => t.id === e.target.value);
                        applyTemplateToDraft(found, agents);
                      }}
                      style={{
                        padding: "5px 10px",
                        borderRadius: 8,
                        border: "1px solid var(--cb-card-border)",
                        background: "var(--cb-surface)",
                        color: "var(--cb-text)",
                        fontSize: 12.5,
                      }}
                    >
                      {templates.length === 0 ? (
                        <option value="">当前临时组合（未保存模板）</option>
                      ) : null}
                      {templates.map((tpl) => (
                        <option key={tpl.id} value={tpl.id}>
                          {tpl.is_default ? `[默认] ${tpl.name}` : tpl.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {skills.length > 0 ? (
                    <button
                      type="button"
                      className="collab-ghost-btn"
                      onClick={() => setSkillsExpanded((v) => !v)}
                    >
                      附加规范 Skill ({countSelectedSkills(draftSkills, skills)}) {skillsExpanded ? "▴" : "▾"}
                    </button>
                  ) : null}
                </div>

                {/* Member Slots Reusing Native AgentSelector */}
                <div className="collab-slot-row">
                  {(["primary", "reviewer"] as const).map((role) => {
                    const check = slotChecks.find((c) => c.slot.role === role);
                    const slot = check?.slot;
                    if (!slot) return null;
                    return (
                      <div
                        key={role}
                        className={`collab-slot-card ${!check.available ? "invalid" : ""}`}
                      >
                        <div className="collab-slot-heading">
                          <span>{role === "primary" ? "1. 主模型（实现与回应）" : "2. 审核模型"}</span>
                          <span className="collab-permission-tag">{collabPermissionLabel(slot)}</span>
                        </div>
                        <div className="collab-slot-selector">
                          <AgentSelector
                            agent={slot.agent}
                            model={slot.model || ""}
                            mode={slot.permission_mode || ""}
                            effort={slot.effort || ""}
                            agents={agents}
                            menuPlacement="bottom"
                            viewportMenu
                            showLabel
                            showChevron
                            defaultExpandOptions
                            allowDefaultModel
                            allowDefaultMode={role === "primary"}
                            onModeChange={role === "primary" ? (permission_mode) => handleUpdateDraftSlot(role, { permission_mode }) : undefined}
                            warnUnavailable={!check.available}
                            onAgentChange={(nextAgent, nextModel) =>
                              handleChangeDraftAgent(role, nextAgent, nextModel)
                            }
                            onEffortChange={(nextEffort) =>
                              handleUpdateDraftSlot(role, { effort: nextEffort || "" })
                            }
                          />
                        </div>
                        {!check.available && check.reason ? (
                          <div style={{ fontSize: 11.5, color: "var(--cb-red)" }}>
                            {check.reason}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {/* Optional Skill Picker */}
                {skillsExpanded && skills.length > 0 ? (
                  <div className="collab-d-item">
                    <CollabSkillPicker
                      skills={skills}
                      selectedPaths={draftSkills}
                      onChange={setDraftSkills}
                      title="附加规范 Skill（可选）"
                      description="项目 AGENTS.md 已作为统一审核规范引用；可按需勾选与本次任务相关的 Skill（仅写入路径索引，审核时按需读取）："
                      maxHeight={260}
                    />
                  </div>
                ) : null}

                {/* Dirty Template Notice / Save Controls */}
                {isTemplateModified || templates.length === 0 ? (
                  <div
                    style={{
                      padding: "8px 12px",
                      borderRadius: 10,
                      background: "var(--cb-accent-soft)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      flexWrap: "wrap",
                      fontSize: 12,
                    }}
                  >
                    <span>
                      {appliedTemplate
                        ? `已相对模板「${appliedTemplate.name}」临时修改（仅对本次生效）`
                        : "可将当前主/审模型组合保存为全局默认模板"}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {appliedTemplate ? (
                        <>
                          <button
                            type="button"
                            className="collab-btn-secondary"
                            onClick={() => void handleSaveTemplateAction(true)}
                          >
                            覆盖原模板
                          </button>
                          <button
                            type="button"
                            className="collab-ghost-btn"
                            onClick={() => applyTemplateToDraft(appliedTemplate, agents)}
                          >
                            还原
                          </button>
                        </>
                      ) : null}
                      {saveAsOpen ? (
                        <span style={{ display: "inline-flex", gap: 4 }}>
                          <input
                            type="text"
                            value={saveAsName}
                            onChange={(e) => setSaveAsName(e.target.value)}
                            placeholder="新模板名称"
                            style={{
                              padding: "4px 8px",
                              borderRadius: 7,
                              border: "1px solid var(--cb-card-border)",
                              background: "var(--cb-surface)",
                              fontSize: 12,
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void handleSaveTemplateAction(false);
                            }}
                          />
                          <button
                            type="button"
                            className="collab-btn-primary"
                            style={{ padding: "4px 10px", fontSize: 12 }}
                            onClick={() => void handleSaveTemplateAction(false)}
                          >
                            保存
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="collab-btn-secondary"
                          onClick={() => setSaveAsOpen(true)}
                        >
                          保存为新模板
                        </button>
                      )}
                    </div>
                  </div>
                ) : null}

                {/* Task Input */}
                <div
                  className={`collab-task-box ${isDragOverTask ? "drag-over" : ""}`}
                  onDragOver={handleTaskDragOver}
                  onDragLeave={handleTaskDragLeave}
                  onDrop={handleTaskDrop}
                >
                  <textarea
                    className="collab-task-textarea"
                    value={taskPrompt}
                    readOnly={startingRun}
                    aria-busy={startingRun}
                    onChange={(e) => {
                      if (!startingRun) {
                        setTaskPrompt(e.target.value);
                      }
                    }}
                    onPaste={handleTaskPaste}
                    placeholder="直接输入具体开发或重构任务，支持添加附件/图片或粘贴截图（Cmd/Ctrl + Enter 立即开始一写一审）..."
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        void handleStartQuickRun();
                      }
                    }}
                  />
                  {pendingAttachments.length > 0 || uploadProgress ? (
                    <div className="collab-attach-preview">
                      {pendingAttachments.some((attachment) => attachment.isImage && attachment.previewUrl) ? (
                        <div className="collab-attach-images">
                          {pendingAttachments
                            .filter((attachment) => attachment.isImage && attachment.previewUrl)
                            .map((attachment) => (
                              <div key={attachment.id} className="collab-attach-img-card">
                                <img
                                  src={attachment.previewUrl}
                                  alt={attachment.file.name}
                                  title={attachment.file.name}
                                />
                                <button
                                  type="button"
                                  className="collab-attach-img-remove"
                                  onClick={() => removePendingAttachment(attachment.id)}
                                  disabled={startingRun}
                                  aria-label={`移除附件 ${attachment.file.name}`}
                                  title={`移除 ${attachment.file.name}`}
                                >
                                  <span className="collab-attach-img-remove-glyph" aria-hidden="true">
                                    ×
                                  </span>
                                </button>
                              </div>
                            ))}
                        </div>
                      ) : null}
                      {pendingAttachments.some((attachment) => !attachment.isImage) || uploadProgress ? (
                        <div className="collab-attach-files">
                          {pendingAttachments
                            .filter((attachment) => !attachment.isImage)
                            .map((attachment) => (
                              <span key={attachment.id} className="collab-attach-file-chip">
                                <span className="collab-attach-file-name" title={attachment.file.name}>
                                  {attachment.file.name}
                                </span>
                                <button
                                  type="button"
                                  className="collab-attach-file-remove"
                                  onClick={() => removePendingAttachment(attachment.id)}
                                  disabled={startingRun}
                                  aria-label={`移除附件 ${attachment.file.name}`}
                                  title={`移除 ${attachment.file.name}`}
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          <CompactUploadProgress
                            progress={uploadProgress}
                            label="正在上传附件"
                            statusLabel="上传中"
                            cancelLabel="取消上传"
                            onCancel={() => uploadAbortRef.current?.abort()}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="collab-task-toolbar">
                    <div className="collab-task-toolbar-left">
                      <button
                        type="button"
                        className={`collab-attach-btn ${pendingAttachments.length > 0 ? "has-files" : ""}`}
                        onClick={() => attachmentInputRef.current?.click()}
                        disabled={!rootId || startingRun}
                        aria-label="添加附件或图片"
                        title="添加附件或图片（支持粘贴截图与拖拽）"
                      >
                        <svg
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                        </svg>
                        <span>
                          {pendingAttachments.length > 0
                            ? `附件/图片 (${pendingAttachments.length})`
                            : "附件/图片"}
                        </span>
                      </button>
                      <input
                        ref={attachmentInputRef}
                        type="file"
                        multiple
                        style={{ display: "none" }}
                        onChange={(event) => {
                          const selectedFiles = Array.from(event.target.files || []);
                          if (selectedFiles.length > 0) {
                            appendPendingAttachments(selectedFiles);
                          }
                          event.currentTarget.value = "";
                        }}
                      />
                      <span className="collab-task-hint">
                        {!rootId
                          ? "请先在上方选择项目"
                          : anySlotUnavailable
                            ? "请先为标红槽位选择当前可用的模型"
                            : "支持附件、图片与截图粘贴 · 阶段间以 .mindfs/runs/ 文档交接"}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="collab-btn-primary"
                      disabled={!canStartRun}
                      onClick={() => void handleStartQuickRun()}
                    >
                      {startingRun
                        ? uploadProgress
                          ? "正在上传附件..."
                          : "正在启动..."
                        : "开始一写一审"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Active Run Cards Stream */
            <div
              ref={cardsScrollRef}
              className="collab-cards-scroll"
              onWheel={() => {
                if (autoFollow && currentRun?.status === "running") {
                  setAutoFollow(false);
                }
              }}
              onTouchMove={() => {
                if (autoFollow && currentRun?.status === "running") {
                  setAutoFollow(false);
                }
              }}
            >
              {(currentRun?.snapshot?.members?.length || 0) > 0 ? (
                <div className="collab-run-models" aria-label="本次协作模型配置">
                  {currentRun!.snapshot.members.map((member) => {
                    const isReviewer = member.role === "reviewer";
                    const label = formatCollabMemberBadge(member, agents, { resolveDefaultFromAgent: false });
                    return (
                      <div
                        key={member.slot_id || member.role}
                        className="collab-run-model-chip"
                        title={label}
                      >
                        <AgentIcon
                          agentName={member.agent}
                          style={{ width: "14px", height: "14px", flexShrink: 0 }}
                        />
                        <span className="collab-run-model-role">
                          {isReviewer ? "审核" : "主模型"}
                        </span>
                        <span className="collab-run-model-value">{label}</span>
                        <span className="collab-permission-tag">{collabPermissionLabel(member)}</span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {(currentRun?.steps || []).map((step, idx) => {
                const isSelected = selectedStepKey === step.key;
                const isClickable = step.status !== "pending" && step.status !== "skipped";
                const useSharedGlow = isRemoteWebUi && step.status === "running";
                const canCheckProgress = step.key === currentRun?.current_step &&
                  ["running", "waiting_user", "failed"].includes(currentRun.status);
                const modelBadge = formatCollabMemberBadge(step, agents, {
                  resolveDefaultFromAgent: false,
                });

                return (
                  <div
                    key={step.key}
                    ref={(el) => {
                      cardRefs.current[step.key] = el;
                    }}
                    className={`collab-card st-${step.status} ${isSelected ? "selected" : ""}${useSharedGlow ? " remote-glow-frame" : ""}`}
                    data-glow-active={useSharedGlow ? "" : undefined}
                    onClick={() => {
                      if (!isClickable) return;
                      setSelectedStepKey(step.key);
                      if (step.key !== activeStepKey) {
                        setAutoFollow(false);
                      }
                      if (isStacked && step.key !== "decisions") {
                        setStackedLevel("detail");
                      }
                    }}
                  >
                    <div className="collab-tc-top">
                      <div className="collab-tc-head">
                        <span className={`collab-step-dot ${step.status}`}>
                          {step.status === "done" ? "✓" : idx + 1}
                        </span>
                        <span className="collab-tc-title">{step.title}</span>
                        {modelBadge ? <span className="collab-tc-model">{modelBadge}</span> : null}
                      </div>
                      <div className="collab-tc-right">
                        <span>{canCheckProgress && checkingProgress ? "检查中…" : stepStatusLabel(step.status)}</span>
                        {canCheckProgress ? (
                          <button
                            type="button"
                            className="collab-icon-btn collab-progress-check"
                            title="检查进度并继续"
                            aria-label="检查进度并继续"
                            disabled={actionBusy}
                            onClick={(event) => void handleCheckProgress(event)}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M20 7v5h-5M4 17v-5h5" />
                              <path d="M20 12a8 8 0 0 0-14-5M4 12a8 8 0 0 0 14 5" />
                            </svg>
                          </button>
                        ) : null}
                        {isClickable && step.session_key ? <span>›</span> : null}
                      </div>
                    </div>

                    {step.summary && step.status !== "pending" ? (
                      <div className="collab-tc-summary">{step.summary}</div>
                    ) : null}

                    {/* Read-only workspace check warning if modified or unobserved */}
                    {step.key === "review" &&
                    currentRun?.readonly_check_state &&
                    currentRun.readonly_check_state !== "clean" &&
                    currentRun.readonly_check_note ? (
                      <div
                        className="collab-tc-summary"
                        style={{
                          color:
                            currentRun.readonly_check_state === "modified"
                              ? "var(--cb-red)"
                              : "var(--cb-amber)",
                          fontSize: 12,
                        }}
                      >
                        {currentRun.readonly_check_note}
                      </div>
                    ) : null}

                    {/* Card 4: Minimalist Side-by-Side Author Dispute Resolution */}
                    {step.key === "decisions" &&
                    disputedItems.length > 0 &&
                    step.status !== "pending" &&
                    step.status !== "skipped" ? (
                      <div
                        className="collab-dispute-list"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {disputedItems.map((it: CollabReviewItem) => {
                          const cur = currentRunDraft[it.item_id]?.decision;
                          const saved = it.author_decision;
                          const effectiveChoice = cur || saved || "";
                          const locked = step.status === "done";
                          const runIdForDraft = draftKey;
                          return (
                            <div key={it.item_id} className="collab-d-item">
                              <div className="collab-d-head">
                                <span>
                                  {it.item_id} · {it.title}
                                </span>
                                <span className="collab-mono" style={{ color: "var(--cb-text-ter)" }}>
                                  {it.file_path ? `${it.file_path}:${it.line_start}` : ""}{" "}
                                  {it.citation_verified ? (
                                    <span style={{ color: "var(--cb-green)" }}>✓ 已核实</span>
                                  ) : (
                                    <span style={{ color: "var(--cb-amber)" }}>
                                      ⚠ {it.citation_note || "查无此处"}
                                    </span>
                                  )}
                                </span>
                              </div>
                              {it.rule_ref ? (
                                <div style={{ fontSize: 11.5, color: "var(--cb-text-ter)" }}>
                                  规范依据：{it.rule_ref}
                                </div>
                              ) : null}
                              <div className="collab-d-compare">
                                <div className="collab-d-side">
                                  <b>审核意见（{it.dimension === "standard" ? "规范" : "功能"}）</b>
                                  {it.description}
                                </div>
                                <div className="collab-d-side">
                                  <b>
                                    主模型说明
                                    {it.parse_fallback ? "（解析兜底转交作者）" : ""}
                                  </b>
                                  {it.primary_note}
                                </div>
                              </div>
                              {!locked ? (
                                <>
                                  <div className="collab-seg-group">
                                    {(
                                      [
                                        { id: "accept_review", label: "按审核改" },
                                        { id: "keep_primary", label: "保留现状" },
                                        { id: "custom", label: "其他指示" },
                                      ] as const
                                    ).map((opt) => (
                                      <button
                                        key={opt.id}
                                        type="button"
                                        className={`collab-seg-btn ${cur === opt.id ? "active" : ""}`}
                                        onClick={() => {
                                          if (!runIdForDraft) return;
                                          setDecisionsDraftByRun((prev) => {
                                            const prevRun = prev[runIdForDraft] || {};
                                            return {
                                              ...prev,
                                              [runIdForDraft]: {
                                                ...prevRun,
                                                [it.item_id]: {
                                                  decision: opt.id,
                                                  note: prevRun[it.item_id]?.note || "",
                                                },
                                              },
                                            };
                                          });
                                        }}
                                      >
                                        {opt.label}
                                      </button>
                                    ))}
                                  </div>
                                  {cur === "custom" ? (
                                    <input
                                      type="text"
                                      value={currentRunDraft[it.item_id]?.note || ""}
                                      onChange={(e) => {
                                        if (!runIdForDraft) return;
                                        const val = e.target.value;
                                        setDecisionsDraftByRun((prev) => {
                                          const prevRun = prev[runIdForDraft] || {};
                                          return {
                                            ...prev,
                                            [runIdForDraft]: {
                                              ...prevRun,
                                              [it.item_id]: {
                                                decision: "custom",
                                                note: val,
                                              },
                                            },
                                          };
                                        });
                                      }}
                                      placeholder="输入对该条的具体处理指示..."
                                      style={{
                                        padding: "6px 10px",
                                        borderRadius: 8,
                                        border: "1px solid var(--cb-card-border)",
                                        background: "var(--cb-surface)",
                                        color: "var(--cb-text)",
                                        fontSize: 12.5,
                                      }}
                                    />
                                  ) : null}
                                </>
                              ) : (
                                <div style={{ fontSize: 12, color: "var(--cb-text-sec)" }}>
                                  已裁决：
                                  {effectiveChoice === "accept_review"
                                    ? "按审核改"
                                    : effectiveChoice === "keep_primary"
                                      ? "保留现状"
                                      : `自定义（${it.author_note || ""}）`}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {step.status === "waiting_user" ? (
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              paddingTop: 4,
                            }}
                          >
                            <span style={{ fontSize: 12, color: "var(--cb-text-sec)" }}>
                              已选 {decidedCount} / {disputedItems.length} 条
                            </span>
                            <button
                              type="button"
                              className="collab-btn-primary"
                              disabled={!allDisputesDecided || submittingDecisions}
                              onClick={() => void handleSubmitDecisions()}
                            >
                              {submittingDecisions ? "正在提交..." : "提交裁决并继续"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {/* Card 5: Honest Test Result & Process Doc Cleanup */}
                    {step.key === "fix_test" && currentRun?.test_status ? (
                      <div
                        style={{
                          paddingLeft: 29,
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 10,
                            fontSize: 12.5,
                          }}
                        >
                          <span className="collab-mono" style={{ color: "var(--cb-text-sec)" }}>
                            {currentRun.test_command || "项目测试/构建检查"}
                          </span>
                          <span
                            style={{
                              fontWeight: 600,
                              color:
                                currentRun.test_status === "passed"
                                  ? "var(--cb-green)"
                                  : currentRun.test_status === "failed"
                                    ? "var(--cb-red)"
                                    : "var(--cb-amber)",
                            }}
                          >
                            {currentRun.test_status === "passed"
                              ? "✓ 通过"
                              : currentRun.test_status === "failed"
                                ? "✕ 失败（不自动返工）"
                                : "— 已跳过"}
                          </span>
                        </div>

                        {currentRun.status === "completed" && rootId ? (
                          <CollabFileChanges key={`${rootId}/${currentRun.id}/${currentRun.round}`} rootId={rootId} runId={currentRun.id} />
                        ) : null}
                        {currentRun.status === "completed" && !currentRun.docs_cleaned &&
                          detail?.docs?.includes(currentRun.steps.find((s) => s.key === "review")?.doc_path?.slice(`.mindfs/runs/${currentRun.id}/`.length) || "") ? (
                          reviewAgainOpenKey === reviewDraftKey ? (
                            <CollabReviewAgainForm
                              note={reviewDraft?.note || ""}
                              files={reviewFiles}
                              busy={actionBusy}
                              progress={reviewUploadProgress}
                              onNoteChange={(note) => updateReviewDraft({ note })}
                              onFilesChange={(files) => updateReviewDraft({ files })}
                              onCancel={() => setReviewAgainOpenKey(null)}
                              onCancelUpload={() => reviewUploadAbortRef.current?.abort()}
                              onSubmit={(event) => void handleReviewAgain(event)}
                            />
                          ) : (
                            <button
                              type="button"
                              className="collab-btn-secondary"
                              disabled={actionBusy}
                              onClick={(e) => {
                                e.stopPropagation();
                                setReviewAgainOpenKey(reviewDraftKey);
                              }}
                            >
                              再审一轮
                            </button>
                          )
                        ) : null}

                        {currentRun.status === "completed" &&
                        !currentRun.docs_cleaned &&
                        (detail?.docs?.length || 0) > 0 ? (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 8,
                              flexWrap: "wrap",
                              paddingTop: 4,
                              borderTop: "1px dashed var(--cb-border)",
                            }}
                          >
                            <label
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                fontSize: 12,
                                color: "var(--cb-text-ter)",
                                cursor: "pointer",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={keepReportOnClean}
                                onChange={(e) => setKeepReportOnClean(e.target.checked)}
                              />
                              <span>保留 {step.doc_path?.split("/").pop()}</span>
                            </label>
                            <button
                              type="button"
                              className="collab-btn-secondary"
                              disabled={actionBusy}
                              onClick={(e) => void handleCleanupDocs(e)}
                            >
                              清理过程文档 ({detail?.docs?.length || 0})
                            </button>
                          </div>
                        ) : currentRun.docs_cleaned ? (
                          <div style={{ fontSize: 11.5, color: "var(--cb-text-ter)" }}>
                            已清理 .mindfs/runs/ 过程文档
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {/* Quiet Footer: Handoff Doc Chip + Citation Stats + Resume Button */}
                    {step.status !== "pending" && step.status !== "skipped" ? (
                      <div className="collab-tc-foot">
                        {step.doc_path ? (
                          <button
                            type="button"
                            className="collab-quiet-link"
                            onClick={(e) => void handleOpenDoc(e, step.doc_path)}
                          >
                            {step.doc_path.split("/").pop()}
                          </button>
                        ) : null}
                        {step.key === "review" && currentRun?.round && step.author_note ? (
                          <button
                            type="button"
                            className="collab-quiet-link"
                            onClick={(e) =>
                              void handleOpenDoc(
                                e,
                                `第${String(currentRun.round).padStart(2, "0")}轮/00-作者补充意见.md`,
                              )
                            }
                          >
                            作者补充意见
                          </button>
                        ) : null}
                        {step.key === "review" && currentRun?.round ? (
                          <button type="button" className="collab-quiet-link" onClick={(e) => void handleOpenDoc(e, `第${String(currentRun.round).padStart(2, "0")}轮/本轮改动清单.md`)}>
                            本轮改动清单
                          </button>
                        ) : null}
                        {step.key === "review" && currentRun && (currentRun.round || 0) > 1 ? (
                          <details onClick={(e) => e.stopPropagation()}>
                            <summary>查看上轮交付</summary>
                            {detail?.docs?.filter((doc) => /(?:作者补充意见|审核意见|逐条回应|作者裁决|改动结果|02-review|03-response|04-decisions|05-report)\.md$/.test(doc) &&
                              !currentRun.steps.some((s) => s.doc_path?.endsWith("/" + doc))).map((doc) => (
                              <button key={doc} type="button" className="collab-quiet-link" onClick={(e) => void handleOpenDoc(e, doc)}>{doc}</button>
                            ))}
                          </details>
                        ) : null}
                        {step.key === "review" && (detail?.review_items?.length || 0) > 0 ? (
                          <span>
                            ✓ {verifiedCitationsCount} 处已核实
                            {unverifiedCitationsCount > 0
                              ? ` · ⚠ ${unverifiedCitationsCount} 处查无此处`
                              : ""}
                          </span>
                        ) : null}
                        {isStacked && step.session_key ? (
                          <button
                            type="button"
                            className="collab-quiet-link"
                            style={{ color: "var(--cb-accent)" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedStepKey(step.key);
                              if (step.key !== activeStepKey) setAutoFollow(false);
                              setStackedLevel("detail");
                            }}
                          >
                            查看对话细节 ›
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          {/* Auto-follow recovery pill */}
          {activeRunId &&
          !autoFollow &&
          (currentRun?.status === "running" || currentRun?.status === "waiting_user") ? (
            <button
              type="button"
              className="collab-follow-chip"
              onClick={() => {
                setAutoFollow(true);
                setSelectedStepKey(activeStepKey);
              }}
            >
              <span>● 回到当前步骤 ↓</span>
            </button>
          ) : null}
        </section>

        {/* Center-Right Splitter */}
        {activeRunId && !isStacked && !detailCollapsed ? (
          <div
            className="collab-splitter"
            role="separator"
            tabIndex={0}
            onPointerDown={startCardsDrag}
            onDoubleClick={() => {
              setCardsPercent(46);
              writeNumberStorage(CARDS_PCT_KEY, 46);
            }}
          />
        ) : null}

        {/* Right Pane: 100% Reused Single-Chat Conversation & Composer */}
        {activeRunId ? (
          <section className="collab-detail-pane">
            {detailCollapsed && !isStacked ? (
              <div className="collab-detail-rail">
                <PanelToggle
                  side="right"
                  open={false}
                  label="展开对话细节"
                  onClick={() => setDetailCollapsed(false)}
                />
                <span className="collab-rail-label">对话细节</span>
              </div>
            ) : (
              <>
                <header className="collab-detail-head">
                  {isStacked ? (
                    <button
                      type="button"
                      className="collab-mobile-back"
                      onClick={() => setStackedLevel("cards")}
                      aria-label="返回阶段卡片"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="m13 5-7 7 7 7m-7-7h14" />
                      </svg>
                      <span>卡片</span>
                    </button>
                  ) : null}
                  <div className="collab-detail-title">
                    <div className="t">
                      {selectedSessionStep ? selectedSessionStep.title : "阶段对话细节"}
                    </div>
                    <div className="m">
                      {selectedSessionStep?.agent
                        ? formatCollabMemberBadge({ ...selectedSessionStep, read_only: false }, agents, {
                            resolveDefaultFromAgent: false,
                          })
                        : "点选左侧阶段卡片查看实时执行过程"}
                    </div>
                    {selectedSessionPermission ? <span className="collab-permission-tag">{selectedSessionPermission}</span> : null}
                  </div>
                  {!isStacked ? (
                    <PanelToggle
                      side="right"
                      open
                      label="收起对话细节"
                      onClick={() => setDetailCollapsed(true)}
                    />
                  ) : null}
                </header>
                <div className="collab-detail-body">
                  {selectedSessionStep?.session_key ? (
                    <>
                      <div
                        style={{
                          flex: 1,
                          minHeight: 0,
                          minWidth: 0,
                          display: "flex",
                          flexDirection: "column",
                          overflow: "hidden",
                        }}
                      >
                        {conversationView}
                      </div>
                      <div style={{ flexShrink: 0 }}>{composerView}</div>
                    </>
                  ) : (
                    <div
                      style={{
                        padding: 32,
                        textAlign: "center",
                        color: "var(--cb-text-ter)",
                        fontSize: 13,
                      }}
                    >
                      该阶段尚未创建对话，请等待执行开始或点击已完成卡片查看。
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        ) : null}
      </div>

      {/* Handoff Document Markdown Preview Modal (Reusing MarkdownViewer) */}
      {docPreview && docPreview.rootId === rootId ? (
        <div className="collab-modal-backdrop" onClick={closeDocPreview}>
          <div className="collab-modal" onClick={(e) => e.stopPropagation()}>
            <div className="collab-modal-head">
              <span className="collab-mono">{docPreview.name}</span>
              <button
                type="button"
                className="collab-icon-btn"
                onClick={closeDocPreview}
              >
                ×
              </button>
            </div>
            <div className="collab-modal-body">
              <MarkdownViewer
                content={docPreview.content}
                currentPath={`.mindfs/runs/${docPreview.runId}/${docPreview.name}`}
                root={docPreview.rootId}
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* Global Template Manager Modal */}
      <CollabTemplateModal
        open={templateModalOpen}
        templates={templates}
        skills={skills}
        agents={agents}
        onClose={() => setTemplateModalOpen(false)}
        onApply={(tpl) => applyTemplateToDraft(tpl, agents)}
        onSave={async (input) => {
          const saved = await collabService.saveTemplate({
            ...input,
            mode: "quick",
          });
          await refreshTemplates();
          if (!appliedTemplateId || appliedTemplateId === saved.id) {
            setAppliedTemplateId(saved.id);
            setDraftMembers(saved.members.map((m) => ({ ...m })));
            setDraftSkills([...(saved.skill_paths || [])]);
          }
        }}
        onDelete={async (id) => {
          await collabService.deleteTemplate(id);
          const list = await refreshTemplates();
          if (appliedTemplateId === id) {
            applyTemplateToDraft(list.find((t) => t.is_default) || list[0], agents);
          }
        }}
      />
    </div>
  );
}
