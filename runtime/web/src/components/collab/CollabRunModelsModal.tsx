import { useEffect, useMemo, useState } from "react";
import type { AgentStatus } from "../../services/agents";
import type { CollabMemberSlot, CollabRun } from "../../services/collab";
import type { MeetingDetail } from "../../services/collabMeeting";
import { AgentSelector } from "../AgentSelector";
import { PermissionSelector } from "../PermissionSelector";
import { CollabIcon, CollabIconButton } from "./CollabIcon";
import {
  checkLocalSlotAvailability,
  collabPermissionLabel,
  normalizeSlotAfterAgentChange,
  normalizeSlotForSubmission,
} from "./collabModelDisplay";
import { meetingMemberAlias, meetingPermissionChoices, meetingTurnStatus } from "./meetingDisplay";

interface Props {
  open: boolean;
  run: CollabRun;
  meeting?: MeetingDetail | null;
  agents: AgentStatus[];
  onClose: () => void;
  onSave: (members: CollabMemberSlot[], resume: boolean) => Promise<void>;
}

function slotKey(slot: CollabMemberSlot): string {
  return slot.slot_id || slot.role;
}

function slotChanged(a: CollabMemberSlot, b: CollabMemberSlot): boolean {
  return (
    (a.agent || "").trim() !== (b.agent || "").trim() ||
    (a.model || "").trim() !== (b.model || "").trim() ||
    (a.effort || "").trim() !== (b.effort || "").trim() ||
    (a.permission_mode || "").trim() !== (b.permission_mode || "").trim()
  );
}

