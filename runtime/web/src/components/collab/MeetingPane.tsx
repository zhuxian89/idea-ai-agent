import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AgentStatus } from "../../services/agents";
import type { CollabRun, CollabTemplateWithAvailability } from "../../services/collab";
import type { MeetingAction, MeetingDecision, MeetingDetail, MeetingItem, MeetingRound, MeetingTurn } from "../../services/collabMeeting";
import { CollabIcon, CollabIconButton } from "./CollabIcon";
import { MeetingTurnCard } from "./MeetingTurnCard";
import { MeetingModels } from "./MeetingModels";
import { MeetingComposer } from "./MeetingComposer";
import { MeetingDecisions } from "./MeetingDecisions";
import { MeetingPositionDetails } from "./MeetingPositionDetails";
import { collabPermissionLabel } from "./collabModelDisplay";
import { describeMeetingMember, meetingCandidateLabel, meetingItemState, meetingItemStateLabels } from "./meetingDisplay";
import "./MeetingPane.css";

const topicDoc = "00-会议议题.md";
const firstPlanDoc = "05-正式计划.md";
const phases = ["提案", "互评", "对齐", "计划", "实现"];

interface Props {
  run: CollabRun;
  meeting: MeetingDetail;
  docs: string[];
  agents: AgentStatus[];
  quickTemplates: CollabTemplateWithAvailability[];
  busy: boolean;
  compact?: boolean;
  selectedTurnId?: string;
  actionsHost?: HTMLElement | null;
  onAction: (action: MeetingAction) => Promise<void>;
  onPause: () => Promise<void>;
  onContinue: () => Promise<void>;
  onEditModels?: () => void;
  onDoc: (doc: string) => void;
  onProcess: (turn: MeetingTurn) => void;
  onCleanup?: (planDoc: string) => Promise<void>;
  choices: Record<string, MeetingDecision>;
  onChoice: (choice: MeetingDecision) => void;
}

function stepIndex(run: CollabRun, compact: boolean) {
  if (compact) return 4;
  if (run.current_step === "proposal") return 0;
  if (run.current_step === "review") return 1;
  if (run.current_step === "alignment") return 2;
  return 3;
}

