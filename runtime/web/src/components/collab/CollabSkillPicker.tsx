import React, { useMemo } from "react";
import type { CollabSkillSummary } from "../../services/collab";
import {
  countSelectedSkills,
  filterVisibleSkillPaths,
  groupSkillsBySource,
  toggleSkillGroup,
} from "./collabSkillGrouping";

interface Props {
  skills: CollabSkillSummary[];
  selectedPaths: string[];
  onChange: (nextPaths: string[]) => void;
  title?: string;
  description?: string;
  maxHeight?: number;
}

export function CollabSkillPicker({
  skills,
  selectedPaths,
  onChange,
  title = "附加审核 Skill 规范（可选）",
  description,
  maxHeight,
}: Props) {
  const groups = useMemo(() => groupSkillsBySource(skills), [skills]);

  if (skills.length === 0) return null;

  const visibleSelectedPaths = filterVisibleSkillPaths(selectedPaths, skills);
  const selectedSet = new Set(visibleSelectedPaths);
  const selectedCount = visibleSelectedPaths.length;
  const allSelected = selectedCount === skills.length;

  return (
    <div className="collab-skill-picker">
      <div className="collab-skill-picker-head">
        <div className="collab-skill-picker-title-wrap">
          <span className="collab-skill-picker-title">{title}</span>
          <span className="collab-skill-picker-count">
            已选 {selectedCount} / {skills.length}
          </span>
        </div>
        <div className="collab-skill-picker-actions">
          <button
            type="button"
            className="collab-skill-action-btn"
            onClick={() => onChange(toggleSkillGroup(visibleSelectedPaths, skills))}
          >
            {allSelected ? "取消全选" : "一键全选"}
          </button>
        </div>
      </div>

      {description ? (
        <div className="collab-skill-picker-desc">{description}</div>
      ) : null}

      <div
        className="collab-skill-picker-list"
        style={maxHeight ? { maxHeight } : undefined}
      >
        {groups.map((group) => {
          const groupSelectedCount = countSelectedSkills(visibleSelectedPaths, group.skills);
          const groupAllSelected = groupSelectedCount === group.skills.length;
          return (
            <div key={group.key} className="collab-skill-group" data-skill-group={group.key}>
              <div className="collab-skill-group-head">
                <div className="collab-skill-group-meta">
                  <span className="collab-skill-group-label">{group.label}</span>
                  {group.hint ? (
                    <span className="collab-mono collab-skill-group-hint">{group.hint}</span>
                  ) : null}
                  <span className="collab-skill-group-count">
                    {groupSelectedCount} / {group.skills.length}
                  </span>
                </div>
                <button
                  type="button"
                  className="collab-skill-group-toggle"
                  onClick={() => onChange(toggleSkillGroup(visibleSelectedPaths, group.skills))}
                >
                  {groupAllSelected ? "取消本类" : "全选本类"}
                </button>
              </div>
              <div className="collab-skill-group-items">
                {group.skills.map((sk) => {
                  const checked = selectedSet.has(sk.path);
                  return (
                    <label
                      key={sk.path}
                      className={`collab-skill-chip ${checked ? "checked" : ""}`}
                      title={sk.description ? `${sk.description} · ${sk.path}` : sk.path}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          onChange(
                            e.target.checked
                              ? [...visibleSelectedPaths, sk.path]
                              : visibleSelectedPaths.filter((p) => p !== sk.path),
                          )
                        }
                      />
                      <span className="collab-mono">{sk.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
