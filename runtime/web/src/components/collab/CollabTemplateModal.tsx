import React, { useState } from "react";
import type { AgentStatus } from "../../services/agents";
import type {
  CollabMemberSlot,
  CollabMode,
  MeetingTopicMode,
  CollabSkillSummary,
  CollabTemplateWithAvailability,
} from "../../services/collab";
import { AgentSelector } from "../AgentSelector";
import { defaultCollabMembers, MeetingMemberSettings } from "./MeetingMemberSettings";
import { CollabSkillPicker } from "./CollabSkillPicker";
import { filterVisibleSkillPaths } from "./collabSkillGrouping";
import {
  collabPermissionLabel,
  formatCollabMemberBadge,
  normalizeSlotAfterAgentChange,
  normalizeSlotForSubmission,
} from "./collabModelDisplay";

interface Props {
  open: boolean;
  mode: CollabMode;
  templates: CollabTemplateWithAvailability[];
  skills: CollabSkillSummary[];
  agents: AgentStatus[];
  onClose: () => void;
  onApply: (tpl: CollabTemplateWithAvailability) => void;
  onSave: (tpl: {
    id?: string;
    name: string;
    is_default?: boolean;
    members: CollabMemberSlot[];
    skill_paths?: string[];
    final_author_slot_id?: string;
    topic_mode?: MeetingTopicMode;
    max_rounds?: number;
  }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function CollabTemplateModal({
  open,
  mode,
  templates,
  skills,
  agents,
  onClose,
  onApply,
  onSave,
  onDelete,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [members, setMembers] = useState<CollabMemberSlot[]>([]);
  const [author, setAuthor] = useState("");
  const [topicMode, setTopicMode] = useState<MeetingTopicMode>("multi");
  const [rounds, setRounds] = useState(3);
  const group = mode === "group";
  const [skillPaths, setSkillPaths] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  const startCreate = () => {
    const defaults = defaultCollabMembers(agents, group);
    setEditingId("__new__");
    setName("");
    setIsDefault(templates.length === 0);
    setMembers(defaults);
    setAuthor(defaults[0].slot_id);
    setTopicMode("multi");
    setRounds(3);
    setSkillPaths([]);
    setError("");
  };

  const startEdit = (tpl: CollabTemplateWithAvailability) => {
    setEditingId(tpl.id);
    setName(tpl.name);
    setIsDefault(Boolean(tpl.is_default));
    setMembers(tpl.members.map((m) => ({ ...m })));
    setAuthor(tpl.final_author_slot_id || tpl.members[0]?.slot_id || "");
    setTopicMode(tpl.topic_mode || "multi");
    setRounds(tpl.max_rounds || 3);
    setSkillPaths([...(tpl.skill_paths || [])]);
    setError("");
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError("请输入模板名称");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave({
        id: editingId === "__new__" ? undefined : editingId || undefined,
        name: name.trim(),
        ...(group ? { final_author_slot_id: author, max_rounds: rounds, topic_mode: topicMode } : {}),
        is_default: isDefault,
        members: members.map((slot) => normalizeSlotForSubmission(slot, agents)),
        skill_paths: skills.length > 0 ? filterVisibleSkillPaths(skillPaths, skills) : skillPaths,
      });
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存模板失败");
    } finally {
      setBusy(false);
    }
  };

  const updateSlot = (role: "primary" | "reviewer", patch: Partial<CollabMemberSlot>) => {
    setMembers((prev) =>
      prev.map((m) => (m.role === role ? { ...m, ...patch } : m)),
    );
  };

  return (
    <div className="collab-modal-backdrop" onClick={onClose}>
      <div className="collab-modal" onClick={(e) => e.stopPropagation()}>
        <div className="collab-modal-head">
          <span>全局协作模板（跨项目共用）</span>
          <button type="button" className="collab-icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="collab-modal-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12, color: "var(--cb-text-ter)" }}>
            应用模板是复制快照，修改或删除全局模板不会影响历史运行记录。
          </div>

          {editingId ? (
            <div className="collab-d-item" style={{ gap: 10 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                {editingId === "__new__" ? group ? "新建会议模板" : "新建快速模式模板" : "编辑模板"}
              </div>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={group ? "会议模板名称" : "模板名称，如：Codex 主写 + Claude 严审"}
                style={{
                  padding: "7px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--cb-card-border)",
                  background: "var(--cb-surface)",
                  color: "var(--cb-text)",
                }}
              />
              {group ? (
                <MeetingMemberSettings members={members} agents={agents} author={author} rounds={rounds} topicMode={topicMode} onTopicMode={setTopicMode}
                  onMembers={setMembers} onAuthor={setAuthor} onRounds={setRounds} />
              ) : <div className="collab-slot-row">
                {(["primary", "reviewer"] as const).map((role) => {
                  const slot = members.find((m) => m.role === role);
                  if (!slot) return null;
                  return (
                    <div key={role} className="collab-slot-card">
                      <div className="collab-slot-heading">
                        {role === "primary" ? "主模型（实现与回应）" : "审核模型（严格只读）"}
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
                          onModeChange={role === "primary" ? (permission_mode) => updateSlot(role, { permission_mode }) : undefined}
                          onAgentChange={(nextAgent, nextModel) =>
                            setMembers((prev) =>
                              prev.map((m) =>
                                m.role === role
                                  ? normalizeSlotAfterAgentChange(m, nextAgent, nextModel, agents)
                                  : m,
                              ),
                            )
                          }
                          onEffortChange={(nextEffort) =>
                            updateSlot(role, { effort: nextEffort || "" })
                          }
                        />
                      </div>
                    </div>
                  );
                })}
              </div>}

              {skills.length > 0 ? (
                <CollabSkillPicker
                  skills={skills}
                  selectedPaths={skillPaths}
                  onChange={setSkillPaths}
                  title="附加审核 Skill 规范（可选）"
                  maxHeight={220}
                />
              ) : null}

              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                />
                <span>{group ? "设为会议默认模板" : "设为快速模式默认模板"}</span>
              </label>

              {error ? (
                <div style={{ color: "var(--cb-red)", fontSize: 12 }}>{error}</div>
              ) : null}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  type="button"
                  className="collab-btn-secondary"
                  onClick={() => setEditingId(null)}
                  disabled={busy}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="collab-btn-primary"
                  onClick={() => void handleSave()}
                  disabled={busy || group && (rounds < 1 || rounds > 5)}
                >
                  保存模板
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>已保存模板（{templates.length}）</span>
              <button type="button" className="collab-btn-secondary" onClick={startCreate}>
                ＋ 新建模板
              </button>
            </div>
          )}

          {templates.length === 0 && !editingId ? (
            <div style={{ padding: "20px 0", textAlign: "center", color: "var(--cb-text-ter)", fontSize: 13 }}>
              暂无全局模板，点击右上角「＋ 新建模板」或在发起页直接保存。
            </div>
          ) : (
            templates.map((tpl) => (
              <div key={tpl.id} className="collab-d-item">
                <div className="collab-d-head">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>{tpl.name}</span>
                    {tpl.is_default ? (
                      <span
                        style={{
                          fontSize: 11,
                          padding: "1px 7px",
                          borderRadius: 999,
                          background: "var(--cb-accent-soft)",
                          color: "var(--cb-accent)",
                        }}
                      >
                        默认
                      </span>
                    ) : null}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      className="collab-btn-secondary"
                      onClick={() => {
                        onApply(tpl);
                        onClose();
                      }}
                    >
                      应用
                    </button>
                    {!tpl.is_default ? (
                      <button
                        type="button"
                        className="collab-btn-secondary"
                        onClick={() =>
                          void onSave({
                            id: tpl.id,
                            name: tpl.name,
                            is_default: true,
                            members: tpl.members,
                            skill_paths: tpl.skill_paths,
                            final_author_slot_id: tpl.final_author_slot_id,
                            max_rounds: tpl.max_rounds,
                            topic_mode: tpl.topic_mode,
                          })
                        }
                      >
                        设为默认
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="collab-btn-secondary"
                      onClick={() => startEdit(tpl)}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className="collab-btn-secondary"
                      style={{ color: "var(--cb-red)" }}
                      onClick={() => void onDelete(tpl.id)}
                    >
                      删除
                    </button>
                  </div>
                </div>
                <div className="collab-template-members">
                  {tpl.members.map((member, index) => (
                    <div key={member.slot_id} className="collab-slot-heading">
                      <span className="collab-mono">
                        {group ? `成员${index + 1}${member.slot_id === tpl.final_author_slot_id ? "（主笔）" : ""}`
                          : member.role === "primary" ? "主模型" : "审核模型"} · {formatCollabMemberBadge(member, agents)}
                      </span>
                      <span className="collab-permission-tag">{collabPermissionLabel(member, group, agents)}</span>
                    </div>
                  ))}
                </div>
                {!tpl.all_available ? (
                  <div style={{ fontSize: 12, color: "var(--cb-red)" }}>
                    {tpl.availability
                      .filter((a) => !a.available)
                      .map((a) => a.reason)
                      .join("；")}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