export function MeetingPane({
  run, meeting, docs, agents, quickTemplates, busy, compact = false, selectedTurnId, actionsHost, onAction,
  onPause, onContinue, onEditModels, onDoc, onProcess, choices, onChoice,
}: Props) {
  const [expandedMeeting, setExpandedMeeting] = useState(false);
  const [openRounds, setOpenRounds] = useState<Record<number, boolean>>({});
  const [openSummaries, setOpenSummaries] = useState<Record<number, boolean>>({});
  const [deciding, setDeciding] = useState<false | "decisions" | "override">(false);
  const [selectedQuickTemplate, setSelectedQuickTemplate] = useState<string>();
  const [error, setError] = useState("");
  const [reasonDraft, setReasonDraft] = useState({ planId: "", text: "" });
  const [pendingJump, setPendingJump] = useState("");
  const timeline = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const current = meeting.rounds.at(-1);
  const unfixed = current?.items?.filter((item) => !item.aligned) || [];
  const unfixedPending = unfixed.filter((item) => meetingItemState(item) === "pending").length;
  // 「待确认」不是分歧：没有人反对，只是还有成员没有有效表态
  const unfixedText = [unfixed.length - unfixedPending > 0 ? `${unfixed.length - unfixedPending} 项分歧` : "",
    unfixedPending > 0 ? `${unfixedPending} 项待确认` : ""].filter(Boolean).join("、");
  const singleTopic = run.snapshot.topic_mode === "single";
  const awaiting = run.status === "waiting_user";
  const alignedPhase = run.current_step === "alignment";
  const outstandingAnswer = current?.turns.some((turn) => turn.kind === "answer" && turn.status !== "done");
  const alignmentReady = awaiting && alignedPhase && !outstandingAnswer;
  const writing = run.current_step === "plan" || run.current_step === "confirmation" || run.current_step === "ready";
  const canStartFromPartial = awaiting && !alignedPhase && !writing &&
    (run.current_step === "proposal" || run.current_step === "review" && current?.turns.some((turn) => turn.kind === "review" && turn.status === "done"));
  const plan = current?.turns.filter((turn) => turn.kind === "plan").at(-1);
  const planDoc = plan?.doc || firstPlanDoc;
  const planDisputed = current?.turns.some((turn) => turn.kind === "confirmation" && turn.status === "done" && turn.confirmed === false &&
    (turn.plan_id === plan?.id || !turn.plan_id && planDoc === firstPlanDoc));
  const planReason = reasonDraft.planId === plan?.id ? reasonDraft.text : "";
  const quickTemplateID = selectedQuickTemplate ?? quickTemplates.find((template) => template.is_default && template.all_available)?.id ?? "";
  const implementationMember = quickTemplateID
    ? quickTemplates.find((template) => template.id === quickTemplateID)?.members.find((member) => member.role === "primary")
    : run.snapshot.members.find((member) => member.slot_id === run.snapshot.final_author_slot_id) || run.snapshot.members[0];
  const maxRounds = run.snapshot.max_rounds || 3;
  const arbitration = !!current && unfixed.length > 0 && (current.number >= maxRounds || unfixed.some((item) => item.stalled));
  const getMember = (slot?: string, turn?: MeetingTurn) => {
    const index = run.snapshot.members.findIndex((member) => member.slot_id === slot);
    return index >= 0 ? describeMeetingMember(run.snapshot.members[index], index, agents, turn) : undefined;
  };
  const memberName = (slot?: string) => slot ? getMember(slot)?.label || slot : "作者";
  const positionMember = (slot: string, turnId?: string) => getMember(slot,
    turnId ? meeting.rounds.flatMap((round) => round.turns).find((turn) => turn.id === turnId) : undefined);

  useLayoutEffect(() => {
    if (pendingJump && timeline.current) {
      const target = timeline.current.querySelector<HTMLElement>(`#meeting-${pendingJump}`);
      if (target) {
        target.scrollIntoView({ block: "nearest" });
        target.focus({ preventScroll: true });
        following.current = false;
        setPendingJump("");
      }
    }
  }, [pendingJump, openRounds]);

  useLayoutEffect(() => {
    if (timeline.current && following.current && !pendingJump) {
      timeline.current.scrollTop = timeline.current.scrollHeight;
    }
  }, [meeting, pendingJump]);

  if (!current) return null;

  const act = async (action: MeetingAction) => {
    setError("");
    try {
      await onAction(action);
      setDeciding(false);
      if (action.action === "next") {
        setOpenRounds({});
        following.current = true;
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "会议操作失败");
    }
  };
  const canOpen = (doc?: string): doc is string => !!doc && docs.includes(doc);
  const jump = (roundNumber: number, turnId: string) => {
    const targetRound = meeting.rounds.find((round) => round.number === roundNumber);
    if (!targetRound?.turns.some((turn) => turn.id === turnId)) return;
    setOpenRounds((previous) => ({ ...previous, [roundNumber]: true }));
    setPendingJump(turnId);
  };

  const renderTurn = (turn: MeetingTurn, round: MeetingRound) => {
    const isCurrentRound = round.number === current.number;
    const canRetry = !compact && isCurrentRound && turn.kind !== "author" &&
      (turn.kind === run.current_step || turn.kind === "answer") &&
      ["running", "waiting_user", "failed", "delivering"].includes(turn.status);
    return <MeetingTurnCard turn={turn} round={round} run={run} agents={agents} isCurrentRound={isCurrentRound}
      selected={selectedTurnId === turn.id}
      body={turn.body || ""} memberName={memberName} busy={busy}
      onOpenDoc={turn.status === "done" && canOpen(turn.doc) ? () => onDoc(turn.doc) : undefined}
      onOpenProcess={turn.session_key ? () => onProcess(turn) : undefined}
      onRetry={canRetry ? () => void act({ action: "retry_turn", round: current.number, turn_id: turn.id, attempt: turn.at }) : undefined} />;
  };

  const renderItem = (item: MeetingItem) => {
    const positions = item.positions || [];
    const agreeCount = positions.filter((pos) => pos.stance === "agree").length;
    const disagreeCount = positions.filter((pos) => pos.stance === "disagree").length;
    const unconfirmed = positions.filter((pos) => pos.stance === "unconfirmed").length;
    const state = meetingItemState(item);
    const stateLabel = meetingItemStateLabels[state];
    const stats: { text: string; tone: "agree" | "disagree" | "muted" }[] = item.candidates
      ? [{ text: item.aligned ? meetingCandidateLabel(item.candidates, positions[0]?.version_id) : `${item.candidates.length} 个方案`, tone: item.aligned ? "agree" : "muted" }]
      : [
      { text: `${agreeCount} 同意`, tone: agreeCount > 0 ? "agree" : "muted" },
      { text: `${disagreeCount} 异议`, tone: disagreeCount > 0 ? "disagree" : "muted" },
    ];
    if (unconfirmed > 0) stats.push({ text: `${unconfirmed} 未确认`, tone: "muted" });
    return <details className="meeting-item" data-state={state} key={item.id}>
      <summary className="meeting-item-summary">
        <span className="meeting-item-main">
          <span className="meeting-item-badge" data-state={state}>{stateLabel}</span>
          <span className="meeting-item-id">{item.id}</span>
          <strong className="meeting-item-title">{item.title}</strong>
        </span>
        <span className="meeting-item-meta">
          <span className="meeting-item-stats">
            {stats.map((stat) => <span key={stat.text} className="meeting-item-stat" data-tone={stat.tone}>{stat.text}</span>)}
          </span>
          <span className="meeting-item-chevron" aria-hidden="true"><CollabIcon name="chevron" /></span>
        </span>
      </summary>
      <div className="meeting-item-body">
        <div className="meeting-position-group">
          <div className="meeting-position-list">
            {[...(item.candidates || [item.proposal]), ...positions].map((pos, i) => pos && <div className="meeting-position" data-stance={pos.stance} key={i}>
              <MeetingPositionDetails
                position={pos} candidateLabel={meetingCandidateLabel(item.candidates, pos.version_id)}
                member={positionMember(pos.slot_id, pos.turn_id)}
                rootId={run.root_id}
                actions={(pos.turn_id || canOpen(pos.doc)) ? <div className="meeting-position-actions">
                  {pos.turn_id && <CollabIconButton icon="process" label="看对话" onClick={() => {
                    const owner = meeting.rounds.find((candidate) => candidate.turns.some((turn) => turn.id === pos.turn_id));
                    if (owner) jump(owner.number, pos.turn_id!);
                  }} />}
                  {canOpen(pos.doc) && <CollabIconButton icon="file" label="看交付文件" onClick={() => onDoc(pos.doc!)} />}
                </div> : undefined}
              />
            </div>)}
          </div>
        </div>
      </div>
    </details>;
  };

  const renderRound = (round: MeetingRound) => {
    const open = openRounds[round.number] ?? (round.number === current.number);
    const turns = round.turns.filter((turn) => turn.status !== "pending" ||
      turn.kind === "proposal" && (round.number !== current.number || run.current_step !== "proposal") ||
      turn.kind === "review" && !!round.summary_doc);
    const sorted = turns.slice().sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    const proposals = turns.filter((turn) => turn.kind === "proposal" && turn.status === "done").length;
    const reviews = turns.filter((turn) => turn.kind === "review" && turn.status === "done").length;
    const hasReviews = round.number === 1 && round.turns.some((turn) => turn.kind === "review");
    const reviewMarker = sorted.find((turn) => turn.kind === "review");
    const consensus = (round.items || []).filter((item) => item.aligned).length;
    const pendingCount = (round.items || []).filter((item) => meetingItemState(item) === "pending").length;
    const disputeCount = (round.items?.length || 0) - consensus - pendingCount;
    const summaryIndex = sorted.findIndex((turn) => round.summary_at ?
      turn.at.replace(/Z$/, "") > round.summary_at.replace(/Z$/, "") : turn.kind === "plan" || turn.kind === "confirmation");
    const boundary = summaryIndex === -1 ? sorted.length : summaryIndex;
    const renderEvent = (turn: MeetingTurn) => <div key={turn.id}>
      {hasReviews && turn.id === reviewMarker?.id && <div className="meeting-divider">{proposals} 份草案已公开 · 开始互评</div>}
      {renderTurn(turn, round)}
    </div>;
    return <section key={round.number} id={`meeting-round-${round.number}`} className="meeting-round" tabIndex={-1}>
      <button type="button" className="meeting-round-toggle" aria-expanded={open}
        onClick={() => { following.current = false; setOpenRounds((old) => ({ ...old, [round.number]: !open })); }}>
        <strong>第 {round.number} 轮</strong>
        <span>{open ? round.number === 1 ? hasReviews ? "互评" : "独立提案" : "轮流讨论" :
          [proposals ? `${proposals} 份提案` : "", `${reviews} 份互评`, round.summary_doc && `${consensus} 共识 · ${disputeCount} 分歧${pendingCount > 0 ? ` · ${pendingCount} 待确认` : ""}`].filter(Boolean).join(" · ")}</span>
        <CollabIcon name="chevron" />
      </button>
      {open && <>
        {round.number > 1 && (round.inputs || []).some(canOpen) && <details className="meeting-inputs">
          <summary>交接材料 {(round.inputs || []).filter(canOpen).length}<CollabIcon name="chevron" /></summary>
          <div className="meeting-inputs-list">
            {round.inputs?.map((doc) => canOpen(doc) && <button key={doc} type="button" className="collab-quiet-link"
              title={doc} onClick={() => onDoc(doc)}><CollabIcon name="file" />{doc.split("/").pop()}</button>)}
          </div>
        </details>}
        {sorted.slice(0, boundary).map(renderEvent)}
        {hasReviews && !reviewMarker && <div className="meeting-divider">{proposals} 份草案已公开 · 开始互评</div>}
        {round.summary_doc && (() => {
          const itemCount = round.items?.length || 0;
          const summaryOpen = openSummaries[round.number] ?? (itemCount <= 3);
          return <section className="meeting-summary" data-open={summaryOpen} aria-label="共识与分歧">
            <div className="meeting-summary-head">
              <button type="button" className="meeting-summary-toggle" aria-expanded={summaryOpen}
                onClick={() => setOpenSummaries((old) => ({ ...old, [round.number]: !summaryOpen }))}>
                <span className="meeting-summary-title">
                  <strong>共识与分歧</strong>
                  {itemCount > 0 && <span className="meeting-summary-counts">
                    {consensus > 0 && <span className="meeting-summary-pill" data-state="aligned">{consensus} 共识</span>}
                    {disputeCount > 0 && <span className="meeting-summary-pill"
                      data-state={round.items!.some((item) => !item.aligned && item.stalled) ? "stalled" : "disputed"}>
                      {disputeCount} 分歧
                    </span>}
                    {pendingCount > 0 && <span className="meeting-summary-pill" data-state="pending">{pendingCount} 待确认</span>}
                  </span>}
                </span>
                <span className="meeting-summary-chevron" aria-hidden="true"><CollabIcon name="chevron" /></span>
              </button>
              <div className="meeting-summary-actions">
                {canOpen(`第${String(round.number).padStart(2, "0")}轮/作者裁决.md`) &&
                  <button type="button" className="meeting-summary-doc-btn"
                    onClick={() => onDoc(`第${String(round.number).padStart(2, "0")}轮/作者裁决.md`)}>
                    <CollabIcon name="file" /><span>作者裁决</span>
                  </button>}
                {canOpen(round.summary_doc) && <CollabIconButton icon="file" label="本轮交接文件" onClick={() => onDoc(round.summary_doc!)} />}
              </div>
            </div>
            {summaryOpen && (itemCount ? <div className="meeting-item-list">{round.items!.map(renderItem)}</div>
              : <p className="meeting-summary-empty">本轮暂未整理出共识或分歧条目。</p>)}
          </section>;
        })()}
        {sorted.slice(boundary).map(renderEvent)}
      </>}
    </section>;
  };

  const stage = stepIndex(run, compact);
  const finishedOnly = run.current_step === "ready" && (run.status === "completed" || !!run.completed_at);
  const canCompose = !compact && !run.docs_cleaned && run.status !== "canceled";
  const readyBusy = busy || run.status === "running" || !!outstandingAnswer;
  const headerActions = !compact && actionsHost ? createPortal(<>
    {canOpen(topicDoc) && <CollabIconButton icon="file" label="会议议题" onClick={() => onDoc(topicDoc)} />}
    {run.status === "running" && <CollabIconButton icon="pause" label="暂停" disabled={busy} onClick={() => void onPause()} />}
    {awaiting && !alignmentReady && (run.current_step !== "ready" || outstandingAnswer) &&
      <CollabIconButton icon="refresh" label="检查进度并继续" disabled={busy} onClick={() => void onContinue()} />}
  </>, actionsHost) : null;
  return <div className="meeting-pane" data-compact={compact}>
    {headerActions}
    {compact && <div className="meeting-compact-line">
      <button type="button" className="meeting-compact-toggle" aria-expanded={expandedMeeting}
        onClick={() => setExpandedMeeting(!expandedMeeting)}>
        <span className="collab-step-dot done" aria-hidden="true">✓</span>
        <strong className="meeting-compact-title">会议</strong>
        <span className="meeting-compact-status">{current.number} 轮 · 正式计划已确认</span>
        <CollabIcon name="chevron" />
      </button>
    </div>}
    {(!compact || expandedMeeting) && <>
      <div className="meeting-header">
        <ol className="meeting-phases" aria-label="会议流程">
          {phases.map((label, index) => <li key={label} aria-current={index === stage ? "step" : undefined}
            data-complete={index < stage}>{label}</li>)}
          {!compact && meeting.rounds.length > 0 && <li className="meeting-round-tag" aria-label="当前轮次">{singleTopic ? "单议题" : "多议题"} · 第 {current.number}/{maxRounds} 轮</li>}
        </ol>
        <MeetingModels run={run} meeting={meeting} current={current} agents={agents} busy={busy}
          onProcess={onProcess} onEdit={!compact && !meeting.quick_run_id && run.status !== "completed" &&
            run.status !== "canceled" && !run.docs_cleaned ? onEditModels : undefined} />
      </div>
      <div ref={timeline} className="meeting-timeline" onScroll={(event) => {
        const el = event.currentTarget;
        following.current = el.scrollHeight - el.clientHeight - el.scrollTop < 64;
      }}>
        {meeting.rounds.map(renderRound)}
      </div>
      {!compact && <div className="meeting-bottom">
        {run.error_message && <p className="meeting-warning" role="status">{run.error_message}</p>}
        {error && <p className="meeting-error" role="alert">{error}</p>}
        {canCompose && <MeetingComposer rootId={run.root_id} members={run.snapshot.members} agents={agents}
          disabled={busy}
          placeholder={run.current_step === "ready" ? "追问正式计划，或输入 @ 点名成员" : "补充议题，或输入 @ 点名成员"}
          onSend={async (text) => { await onAction({ action: "message", round: current.number, text }); following.current = true; }} />}
        {alignmentReady && <div className="meeting-next-actions">
          {unfixed.length === 0 ? <>
            <button type="button" className="collab-btn-primary" disabled={busy} onClick={() => void act({ action: "plan", round: current.number })}><CollabIcon name="file" />生成正式计划</button>
            <button type="button" className="collab-btn-secondary" disabled={busy} onClick={() => setDeciding("override")}>否决全部，按我方向</button>
          </> : <>
            <span className={arbitration ? "meeting-warning" : "meeting-muted"}>
              {singleTopic ? "尚未就方案达成一致" : arbitration ? `还有 ${unfixedText}未对齐，请你裁决` : `还有 ${unfixedText}`}
            </span>
            <button type="button" className="collab-btn-secondary" disabled={busy}
              onClick={() => void act({ action: "next", round: current.number })}><CollabIcon name="next" />{singleTopic ? "继续讨论方案" : "只讨论剩余分歧"}</button>
            <button type="button" className="collab-btn-secondary" disabled={busy} onClick={() => setDeciding("override")}>否决全部，按我方向</button>
            <button type="button" className="collab-btn-primary" disabled={busy} onClick={() => setDeciding("decisions")}>
              <CollabIcon name="check" />{singleTopic ? "选择方案" : arbitration ? "裁决" : "提前裁决"}</button>
          </>}
        </div>}
        {canStartFromPartial && <div className="meeting-next-actions">
          <button type="button" className="collab-btn-secondary" disabled={busy}
            onClick={() => void act({ action: "next", round: current.number })}>
            <CollabIcon name="next" />
            {run.current_step === "proposal" ? "用已交付提案开始互评" : "用已交付材料开始下一轮"}
          </button>
        </div>}
        {finishedOnly && <div className="meeting-next-actions">
          <span className="meeting-muted">会议已结束，没有进入实现。方案保存在正式计划里。</span>
          <button type="button" className="collab-btn-secondary" onClick={() => onDoc(planDoc)}><CollabIcon name="file" />查看正式计划</button>
        </div>}
        {run.current_step === "ready" && !finishedOnly && <div className="meeting-next-actions">
          <CollabIconButton icon="file" label="查看正式计划" onClick={() => onDoc(planDoc)} />
          {quickTemplates.length > 0 && <select aria-label="实现模板" value={quickTemplateID} onChange={(event) => setSelectedQuickTemplate(event.target.value)}>
            <option value="">会内主笔实现，其余成员首位审核</option>
            {quickTemplates.map((template) => <option key={template.id} value={template.id} disabled={!template.all_available}>{template.name}</option>)}
          </select>}
          {implementationMember && <span className="meeting-muted">实现权限 {collabPermissionLabel(
            { ...implementationMember, role: "primary" }, false, agents)}</span>}
          {planDisputed && plan && <>
            <label className="meeting-plan-reason">正式计划有异议，请填写处理理由
              <textarea rows={2} value={planReason} onChange={(event) => setReasonDraft({ planId: plan.id, text: event.target.value })} />
            </label>
            <button type="button" className="collab-btn-secondary" disabled={readyBusy || !planReason.trim()}
              onClick={() => void act({ action: "revise_plan", round: current.number, plan_id: plan.id, text: planReason })}><CollabIcon name="back" />退回主笔修订</button>
          </>}
          <button type="button" className="collab-btn-secondary" disabled={readyBusy}
            title="不改代码，会议到此结束，方案保留在正式计划里"
            onClick={() => void act({ action: "finish", round: current.number })}><CollabIcon name="check" />只要方案，结束会议</button>
          <button type="button" className="collab-btn-primary" disabled={readyBusy || !!planDisputed && !planReason.trim()}
            onClick={() => void act({ action: "implement", round: current.number, plan_id: plan?.id,
              text: planDisputed ? planReason : undefined, quick_template_id: quickTemplateID || undefined })}>
            <CollabIcon name="play" />
            {planDisputed ? "按当前稿开始实现" : "确认并开始实现"}
          </button>
        </div>}
      </div>}
    </>}
    {deciding && alignmentReady && <MeetingDecisions key={`${current.number}-${deciding}`} items={unfixed}
      totalItems={current.items?.length || 0} rootId={run.root_id} initialOverride={deciding === "override"}
      getMember={positionMember} choices={choices} onChoice={onChoice} busy={busy} error={error} onClose={() => setDeciding(false)}
      onSubmit={(decisions) => void act({ action: "plan", round: current.number, decisions })}
      onOverride={(text) => void act({ action: "plan", round: current.number, override_all: true, text })} />}
  </div>;
}
