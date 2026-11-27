import { useEffect, useRef, useState } from "react";
import type { MeetingDecision, MeetingItem, MeetingPosition } from "../../services/collabMeeting";
import { AgentIcon } from "../AgentIcon";
import { CollabIcon, CollabIconButton } from "./CollabIcon";
import { MeetingPositionDetails, meetingStanceLabels } from "./MeetingPositionDetails";
import { meetingCandidateLabel, type describeMeetingMember } from "./meetingDisplay";

interface Props {
  items: MeetingItem[];
  totalItems?: number;
  rootId: string;
  choices: Record<string, MeetingDecision>;
  getMember: (id: string, turnId?: string) => ReturnType<typeof describeMeetingMember> | undefined;
  busy: boolean;
  initialOverride?: boolean;
  onChoice: (choice: MeetingDecision) => void;
  onClose: () => void;
  onSubmit: (choices: MeetingDecision[]) => void;
  onOverride: (direction: string) => void;
}

function adoptValue(position: Pick<MeetingPosition, "version_id" | "turn_id" | "slot_id">) {
  return position.version_id ? `adopt:${position.version_id}:${position.turn_id}:${position.slot_id}` : `adopt:${position.slot_id}`;
}

export function MeetingDecisions({
  items, totalItems = items.length, rootId, choices, getMember, busy, initialOverride = false, onChoice, onClose, onSubmit, onOverride,
}: Props) {
  const done = (item: MeetingItem) => {
    const choice = choices[item.id];
    return !!choice && (choice.choice !== "custom" || !!choice.note?.trim());
  };
  const [overrideMode, setOverrideMode] = useState(initialOverride || items.length === 0);
  const [overrideText, setOverrideText] = useState("");
  const [index, setIndex] = useState(() => Math.max(0, items.findIndex((item) => !done(item))));
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [index, overrideMode]);

  const item = items[Math.min(index, Math.max(0, items.length - 1))];
  if (!overrideMode && !item) return null;
  const decided = items.filter(done).length;
  const complete = items.length > 0 && decided === items.length;
  const firstOpen = items.findIndex((candidate) => !done(candidate));
  const last = index >= items.length - 1;
  const choice = item ? choices[item.id] : undefined;

  const options = new Map<string, MeetingPosition>();
  const positions = item?.positions || [];
  if (item) {
    for (const position of item.candidates || [item.proposal, ...positions]) {
      if (position?.quote && !options.has(adoptValue(position))) options.set(adoptValue(position), position);
    }
  }
  const agree = positions.filter((position) => position.stance === "agree").length;
  const disagree = positions.filter((position) => position.stance === "disagree").length;
  const selectedAdopt = choice?.choice === "adopt" && choice.slot_id ? adoptValue({ ...choice, slot_id: choice.slot_id }) : "";

  const singleTopic = !!item?.candidates;
  const dialogTitle = overrideMode ? "否决全部议题" : singleTopic ? "选择方案" : "逐条裁决";
  const primary = overrideMode
    ? { label: "按我的方向生成正式计划", icon: "file" as const, run: () => onOverride(overrideText.trim()) }
    : complete || singleTopic
      ? { label: "生成正式计划", icon: "file" as const, run: () => onSubmit(items.map((candidate) => choices[candidate.id])) }
      : last
        ? { label: `去处理第 ${firstOpen + 1} 条`, icon: "next" as const, run: () => setIndex(firstOpen) }
        : { label: "下一条", icon: "next" as const, run: () => setIndex(index + 1) };
  const primaryDisabled = overrideMode
    ? busy || !overrideText.trim()
    : busy || (!complete && (singleTopic || (!last && !done(item!))));

  return <div className="collab-modal-backdrop" onClick={onClose}>
    <section className="collab-modal meeting-decision-modal" role="dialog" aria-modal="true" aria-label={dialogTitle}
      onClick={(event) => event.stopPropagation()}>
      <header className="collab-modal-head">
        <span>{dialogTitle}</span>
        <div className="decision-head-actions">
          {!overrideMode && <button type="button" className="decision-override-btn" disabled={busy}
            onClick={() => setOverrideMode(true)}>一键否决所有议题</button>}
          <CollabIconButton icon="close" label="关闭裁决" onClick={onClose} />
        </div>
      </header>
      {!overrideMode && !singleTopic && <nav className="decision-progress" aria-label="裁决进度">
        <div className="decision-progress-text">
          <strong>第 {index + 1} / {items.length} 条</strong>
          <span>已处理 {decided}</span>
        </div>
        <ol className="decision-steps">
          {items.map((candidate, position) => <li key={candidate.id}>
            <button type="button" aria-label={`第 ${position + 1} 条${done(candidate) ? "，已处理" : "，未处理"}`}
              aria-current={position === index ? "step" : undefined} data-done={done(candidate)}
              onClick={() => setIndex(position)} />
          </li>)}
        </ol>
      </nav>}
      <div className="collab-modal-body decision-body" ref={body}>
        {overrideMode ? <div className="decision-override-panel">
          <p className="decision-override-hint">
            将一键否决本轮全部{totalItems > 0 ? ` ${totalItems} 项` : ""}共识与分歧议题，由主笔直接按你给出的方向生成正式计划与修改方案。
          </p>
          <textarea
            aria-label="作者修改方向"
            className="decision-override-textarea"
            rows={6}
            value={overrideText}
            placeholder="直接写下你希望采用的方案、修改方向和关键要求…"
            onChange={(event) => setOverrideText(event.target.value)}
          />
        </div> : item && <>
        <div className="decision-item-head">
          <span className="meeting-item-id">{item.id}</span>
          <h3>{item.title}</h3>
          {!singleTopic && <p>{[agree ? `${agree} 同意` : "", disagree ? `${disagree} 异议` : "", item.stalled ? "讨论僵持" : ""].filter(Boolean).join(" · ") || "各方意见不一致"}</p>}
        </div>
        <div className="decision-options" role="radiogroup" aria-label={`${item.id} 裁决`}>
          {[...options].map(([value, position]) => {
            const member = getMember(position.slot_id, position.turn_id);
            const key = `${item.id}|${value}`;
            const open = !!expanded[key];
            const selected = selectedAdopt === value;
            return <div key={value} className="decision-option" data-selected={selected} data-stance={position.stance}>
              <button type="button" role="radio" aria-checked={selected} className="decision-option-main"
                onClick={() => onChoice({ item_id: item.id, choice: "adopt", slot_id: position.slot_id,
                  ...(position.version_id ? { version_id: position.version_id, turn_id: position.turn_id } : {}) })}>
                <span className="decision-radio" aria-hidden="true" />
                <span className="decision-option-text">
                  <span className="decision-option-who">
                    {member && <AgentIcon agentName={member.agent} aria-hidden="true" />}
                    <strong>采纳 {singleTopic ? meetingCandidateLabel(item.candidates, position.version_id) : (member?.label || position.slot_id)}</strong>
                    <span className="meeting-stance-pill" data-stance={position.stance}>{meetingStanceLabels[position.stance]}</span>
                  </span>
                  <span className="decision-option-quote" data-open={open}>{position.quote}</span>
                </span>
              </button>
              <button type="button" className="decision-more" aria-expanded={open}
                onClick={() => setExpanded((old) => ({ ...old, [key]: !open }))}>{open ? "收起" : "展开原文、理由和出处"}</button>
              {open && <div className="decision-option-detail">
                <MeetingPositionDetails position={position} member={member} rootId={rootId} />
              </div>}
            </div>;
          })}
          <div className="decision-option" data-selected={choice?.choice === "custom"}>
            <button type="button" role="radio" aria-checked={choice?.choice === "custom"} className="decision-option-main"
              onClick={() => onChoice({ item_id: item.id, choice: "custom", note: choice?.note })}>
              <span className="decision-radio" aria-hidden="true" />
              <span className="decision-option-text">
                <span className="decision-option-who"><strong>都不采纳，我来写</strong></span>
              </span>
            </button>
            {choice?.choice === "custom" && <textarea aria-label={`${item.id} 裁决说明`} value={choice.note || ""} rows={3}
              placeholder="写下你希望正式计划怎么处理这一条" onChange={(event) => onChoice({ item_id: item.id, choice: "custom", note: event.target.value })} />}
          </div>
          <div className="decision-option" data-selected={choice?.choice === "defer"}>
            <button type="button" role="radio" aria-checked={choice?.choice === "defer"} className="decision-option-main"
              onClick={() => onChoice({ item_id: item.id, choice: "defer" })}>
              <span className="decision-radio" aria-hidden="true" />
              <span className="decision-option-text">
                <span className="decision-option-who"><strong>暂不决定</strong></span>
              </span>
            </button>
          </div>
        </div>
        </>}
      </div>
      <footer className="decision-footer">
        {overrideMode
          ? (items.length > 0 && <button type="button" className="collab-btn-secondary" disabled={busy}
            onClick={() => setOverrideMode(false)}>{singleTopic ? "返回选择方案" : "返回逐条裁决"}</button>)
          : (!singleTopic && <button type="button" className="collab-btn-secondary" disabled={busy || index === 0}
            onClick={() => setIndex(index - 1)}>上一条</button>)}
        <button type="button" className="collab-btn-primary" disabled={primaryDisabled} onClick={primary.run}>
          <CollabIcon name={primary.icon} />{primary.label}
        </button>
      </footer>
    </section>
  </div>;
}
