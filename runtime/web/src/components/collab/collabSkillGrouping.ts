import type { CollabSkillSummary } from "../../services/collab";

export interface SkillCategoryGroup {
  key: string;
  label: string;
  hint?: string;
  skills: CollabSkillSummary[];
}

interface SourceMeta {
  key: string;
  label: string;
  hint?: string;
  order: number;
}

const KNOWN_SOURCE_META: Record<string, SourceMeta> = {
  codex: {
    key: "codex",
    label: "Codex",
    hint: "~/.codex/skills",
    order: 0,
  },
  agents: {
    key: "agents",
    label: "共享 Agents",
    hint: "~/.agents/skills",
    order: 1,
  },
  claude: {
    key: "claude",
    label: "Claude",
    hint: "~/.claude/skills",
    order: 2,
  },
};

function getSkillSourceMeta(rawSource?: string): SourceMeta {
  const trimmed = (rawSource || "").trim();
  if (!trimmed) {
    return { key: "other", label: "其他", order: 99 };
  }
  const normalized = trimmed.toLowerCase();
  return (
    KNOWN_SOURCE_META[normalized] || {
      key: normalized,
      label: trimmed,
      order: 50,
    }
  );
}

export function groupSkillsBySource(skills: CollabSkillSummary[]): SkillCategoryGroup[] {
  const bucketMap = new Map<string, { meta: SourceMeta; skills: CollabSkillSummary[] }>();

  for (const sk of skills) {
    const meta = getSkillSourceMeta(sk.source);
    const existing = bucketMap.get(meta.key);
    if (existing) {
      existing.skills.push(sk);
    } else {
      bucketMap.set(meta.key, { meta, skills: [sk] });
    }
  }

  return [...bucketMap.values()]
    .sort((a, b) => {
      if (a.meta.order !== b.meta.order) return a.meta.order - b.meta.order;
      return a.meta.label.localeCompare(b.meta.label, "zh-CN");
    })
    .map(({ meta, skills: groupSkills }) => ({
      key: meta.key,
      label: meta.label,
      hint: meta.hint,
      skills: [...groupSkills].sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
    }));
}

export function filterVisibleSkillPaths(
  selectedPaths: string[],
  skills: CollabSkillSummary[],
): string[] {
  const visiblePathSet = new Set(skills.map((sk) => sk.path));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const p of selectedPaths) {
    if (visiblePathSet.has(p) && !seen.has(p)) {
      seen.add(p);
      result.push(p);
    }
  }
  return result;
}

export function countSelectedSkills(
  selectedPaths: string[],
  skills: CollabSkillSummary[],
): number {
  return filterVisibleSkillPaths(selectedPaths, skills).length;
}

export function toggleSkillGroup(
  selectedPaths: string[],
  groupSkills: CollabSkillSummary[],
): string[] {
  const groupPaths = groupSkills.map((sk) => sk.path);
  const selectedSet = new Set(selectedPaths);
  const allGroupSelected = groupPaths.every((p) => selectedSet.has(p));

  if (allGroupSelected) {
    const removeSet = new Set(groupPaths);
    return selectedPaths.filter((p) => !removeSet.has(p));
  }

  const next = [...selectedPaths];
  for (const p of groupPaths) {
    if (!selectedSet.has(p)) {
      next.push(p);
      selectedSet.add(p);
    }
  }
  return next;
}
