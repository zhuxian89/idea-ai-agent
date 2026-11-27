import { CollabIcon, CollabIconButton } from "./CollabIcon";
import { CollabFileChanges } from "./CollabFileChanges";
import { MeetingPane } from "./MeetingPane";
import { defaultCollabMembers, MeetingMemberSettings } from "./MeetingMemberSettings";
import type { MeetingAction, MeetingDecision } from "../../services/collabMeeting";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionItem } from "../../app/sessionModel";
import type { AgentStatus } from "../../services/agents";
import {
  collabService,
  type CollabItemDecision,
  type CollabMemberSlot,
  type CollabMode,
  type MeetingTopicMode,
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
import { FileViewer } from "../FileViewer";
import { PanelToggle } from "../remoteui/RemoteTopBar";
import { PhoneActivityHostContext } from "../remoteui/phoneSessionFacts";
import { formatUploadAttachmentToken } from "../sessionViewerUtils";
import { CollabSkillPicker } from "./CollabSkillPicker";
import { CollabReviewAgainForm } from "./CollabReviewAgainForm";
import { countSelectedSkills, filterVisibleSkillPaths } from "./collabSkillGrouping";
import { CollabTemplateModal } from "./CollabTemplateModal";
import { CollabRunModelsModal } from "./CollabRunModelsModal";
import { CollabRunModelBar } from "./CollabRunModelBar";
import { QuickDecisions, type QuickDecisionDraft } from "./QuickDecisions";
import { meetingMemberAlias, meetingTurnStatus } from "./meetingDisplay";
import {
  checkLocalSlotAvailability,
  collabPermissionLabel,
  compactCollabModelLabel,
  formatCollabMemberBadge,
  meetingTurnModel,
  normalizeSlotAfterAgentChange,
  normalizeSlotForSubmission,
  resolveCollabModelInfo,
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
  conversationSessionKey?: string;
  conversationView: React.ReactNode;
  composerView: React.ReactNode;
}

const SB_WIDTH_KEY = "mindfs.collab.sidebarWidth";
const CARDS_PCT_KEY = "mindfs.collab.cardsPercent";
const FOLLOW_SCROLL_BUFFER_PX = 48;

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

function stepStatusLabel(status: CollabStepCard["status"]): string {
  switch (status) {
    case "running":
      return "进行中";
    case "waiting_user":
      return "等待你";
    case "done":
      return "已完成";
    case "skipped":
      return "已跳过";
    case "failed":
      return "失败";
    default:
      return "待开始";
  }
}

function runSubLabel(run: CollabRun): string {
  if (run.mode === "group") {
    if (run.quick_run_id) return "大会 → 快速";
    if (run.current_step === "ready") return "正式计划待确认";
    return run.status === "running" ? `开大会 · 第 ${run.round || 1} 轮` : "开大会 · 等待作者";
  }
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
  conversationSessionKey,
  conversationView,
  composerView,
}: CollabShellProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const cardsScrollRef = useRef<HTMLDivElement>(null);
  const cardsScrollTopRef = useRef(0);
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

  const [draftMode, setDraftMode] = useState<CollabMode>("quick");
  const [readyMode, setReadyMode] = useState<CollabMode | null>(null);
  const draftModeRef = useRef(draftMode);
  draftModeRef.current = draftMode;
  const [quickTemplates, setQuickTemplates] = useState<CollabTemplateWithAvailability[]>([]);
  const [meetingAuthor, setMeetingAuthor] = useState("");
  const [meetingTopicMode, setMeetingTopicMode] = useState<MeetingTopicMode>("multi");
  const [meetingRounds, setMeetingRounds] = useState(3);
  const [meetingTurn, setMeetingTurn] = useState<{ runId: string; turnId: string } | null>(null);
  const [meetingDecisions, setMeetingDecisions] = useState<Record<string, Record<string, MeetingDecision>>>({});
  const [linkedDetail, setLinkedDetail] = useState<CollabRunDetail | null>(null);
  const linkedRunIdRef = useRef<string | undefined>(undefined);
  const [templates, setTemplates] = useState<CollabTemplateWithAvailability[]>([]);
  const [skills, setSkills] = useState<CollabSkillSummary[]>([]);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [modelsModalMode, setModelsModalMode] = useState<"quick" | "group" | null>(null);

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
    Record<string, Record<string, QuickDecisionDraft>>
  >({});
  const [quickDecisionsModal, setQuickDecisionsModal] = useState<false | "edit" | "view">(false);
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
  const [meetingActionsHost, setMeetingActionsHost] = useState<HTMLElement | null>(null);
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
  const usePhoneConversationChrome = isMobile || remotePhone;
  const [phoneActivityHost, setPhoneActivityHost] = useState<HTMLDivElement | null>(null);
  const [desktopActivityHost, setDesktopActivityHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (isNarrow) setSidebarOpen(false);
  }, [isNarrow]);

  const refreshTemplates = useCallback(async () => {
    const mode = draftMode;
    try {
      const res = await collabService.listTemplates(mode);
      const list = (res.items || []).filter((item) => item.mode === mode);
      if (draftModeRef.current !== mode) return [];
      setTemplates(list);
      if (mode === "quick") setQuickTemplates(list);
      setSkills(res.skills || []);
      return list;
    } catch {
      return [];
    }
  }, [draftMode]);

  const applyTemplateToDraft = useCallback(
    (tpl: CollabTemplateWithAvailability | undefined, agentList: AgentStatus[]) => {
      const members = tpl?.members.map((member) => ({ ...member })) || defaultCollabMembers(agentList, draftMode === "group");
      setAppliedTemplateId(tpl?.id || "");
      setDraftMembers(members);
      setDraftSkills([...(tpl?.skill_paths || [])]);
      setMeetingAuthor(tpl?.final_author_slot_id || members[0]?.slot_id || "");
      setMeetingTopicMode(tpl?.topic_mode || "multi");
      setMeetingRounds(tpl?.max_rounds || 3);
    },
    [draftMode],
  );

  useEffect(() => {
    let canceled = false;
    void refreshTemplates().then((list) => {
      if (!canceled) {
        applyTemplateToDraft(list.find((item) => item.is_default) || list[0], agents);
        setReadyMode(draftMode);
      }
    });
    return () => { canceled = true; };
  }, [refreshTemplates, applyTemplateToDraft, draftMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (draftMembers.length === 0 && agents.length > 0) {
      const def = templates.find((item) => item.is_default) || templates[0];
      applyTemplateToDraft(def, agents);
    }
  }, [agents, draftMembers.length, templates, applyTemplateToDraft]);

  const switchDraftMode = (mode: CollabMode) => {
    if (mode === draftMode) return;
    setDraftMode(mode);
    setReadyMode(null);
    setTemplates([]);
    setAppliedTemplateId("");
    setSaveAsOpen(false);
    const members = defaultCollabMembers(agents, mode === "group");
    setDraftMembers(members);
    setMeetingAuthor(members[0].slot_id);
    setMeetingTopicMode("multi");
    setMeetingRounds(3);
    setDraftSkills([]);
  };

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
        setLinkedDetail(null);
        setMeetingTurn(null);
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
    setModelsModalMode(null);
  }, [rootId, activeRunId]);

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

  // Apply list updates while keeping the linked implementation on the meeting's row.
  useEffect(() => {
    if (!latestRunEvent || latestRunEvent.rootId !== rootId) return;
    const incoming = latestRunEvent.run;
    if (incoming.meeting_run_id) {
      setRuns((previous) => previous.map((run) => run.id === incoming.meeting_run_id
        ? { ...run, quick_run_id: incoming.id, quick_run_status: incoming.status } : run));
      return;
    }
    if (incoming.status === "deleted") {
      setRuns((previous) => previous.filter((run) => run.id !== incoming.id));
      if (activeRunIdRef.current === incoming.id) {
        activeRunRootRef.current = null;
        setActiveRunId(null);
      }
      return;
    }
    setRuns((previous) => {
      const index = previous.findIndex((run) => run.id === incoming.id);
      if (index === -1) return [incoming, ...previous];
      const next = [...previous];
      next[index] = incoming;
      return next;
    });
    if (activeRunIdRef.current === incoming.id) void loadDetail(incoming.id);
  }, [latestRunEvent, rootId, loadDetail]);

  const selectedRun = useMemo(() => {
    if (!activeRunId || !rootId) return null;
    const eventRun = latestRunEvent?.rootId === rootId ? latestRunEvent.run : undefined;
    let latest: CollabRun | null = null;
    for (const run of [runs.find((item) => item.id === activeRunId), loadedDetail?.run, eventRun]) {
      if (run?.id !== activeRunId || (run.root_id && run.root_id !== rootId) || run.status === "deleted") continue;
      if (!latest || run.updated_at.replace(/Z$/, "") >= latest.updated_at.replace(/Z$/, "")) latest = run;
    }
    return latest;
  }, [activeRunId, loadedDetail, latestRunEvent, runs, rootId]);

  const selectedDetail = loadedDetail?.run.id === selectedRun?.id &&
    loadedDetail?.run.root_id === selectedRun?.root_id ? loadedDetail : null;
  const meetingDetail = selectedRun?.mode === "group" && selectedDetail?.meeting ? selectedDetail : null;
  const linkedRunId = selectedRun?.quick_run_id || meetingDetail?.meeting?.quick_run_id;
  linkedRunIdRef.current = linkedRunId;
  const selectedMode = selectedRun?.mode;
  useEffect(() => {
    if (selectedMode === "group") setDetailCollapsed(!linkedRunId);
  }, [selectedRun?.id, selectedMode, linkedRunId]);
  const loadLinkedDetail = useCallback(async () => {
    if (!rootId || !linkedRunId) return;
    try {
      const next = await collabService.getRunDetail(rootId, linkedRunId);
      if (linkedRunIdRef.current === linkedRunId && currentRootIdRef.current === rootId) {
        setLinkedDetail((previous) => previous?.run.id === next.run.id && previous.run.updated_at.replace(/Z$/, "") >
          next.run.updated_at.replace(/Z$/, "") ? previous : next);
      }
    } catch (err) {
      if (linkedRunIdRef.current === linkedRunId) showToast(err instanceof Error ? err.message : "读取实现进度失败", "error");
    }
  }, [linkedRunId, rootId]);
  useEffect(() => { void loadLinkedDetail(); }, [loadLinkedDetail]);
  useEffect(() => {
    if (linkedRunId && latestRunEvent?.rootId === rootId && latestRunEvent.run.id === linkedRunId) void loadLinkedDetail();
  }, [linkedRunId, latestRunEvent, loadLinkedDetail, rootId]);
  useEffect(() => sessionService.subscribeEvents((event) => {
    if (event.type === "ws.reconnected") void loadLinkedDetail();
  }), [loadLinkedDetail]);

  useEffect(() => {
    if (selectedRun?.mode !== "group") return;
    if (quickTemplates.length === 0 && draftMode === "group") {
      void collabService.listTemplates("quick").then(({ items }) => setQuickTemplates(items || [])).catch(() => {});
    }
  }, [selectedRun?.id, selectedRun?.mode, draftMode, quickTemplates.length]);

  const linked = linkedDetail?.run.id === linkedRunId && linkedDetail?.run.root_id === rootId ? linkedDetail : null;
  const linkedEvent = linkedRunId && latestRunEvent?.rootId === rootId && latestRunEvent.run.id === linkedRunId ? latestRunEvent.run : null;
  const currentRun = linked ? linkedEvent && linkedEvent.updated_at.replace(/Z$/, "") > linked.run.updated_at.replace(/Z$/, "")
    ? linkedEvent : linked.run : selectedRun;
  const baseDetail = linked || selectedDetail;
  const detail = baseDetail?.run.round === currentRun?.round ? baseDetail : null;
  const activeStepKey = currentRun?.current_step === "done" ? "fix_test" : currentRun?.current_step || "impl";
  const focusedMeetingTurn = meetingTurn?.runId === selectedRun?.id
    ? meetingDetail?.meeting?.rounds.flatMap((round) => round.turns).find((turn) => turn.id === meetingTurn?.turnId)
    : undefined;
  const focusedMemberIndex = selectedRun?.snapshot.members.findIndex((member) => member.slot_id === focusedMeetingTurn?.slot_id) ?? -1;
  const focusedMember = selectedRun?.snapshot.members[focusedMemberIndex];
  const meetingSessionStep = useMemo<CollabStepCard | null>(() => focusedMeetingTurn && focusedMember ? {
    key: focusedMeetingTurn.id,
    title: meetingMemberAlias(focusedMemberIndex),
    role: "member",
    ...meetingTurnModel(focusedMeetingTurn, focusedMember),
    effort: focusedMeetingTurn.status === "running" || focusedMeetingTurn.status === "delivering" ? focusedMember.effort : undefined,
    read_only: !focusedMember.permission_mode,
    session_key: focusedMeetingTurn.session_key,
    status: focusedMeetingTurn.status === "delivering" ? "running" : focusedMeetingTurn.status,
  } : null, [focusedMeetingTurn, focusedMember, focusedMemberIndex]);

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
    if (currentRun.mode === "quick" && autoFollow && selectedStepKey !== activeStepKey) {
      setSelectedStepKey(activeStepKey);
    }
    if (autoFollow) {
      const el = cardRefs.current[activeStepKey];
      if (el) {
        cardsScrollTopRef.current = cardsScrollRef.current?.scrollTop ?? 0;
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
    const sessionStep = meetingSessionStep || resolveSessionStepForCard(currentRun, targetStep);
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
    meetingSessionStep,
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
    return snapA !== snapB || (draftMode === "group" &&
      (meetingTopicMode !== (appliedTemplate.topic_mode || "multi") || meetingAuthor !== appliedTemplate.final_author_slot_id || meetingRounds !== (appliedTemplate.max_rounds || 3)));
  }, [appliedTemplate, draftMembers, draftSkills, skills, draftMode, meetingAuthor, meetingRounds, meetingTopicMode]);

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
          mode: draftMode,
          ...(draftMode === "group" ? { final_author_slot_id: meetingAuthor, max_rounds: meetingRounds, topic_mode: meetingTopicMode } : {}),
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
        mode: draftMode,
        ...(draftMode === "group" ? { final_author_slot_id: meetingAuthor, max_rounds: meetingRounds, topic_mode: meetingTopicMode } : {}),
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

  const meetingSettingsValid = draftMode !== "group" || (meetingRounds >= 1 && meetingRounds <= 5);
  const canStartRun = meetingSettingsValid &&
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

  const handleStartRun = async () => {
    const targetRootId = rootId;
    if (!targetRootId) {
      showToast("请先选择项目目录", "error");
      return;
    }
    const trimmedPrompt = taskPrompt.trim();
    if ((!trimmedPrompt && pendingAttachments.length === 0) || anySlotUnavailable || startingRun || (draftMode === "group" && (meetingRounds < 1 || meetingRounds > 5))) {
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
        ...(draftMode === "group" ? { mode: draftMode, final_author_slot_id: meetingAuthor, max_rounds: meetingRounds, topic_mode: meetingTopicMode } : {}),
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
      setMeetingTurn(null);
      setStackedLevel("cards");
      activeRunRootRef.current = targetRootId;
      setActiveRunId(created.run.id);
      setDetail(created);
      await refreshRuns();
    } catch (err) {
      if (!isUploadAbortError(err) && currentRootIdRef.current === targetRootId) {
        showToast(err instanceof Error ? err.message : "启动协作失败", "error");
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
  useEffect(() => {
    setQuickDecisionsModal(false);
  }, [draftKey]);

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

  const isViewedRun = (runId: string) => activeRunIdRef.current === runId || linkedRunIdRef.current === runId;
  const applyActionDetail = (next: CollabRunDetail) => {
    const apply = (previous: CollabRunDetail | null) => previous?.run.id === next.run.id &&
      previous.run.updated_at.replace(/Z$/, "") > next.run.updated_at.replace(/Z$/, "") ? previous : next;
    if (linkedRunIdRef.current === next.run.id) setLinkedDetail(apply);
    else if (activeRunIdRef.current === next.run.id) setDetail(apply);
  };

  const handleUpdateRunMembers = async (
    targetRun: CollabRun,
    members: CollabMemberSlot[],
    resume: boolean,
  ) => {
    const targetRootId = targetRun.root_id || rootId;
    if (!targetRootId) return;
    const updated = await collabService.updateRunMembers(
      targetRootId,
      targetRun.id,
      members,
      resume,
    );
    if (currentRootIdRef.current !== targetRootId) return;
    if (isViewedRun(targetRun.id)) {
      boundSessionKeyRef.current = "";
      applyActionDetail(updated);
    }
    await refreshRuns();
    if (currentRootIdRef.current === targetRootId) {
      showToast(resume ? "已更新模型并继续执行" : "已更新运行模型", "info");
    }
  };

  const handleMeetingAction = async (action: MeetingAction) => {
    if (!selectedRun || selectedRun.mode !== "group" || actionBusy) return;
    setActionBusy(true);
    try {
      const result = await collabService.meetingAction(selectedRun.root_id, selectedRun.id, action);
      if (currentRootIdRef.current !== selectedRun.root_id || activeRunIdRef.current !== selectedRun.id) return;
      applyActionDetail(result);
      if (action.action === "retry_turn") {
        const message = result.progress_action === "running" ? "该成员仍在执行" :
          result.progress_action === "resumed" ? "已继续该成员的发言" :
          result.progress_action === "unchanged" ? "该成员已交付" : "成员状态已更新";
        showToast(message, "info");
      }
      if (action.action === "implement") {
        setMeetingTurn(null);
        setAutoFollow(true);
        setStackedLevel("cards");
        await refreshRuns();
      }
    } finally {
      setActionBusy(false);
    }
  };

  const handleMeetingControl = async (action: "pause" | "continue") => {
    if (!selectedRun || actionBusy) return;
    setActionBusy(true);
    try {
      const method = action === "pause" ? collabService.pauseRun : collabService.continueRun;
      const next = await method(selectedRun.root_id, selectedRun.id);
      if (currentRootIdRef.current === selectedRun.root_id) applyActionDetail(next);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "更新会议进度失败", "error");
    } finally {
      setActionBusy(false);
    }
  };

  const handleMeetingCleanup = async (planDoc: string) => {
    if (!selectedRun || actionBusy) return;
    setActionBusy(true);
    try {
      const next = await collabService.cleanupDocs(selectedRun.root_id, selectedRun.id, [planDoc]);
      if (currentRootIdRef.current === selectedRun.root_id) applyActionDetail(next.detail);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "清理会议文档失败", "error");
    } finally {
      setActionBusy(false);
    }
  };

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
      setQuickDecisionsModal(false);
      if (currentRootIdRef.current !== targetRootId) return;
      if (isViewedRun(targetRunId)) {
        applyActionDetail(updated);
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

  const handleOpenDoc = async (e: React.MouseEvent | null, docRelPath?: string, runId = currentRun?.id) => {
    e?.stopPropagation();
    const targetRootId = rootId;
    if (!targetRootId || !runId || !docRelPath) return;
    const targetRunId = runId;
    const prefix = `.mindfs/runs/${targetRunId}/`;
    const docName = docRelPath.startsWith(prefix) ? docRelPath.slice(prefix.length) : docRelPath;
    const reqSeq = ++docRequestSeqRef.current;
    try {
      const res = await collabService.readRunDoc(targetRootId, targetRunId, docName);
      if (
        docRequestSeqRef.current !== reqSeq ||
        currentRootIdRef.current !== targetRootId ||
        !isViewedRun(targetRunId)
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
        !isViewedRun(targetRunId)
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
      if (isViewedRun(targetRunId)) {
        applyActionDetail(res);
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
      if (isViewedRun(targetRunId)) {
        applyActionDetail(res);
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
      if (isViewedRun(targetRunId)) {
        applyActionDetail(res);
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
      if (isViewedRun(targetRunId)) {
        applyActionDetail(res.detail);
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
      const status = r.quick_run_status || r.status;
      if (filterState === "wait") return status === "waiting_user";
      if (filterState === "running") return status === "running";
      return true;
    });
  }, [runs, filterState]);

  const viewedStepKey = autoFollow ? activeStepKey : selectedStepKey;
  const viewedQuickStep = meetingSessionStep ? undefined : currentRun?.steps.find((step) => step.key === viewedStepKey);
  const selectedSessionStep = meetingSessionStep || resolveSessionStepForCard(currentRun, viewedStepKey);
  const hasBoundConversation = !!selectedSessionStep?.session_key && conversationSessionKey === selectedSessionStep.session_key;
  const selectedSessionMember = meetingSessionStep ? focusedMember : currentRun?.snapshot.members.find((member) => member.role === selectedSessionStep?.role);
  const selectedSessionPermission = selectedSessionStep?.read_only ? "严格只读"
    : selectedSessionMember ? collabPermissionLabel(selectedSessionMember, !!meetingSessionStep, agents) : "";
  const selectedSessionModel = selectedSessionStep?.agent
    ? resolveCollabModelInfo(selectedSessionStep.agent, selectedSessionStep.model, agents, undefined, { resolveDefaultFromAgent: false })
    : null;
  const selectedSessionStatus = meetingSessionStep && focusedMeetingTurn ? meetingTurnStatus[focusedMeetingTurn.status]
    : selectedSessionStep ? stepStatusLabel(selectedSessionStep.status) : "";
  const verifiedCitationsCount = (detail?.review_items || []).filter(
    (it) => it.citation_verified,
  ).length;
  const unverifiedCitationsCount =
    (detail?.review_items?.length || 0) - verifiedCitationsCount;

  const meetingDraftKey = meetingDetail ? JSON.stringify([meetingDetail.run.root_id, meetingDetail.run.id, meetingDetail.run.round]) : "";
  const groupView = meetingDetail?.meeting && selectedRun && (
    <MeetingPane
      key={selectedRun.id} run={meetingDetail.run} meeting={meetingDetail.meeting} docs={meetingDetail.docs || []}
      agents={agents} quickTemplates={quickTemplates} busy={actionBusy} compact={!!linkedRunId}
      selectedTurnId={focusedMeetingTurn?.id} actionsHost={meetingActionsHost}
      choices={meetingDecisions[meetingDraftKey] || {}}
      onChoice={(choice) => setMeetingDecisions((old) => ({
        ...old, [meetingDraftKey]: { ...old[meetingDraftKey], [choice.item_id]: choice },
      }))}
      onAction={handleMeetingAction} onPause={() => handleMeetingControl("pause")} onContinue={() => handleMeetingControl("continue")}
      onEditModels={() => setModelsModalMode("group")}
      onDoc={(doc) => void handleOpenDoc(null, doc, selectedRun.id)} onCleanup={handleMeetingCleanup}
      onProcess={(turn) => {
        setMeetingTurn({ runId: selectedRun.id, turnId: turn.id });
        setDetailCollapsed(false);
        if (isStacked) setStackedLevel("detail");
      }}
    />
  );

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
                      setMeetingTurn(null);
                      setActiveRunId(r.id);
                      setAutoFollow(true);
                      setStackedLevel("cards");
                      if (isNarrow) setSidebarOpen(false);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <span className={`collab-run-dot ${r.quick_run_status || r.status}`} />
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
                {selectedRun?.mode === "group" && !linkedRunId ? selectedRun.title || "开大会" : currentRun
                  ? (currentRun.round && currentRun.round > 1 ? `${currentRun.title} · 第 ${currentRun.round} 轮` : currentRun.title)
                  : isNarrow
                    ? "多Agent模式"
                    : "多Agent模式 · 新建一写一审"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {selectedRun?.mode === "group" && !linkedRunId ? <div className="collab-head-actions" ref={setMeetingActionsHost} /> : null}
              {currentRun ? (
                <>
                  {currentRun.mode === "quick" && currentRun.status === "running" ? (
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
                <div className="meeting-mode-switch" aria-label="协作模式">
                  <button type="button" className="collab-btn-secondary" aria-pressed={draftMode === "quick"}
                    onClick={() => switchDraftMode("quick")}>快速模式</button>
                  <button type="button" className="collab-btn-secondary" aria-pressed={draftMode === "group"}
                    onClick={() => switchDraftMode("group")}>开大会</button>
                </div>
                {readyMode !== draftMode ? <div role="status" className="meeting-muted">正在读取全局模板…</div> : <>
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
                      <option value="">当前临时组合（未保存模板）</option>
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
                {draftMode === "group" ? (
                  <MeetingMemberSettings
                    agents={agents} members={draftMembers} author={meetingAuthor} rounds={meetingRounds}
                    topicMode={meetingTopicMode} onTopicMode={setMeetingTopicMode}
                    onMembers={setDraftMembers} onAuthor={setMeetingAuthor} onRounds={setMeetingRounds}
                    unavailable={Object.fromEntries(slotChecks.map(({ slot, reason }) => [slot.slot_id, reason]))}
                  />
                ) : <div className="collab-slot-row">
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
                </div>}

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
                {isTemplateModified || !appliedTemplate ? (
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
                        : "可将当前成员配置保存为全局模板"}
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
                    placeholder={draftMode === "group" ? "输入会议议题，可附加文件或图片" :
                      "直接输入具体开发或重构任务，支持添加附件/图片或粘贴截图（Cmd/Ctrl + Enter 立即开始一写一审）..."}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        void handleStartRun();
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
                      onClick={() => void handleStartRun()}
                    >
                      {startingRun
                        ? uploadProgress
                          ? "正在上传附件..."
                          : "正在启动..."
                        : draftMode === "group" ? "开始会议" : "开始一写一审"}
                    </button>
                  </div>
                </div>
                </>}
              </div>
            </div>
          ) : selectedRun?.mode === "group" && !linked ? groupView : (
            /* Active Run Cards Stream */
            <div
              ref={cardsScrollRef}
              className="collab-cards-scroll"
              onScroll={(event) => {
                const scroll = event.currentTarget;
                const previousTop = cardsScrollTopRef.current;
                const top = scroll.scrollTop;
                cardsScrollTopRef.current = top;
                if (!autoFollow || currentRun?.status !== "running" || top === previousTop) return;

                const activeCard = cardRefs.current[activeStepKey];
                if (!activeCard) return;
                const viewport = scroll.getBoundingClientRect();
                const card = activeCard.getBoundingClientRect();
                if (
                  (top > previousTop && card.bottom < viewport.top - FOLLOW_SCROLL_BUFFER_PX) ||
                  (top < previousTop && card.top > viewport.bottom + FOLLOW_SCROLL_BUFFER_PX)
                ) {
                  setAutoFollow(false);
                }
              }}
            >
              {linked && groupView}
              {currentRun?.snapshot?.members?.length ? (
                <CollabRunModelBar agents={agents} busy={actionBusy}
                  items={currentRun.snapshot.members.map((member) => ({
                    member,
                    label: member.role === "reviewer" ? "审核" : "主模型",
                    badge: member.role === "reviewer" ? "审" : "主",
                  }))}
                  onEdit={currentRun.status !== "canceled" && !(currentRun.status === "completed" && currentRun.docs_cleaned)
                    ? () => setModelsModalMode("quick") : undefined} />
              ) : null}
              {currentRun?.steps.map((step, idx) => {
                const isSelected = selectedStepKey === step.key;
                const isClickable = step.status !== "pending" && step.status !== "skipped";
                const useSharedGlow = isRemoteWebUi && step.status === "running";
                const canCheckProgress = step.key === currentRun?.current_step &&
                  ["running", "waiting_user", "failed"].includes(currentRun.status);
                const StepHeader = isClickable ? "button" : "div";
                const failure = step.status === "failed"
                  ? step.summary || currentRun?.error_message
                  : step.key === "fix_test" && currentRun?.test_status === "failed"
                    ? currentRun.test_summary || step.summary || "测试失败"
                    : undefined;

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
                      setMeetingTurn(null);
                      setSelectedStepKey(step.key);
                      if (step.key !== activeStepKey) setAutoFollow(false);
                      if (isStacked) setStackedLevel("detail");
                      else setDetailCollapsed(false);
                    }}
                  >
                    <div className="collab-tc-top">
                      <StepHeader
                        className="collab-tc-select"
                        type={isClickable ? "button" : undefined}
                      >
                        <span className={`collab-step-dot ${step.status}`} aria-hidden="true">
                          {step.status === "done" ? "✓" : idx + 1}
                        </span>
                        <span className="collab-tc-title">{step.title}</span>
                        <span className="collab-tc-status">{stepStatusLabel(step.status)}</span>
                      </StepHeader>
                      {canCheckProgress ? (
                        <CollabIconButton icon="refresh" label="检查进度并继续"
                          className="collab-icon-btn collab-progress-check"
                          title={checkingProgress ? "检查中…" : "检查进度并继续"}
                          aria-busy={checkingProgress} disabled={actionBusy}
                          onClick={(event) => void handleCheckProgress(event)} />
                      ) : null}
                    </div>

                    {failure ? <div className="collab-tc-warning">{failure}</div> : null}

                    {/* Read-only workspace check warning if modified or unobserved */}
                    {step.key === "review" &&
                    currentRun?.readonly_check_state &&
                    currentRun.readonly_check_state !== "clean" &&
                    currentRun.readonly_check_note ? (
                      <div
                        className="collab-tc-warning"
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

                    {/* Card 4: Compact summary bar; detailed resolution lives in modal */}
                    {step.key === "decisions" &&
                    disputedItems.length > 0 &&
                    step.status !== "pending" &&
                    step.status !== "skipped" ? (
                      <div
                        className="collab-dispute-bar"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="collab-dispute-bar-text">
                          {step.status === "waiting_user"
                            ? decidedCount > 0
                              ? `${disputedItems.length} 条分歧待裁决 · 已选 ${decidedCount} / ${disputedItems.length}`
                              : `${disputedItems.length} 条分歧待裁决`
                            : `已裁决 ${disputedItems.length} 条分歧`}
                        </span>
                        {step.status === "waiting_user" ? (
                          <button
                            type="button"
                            className="collab-btn-primary collab-dispute-action-btn"
                            disabled={submittingDecisions}
                            onClick={() => setQuickDecisionsModal("edit")}
                          >
                            <CollabIcon name="check" />
                            {decidedCount > 0 ? "继续裁决" : "去裁决"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="collab-btn-secondary collab-dispute-action-btn"
                            onClick={() => setQuickDecisionsModal("view")}
                          >
                            <CollabIcon name="file" />
                            查看裁决
                          </button>
                        )}
                      </div>
                    ) : null}

                    {/* Final-stage author actions */}
                    {step.key === "fix_test" && currentRun.status === "completed" && currentRun.test_status && !currentRun.docs_cleaned ? (
                      <div
                        style={{
                          paddingLeft: 29,
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {detail?.docs?.includes(currentRun.steps.find((s) => s.key === "review")?.doc_path?.slice(`.mindfs/runs/${currentRun.id}/`.length) || "") ? (
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

                        {(detail?.docs?.length || 0) > 0 ? (
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
          currentRun?.mode === "quick" &&
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
                <span className="collab-rail-label">{selectedMode === "group" && !linkedRunId ? "成员过程" : "对话细节"}</span>
              </div>
            ) : (
              <>
                <header className="collab-detail-head">
                  {isStacked ? (
                    <button
                      type="button"
                      className="collab-mobile-back"
                      onClick={() => setStackedLevel("cards")}
                      aria-label={selectedRun?.mode === "group" && !linked ? "返回群聊" : "返回阶段卡片"}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="m13 5-7 7 7 7m-7-7h14" />
                      </svg>
                      <span>{selectedRun?.mode === "group" && !linked ? "群聊" : "卡片"}</span>
                    </button>
                  ) : null}
                  <div className="collab-detail-title">
                    {selectedSessionStep?.agent && selectedSessionModel && <span className="collab-detail-agent"
                      role="img" aria-label={selectedSessionModel.agentLabel} title={selectedSessionModel.agentLabel}>
                      <AgentIcon key={selectedSessionStep.agent} agentName={selectedSessionStep.agent} aria-hidden="true" />
                    </span>}
                    <span className="t" title={selectedSessionStep?.title}>{selectedSessionStep?.title || "阶段对话细节"}</span>
                    {selectedSessionModel && <span className="m" title={selectedSessionModel.modelLabel}>
                      <span aria-hidden="true">· </span>{compactCollabModelLabel(selectedSessionModel)}
                      {selectedSessionStep?.effort && ` · ${selectedSessionStep.effort}`}
                    </span>}
                  </div>
                  {selectedSessionPermission && <span className="collab-detail-permission" role="img"
                    aria-label={meetingSessionStep ? `当前权限 ${selectedSessionPermission}` : selectedSessionPermission}
                    title={meetingSessionStep ? `当前权限 ${selectedSessionPermission}` : selectedSessionPermission}>
                    <CollabIcon name={selectedSessionPermission.endsWith("只读") ? "lock" : "shield"} />
                  </span>}
                  {selectedSessionStatus && <span className="collab-model-dot" role="img"
                    aria-label={selectedSessionStatus} title={selectedSessionStatus}
                    data-state={selectedSessionStep?.status} />}
                  {!isStacked ? (
                    <PanelToggle
                      side="right"
                      open
                      label="收起对话细节"
                      onClick={() => setDetailCollapsed(true)}
                    />
                  ) : null}
                </header>
                {currentRun && viewedQuickStep && viewedQuickStep.status !== "pending" && viewedQuickStep.status !== "skipped" ? (
                  <details className="collab-step-details" key={`${currentRun.id}/${currentRun.round}/${viewedQuickStep.key}`}>
                    <summary className="collab-step-details-summary">
                      <span className="collab-step-details-label">阶段详情</span>
                      <span className="collab-step-details-chevron" aria-hidden="true">
                        <CollabIcon name="chevron" />
                      </span>
                    </summary>
                    <div className="collab-step-details-body">
                    {viewedQuickStep.summary ? <p>{viewedQuickStep.summary}</p> : null}
                    {viewedQuickStep.key === "fix_test" && currentRun.docs_cleaned ? (
                      <p>已清理 .mindfs/runs/ 过程文档</p>
                    ) : null}
                    {viewedQuickStep.key === "fix_test" && currentRun.test_status ? (
                      <p className="collab-step-test-row">
                        <span className="collab-mono">{currentRun.test_command || "项目测试/构建检查"}</span>
                        <span className="collab-step-test-badge" data-status={currentRun.test_status}>
                          {currentRun.test_status === "passed"
                            ? "✓ 通过"
                            : currentRun.test_status === "failed"
                              ? "✕ 失败（不自动返工）"
                              : "— 已跳过"}
                        </span>
                      </p>
                    ) : null}
                    <div className="collab-step-details-links">
                      {viewedQuickStep.doc_path ? (
                        <button type="button" className="collab-quiet-link collab-doc-chip" onClick={(e) => void handleOpenDoc(e, viewedQuickStep.doc_path)}>
                          <CollabIcon name="file" />
                          <span>{viewedQuickStep.doc_path.split("/").pop()}</span>
                        </button>
                      ) : null}
                      {viewedQuickStep.key === "review" && currentRun.round ? (
                        <>
                          {viewedQuickStep.author_note ? (
                            <button type="button" className="collab-quiet-link collab-doc-chip" onClick={(e) => void handleOpenDoc(e, `第${String(currentRun.round).padStart(2, "0")}轮/00-作者补充意见.md`)}>
                              <CollabIcon name="file" />
                              <span>作者补充意见</span>
                            </button>
                          ) : null}
                          <button type="button" className="collab-quiet-link collab-doc-chip" onClick={(e) => void handleOpenDoc(e, `第${String(currentRun.round).padStart(2, "0")}轮/本轮改动清单.md`)}>
                            <CollabIcon name="file" />
                            <span>本轮改动清单</span>
                          </button>
                          {currentRun.round > 1 ? (
                            <details className="collab-prev-docs">
                              <summary>查看上轮交付</summary>
                              <div className="collab-prev-docs-list">
                                {detail?.docs?.filter((doc) => /(?:作者补充意见|审核意见|逐条回应|作者裁决|改动结果|02-review|03-response|04-decisions|05-report)\.md$/.test(doc) &&
                                  !currentRun.steps.some((step) => step.doc_path?.endsWith("/" + doc))).map((doc) => (
                                  <button key={doc} type="button" className="collab-quiet-link collab-doc-chip" onClick={(e) => void handleOpenDoc(e, doc)}>
                                    <CollabIcon name="file" />
                                    <span>{doc}</span>
                                  </button>
                                ))}
                              </div>
                            </details>
                          ) : null}
                        </>
                      ) : null}
                      {viewedQuickStep.key === "review" && (verifiedCitationsCount + unverifiedCitationsCount > 0) ? (
                        <span className="collab-step-cite-summary" data-warn={unverifiedCitationsCount > 0}>
                          ✓ {verifiedCitationsCount} 处已核实
                          {unverifiedCitationsCount > 0 ? ` · ⚠ ${unverifiedCitationsCount} 处查无此处` : ""}
                        </span>
                      ) : null}
                    </div>
                    {viewedQuickStep.key === "fix_test" && currentRun.status === "completed" && rootId ? (
                      <CollabFileChanges key={`${rootId}/${currentRun.id}/${currentRun.round}`} rootId={rootId} runId={currentRun.id} />
                    ) : null}
                    </div>
                  </details>
                ) : null}
                <div
                  className="collab-detail-body"
                  data-phone-chrome={usePhoneConversationChrome ? "1" : "0"}
                >
                  {selectedSessionStep?.session_key ? (
                    usePhoneConversationChrome ? (
                      <>
                        <div className="remote-phone-thread">
                          <PhoneActivityHostContext.Provider value={phoneActivityHost}>
                            {hasBoundConversation ? conversationView : null}
                          </PhoneActivityHostContext.Provider>
                        </div>
                        {hasBoundConversation ? (
                          <footer className="remote-phone-composer">
                            <div
                              className={`remote-phone-activity${isRemoteWebUi ? " remote-glow-frame" : ""}`}
                              ref={setPhoneActivityHost}
                            />
                            {composerView}
                          </footer>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <div className="collab-detail-thread">
                          {isRemoteWebUi ? (
                            <PhoneActivityHostContext.Provider value={desktopActivityHost}>
                              {hasBoundConversation ? conversationView : null}
                            </PhoneActivityHostContext.Provider>
                          ) : (hasBoundConversation ? conversationView : null)}
                        </div>
                        {hasBoundConversation ? (
                          <div className="collab-detail-footer" data-has-status={isRemoteWebUi ? "1" : undefined}>
                            {isRemoteWebUi ? <div className="remote-status-activity remote-glow-frame" ref={setDesktopActivityHost} /> : null}
                            {composerView}
                          </div>
                        ) : null}
                      </>
                    )
                  ) : (
                    <div
                      style={{
                        padding: 32,
                        textAlign: "center",
                        color: "var(--cb-text-ter)",
                        fontSize: 13,
                      }}
                    >
                      {selectedMode === "group" && !linkedRunId
                        ? "点击成员头像或消息脚注中的「查看过程」。"
                        : "该阶段尚未创建对话，请等待执行开始或点击已完成卡片查看。"}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        ) : null}
      </div>

      {/* Handoff Document Markdown Preview Modal (Reusing FileViewer + MarkdownViewer) */}
      {docPreview && docPreview.rootId === rootId ? (
        <div className="collab-modal-backdrop" onClick={closeDocPreview}>
          <div className="collab-modal collab-modal--doc" onClick={(e) => e.stopPropagation()}>
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
            <div className="collab-modal-body collab-modal-body--file">
              <FileViewer file={{
                name: docPreview.name.split("/").at(-1) || docPreview.name,
                path: `.mindfs/runs/${docPreview.runId}/${docPreview.name}`,
                content: docPreview.content, encoding: "utf-8", size: new Blob([docPreview.content]).size,
                truncated: false, ext: ".md", root: docPreview.rootId,
              }} />
            </div>
          </div>
        </div>
      ) : null}

      {/* Runtime Model Editor Modal */}
      {modelsModalMode === "quick" && currentRun ? (
        <CollabRunModelsModal
          open
          run={currentRun}
          agents={agents}
          onClose={() => setModelsModalMode(null)}
          onSave={(members, resume) => handleUpdateRunMembers(currentRun, members, resume)}
        />
      ) : modelsModalMode === "group" && meetingDetail ? (
        <CollabRunModelsModal
          open
          run={meetingDetail.run}
          meeting={meetingDetail.meeting}
          agents={agents}
          onClose={() => setModelsModalMode(null)}
          onSave={(members, resume) => handleUpdateRunMembers(meetingDetail.run, members, resume)}
        />
      ) : null}

      {/* Quick-Mode Step-by-Step Dispute Decisions Modal (Interactive & Read-Only) */}
      {quickDecisionsModal && currentRun && disputedItems.length > 0 ? (
        <QuickDecisions
          key={`${draftKey}-${quickDecisionsModal}`}
          items={disputedItems}
          choices={currentRunDraft}
          readOnly={
            quickDecisionsModal === "view" ||
            currentRun.steps.find((step) => step.key === "decisions")?.status === "done"
          }
          busy={submittingDecisions}
          onChoice={(itemId, choice) => {
            if (!draftKey) return;
            setDecisionsDraftByRun((prev) => ({
              ...prev,
              [draftKey]: {
                ...(prev[draftKey] || {}),
                [itemId]: choice,
              },
            }));
          }}
          onBatchChoice={(decision) => {
            if (!draftKey) return;
            setDecisionsDraftByRun((prev) => {
              const prevRun = prev[draftKey] || {};
              const nextRun: Record<string, QuickDecisionDraft> = { ...prevRun };
              for (const item of disputedItems) {
                nextRun[item.item_id] = {
                  decision,
                  note: prevRun[item.item_id]?.note || "",
                };
              }
              return { ...prev, [draftKey]: nextRun };
            });
          }}
          onClose={() => setQuickDecisionsModal(false)}
          onSubmit={() => void handleSubmitDecisions()}
        />
      ) : null}

      {/* Global Template Manager Modal */}
      <CollabTemplateModal
        key={draftMode}
        open={templateModalOpen}
        mode={draftMode}
        templates={templates}
        skills={skills}
        agents={agents}
        onClose={() => setTemplateModalOpen(false)}
        onApply={(tpl) => applyTemplateToDraft(tpl, agents)}
        onSave={async (input) => {
          const saved = await collabService.saveTemplate({
            ...input,
            mode: draftMode,
          });
          await refreshTemplates();
          if (!appliedTemplateId || appliedTemplateId === saved.id) {
            applyTemplateToDraft(saved, agents);
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