export function CollabRunModelsModal({
  open,
  run,
  meeting,
  agents,
  onClose,
  onSave,
}: Props) {
  const [draftMembers, setDraftMembers] = useState<CollabMemberSlot[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraftMembers((run.snapshot?.members || []).map((m) => ({ ...m })));
    setError("");
    setSaving(false);
  }, [open, run.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const originalMembers = run.snapshot?.members || [];
  const isGroup = run.mode === "group";

  const changedSlotIds = useMemo(() => {
    const changed = new Set<string>();
    for (const draft of draftMembers) {
      const orig = originalMembers.find((m) => slotKey(m) === slotKey(draft));
      if (!orig || slotChanged(orig, draft)) {
        changed.add(slotKey(draft));
      }
    }
    return changed;
  }, [draftMembers, originalMembers]);

  const slotChecks = useMemo(
    () => draftMembers.map((slot) => ({ slot, ...checkLocalSlotAvailability(slot, agents) })),
    [draftMembers, agents],
  );

  const hasChanges = changedSlotIds.size > 0;
  const anyChangedUnavailable = slotChecks.some(
    (item) => changedSlotIds.has(slotKey(item.slot)) && !item.available,
  );

  const currentRound = isGroup ? meeting?.rounds?.at(-1) : undefined;
  const activeMeetingSlots = useMemo(() => {
    const active = new Map<string, string>();
    for (const turn of currentRound?.turns || []) {
      if ((turn.status === "running" || turn.status === "delivering") && turn.slot_id) {
        active.set(turn.slot_id, meetingTurnStatus[turn.status]);
      }
    }
    return active;
  }, [currentRound]);

  const willInterruptActive = useMemo(() => {
    if (!hasChanges) return false;
    if (isGroup) {
      for (const id of changedSlotIds) {
        if (activeMeetingSlots.has(id)) return true;
      }
      return false;
    }
    if (run.status !== "running") return false;
    const activeStep = run.steps?.find((s) => s.key === run.current_step);
    if (!activeStep) return false;
    const key = activeStep.slot_id || activeStep.role;
    return changedSlotIds.has(key) || changedSlotIds.has(activeStep.role);
  }, [hasChanges, isGroup, changedSlotIds, activeMeetingSlots, run.status, run.steps, run.current_step]);

  const canResume = useMemo(() => {
    if (isGroup) {
      const hasPendingAnswer = currentRound?.turns.some(
        (t) => t.kind === "answer" && t.status !== "done",
      );
      return (
        (run.status === "waiting_user" || run.status === "failed") &&
        (run.current_step !== "alignment" || Boolean(hasPendingAnswer)) &&
        run.current_step !== "ready"
      );
    }
    return (
      (run.status === "failed" || run.status === "waiting_user") &&
      run.current_step !== "decisions" &&
      run.current_step !== "done"
    );
  }, [isGroup, currentRound, run.status, run.current_step]);

  if (!open) return null;

  const updateSlot = (id: string, next: CollabMemberSlot) => {
    setDraftMembers((prev) => prev.map((m) => (slotKey(m) === id ? next : m)));
  };

  const hintText = isGroup
    ? willInterruptActive
      ? "正在发言的已修改成员将中断并用新模型重新发言，其余成员不受影响。"
      : run.status === "running"
        ? "不会中断其余正在发言的成员，新模型将在该成员下次发言或重试时生效。"
        : "已交付发言保留原记录，未交付、重试或后续轮次发言将使用新模型。"
    : willInterruptActive
      ? "当前正在执行的阶段将中断并用新模型重新执行；已完成阶段保留原记录。"
      : run.status === "running"
        ? "不会中断当前正在执行的阶段，新模型将在后续阶段生效。"
        : run.status === "completed"
          ? "已完成记录不变，新模型将在「再审一轮」时生效。"
          : "已完成阶段保留原记录，未完成或待继续的阶段将使用新模型执行。";

  const handleSubmit = async (resume: boolean) => {
    if (!hasChanges || anyChangedUnavailable || saving) return;
    setSaving(true);
    setError("");
    try {
      const payload = draftMembers.map((slot) =>
        changedSlotIds.has(slotKey(slot))
          ? normalizeSlotForSubmission(slot, agents)
          : slot,
      );
      await onSave(payload, resume);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "修改模型失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="collab-modal-backdrop" onClick={() => !saving && onClose()}>
      <div
        className="collab-modal"
        role="dialog"
        aria-modal="true"
        aria-label="修改运行模型"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="collab-modal-head">
          <span>{isGroup ? "修改会议参会模型" : "修改本次协作模型"}</span>
          <CollabIconButton icon="close" label="关闭修改模型" disabled={saving} onClick={onClose} />
        </div>
        <div className="collab-modal-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="collab-run-models-hint" role="status">
            {hintText}
          </div>

          <div className={`collab-slot-row ${isGroup ? "meeting-slot-row" : ""}`}>
            {slotChecks.map(({ slot, available, reason }, index) => {
              const id = slotKey(slot);
              const isPrimary = !isGroup && slot.role === "primary";
              const isAuthor = isGroup && run.snapshot.final_author_slot_id === slot.slot_id;
              const activity = activeMeetingSlots.get(slot.slot_id);
              const alias = meetingMemberAlias(index);
              return (
                <div
                  key={id}
                  className={`collab-slot-card ${!available ? "invalid" : ""}`}
                >
                  <div className="collab-slot-heading">
                    <span>
                      {isGroup
                        ? alias
                        : isPrimary
                          ? "1. 主模型（实现与回应）"
                          : "2. 审核模型"}
                    </span>
                    {isAuthor ? <span className="collab-permission-tag">主笔</span> : null}
                    {activity && <span className="collab-permission-tag">{activity}</span>}
                    {!isGroup ? (
                      <span className="collab-permission-tag">{collabPermissionLabel(slot)}</span>
                    ) : null}
                  </div>
                  <div className="collab-slot-selector">
                    <AgentSelector
                      agent={slot.agent}
                      model={slot.model || ""}
                      mode={isPrimary ? slot.permission_mode || "" : ""}
                      effort={slot.effort || ""}
                      agents={agents}
                      menuPlacement="bottom"
                      viewportMenu
                      showLabel
                      showChevron
                      defaultExpandOptions
                      allowDefaultModel
                      allowDefaultMode={isPrimary}
                      warnUnavailable={!available}
                      onModeChange={
                        isPrimary
                          ? (permission_mode) =>
                              updateSlot(id, { ...slot, permission_mode: permission_mode || "" })
                          : undefined
                      }
                      onAgentChange={(nextAgent, nextModel) =>
                        updateSlot(id, normalizeSlotAfterAgentChange(slot, nextAgent, nextModel, agents))
                      }
                      onEffortChange={(nextEffort) =>
                        updateSlot(id, { ...slot, effort: nextEffort || "" })
                      }
                    />
                  </div>
                  {isGroup ? (
                    <div className="meeting-permission">
                      <span>权限</span>
                      <PermissionSelector
                        label={`${alias}运行权限`}
                        value={slot.permission_mode || ""}
                        choices={meetingPermissionChoices(slot, agents)}
                        disabled={saving}
                        onChange={(permission_mode) => updateSlot(id, { ...slot, permission_mode })}
                      />
                    </div>
                  ) : null}
                  {!available && reason ? (
                    <div style={{ fontSize: 11.5, color: "var(--cb-red)" }}>{reason}</div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {error ? (
            <div role="alert" style={{ fontSize: 12, color: "var(--cb-red)" }}>
              {error}
            </div>
          ) : null}

          <div className="collab-run-models-footer">
            <button
              type="button"
              className="collab-ghost-btn"
              disabled={saving}
              onClick={onClose}
            >
              <CollabIcon name="close" />
              取消
            </button>
            {canResume ? (
              <>
                <button
                  type="button"
                  className="collab-btn-secondary"
                  disabled={!hasChanges || anyChangedUnavailable || saving}
                  onClick={() => void handleSubmit(false)}
                >
                  <CollabIcon name="save" />
                  仅保存
                </button>
                <button
                  type="button"
                  className="collab-btn-primary"
                  disabled={!hasChanges || anyChangedUnavailable || saving}
                  onClick={() => void handleSubmit(true)}
                >
                  <CollabIcon name="play" />
                  {saving ? "保存中..." : "保存并继续"}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="collab-btn-primary"
                disabled={!hasChanges || anyChangedUnavailable || saving}
                onClick={() => void handleSubmit(false)}
              >
                <CollabIcon name={willInterruptActive ? "refresh" : "save"} />
                {saving
                  ? "保存中..."
                  : willInterruptActive
                    ? "保存并重新执行"
                    : "保存模型"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
