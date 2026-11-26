import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import vm from "node:vm";

const modulePath = fileURLToPath(
  new URL("../src/components/collab/collabSkillGrouping.ts", import.meta.url),
);
const source = fs.readFileSync(modulePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

const moduleExports = {};
const moduleObj = { exports: moduleExports };
const loader = vm.runInThisContext(
  `(function(exports, module) {\n${compiled}\n})`,
  { filename: modulePath },
);
loader(moduleExports, moduleObj);

const {
  countSelectedSkills,
  filterVisibleSkillPaths,
  groupSkillsBySource,
  toggleSkillGroup,
} = moduleObj.exports;

const sampleSkills = [
  { name: "unslop", path: "/skills/claude/unslop/SKILL.md", source: "claude", description: "UI polish" },
  { name: "browser-use", path: "/skills/agents/browser-use/SKILL.md", source: "agents", description: "Browser CDP" },
  { name: "cs-audit", path: "/skills/codex/cs-audit/SKILL.md", source: "codex", description: "Audit" },
  { name: "cs", path: "/skills/codex/cs/SKILL.md", source: "codex", description: "CodeStable root" },
  { name: "cs-feat", path: "/skills/codex/cs-feat/SKILL.md", source: "codex", description: "Feature workflow" },
  { name: "code-simplifier", path: "/skills/codex/code-simplifier/SKILL.md", source: "codex", description: "Simplify" },
  { name: "custom-lint", path: "/skills/custom/custom-lint/SKILL.md", source: "team-rules" },
  { name: "legacy-skill", path: "/skills/other/legacy/SKILL.md", source: "" },
];

test("groupSkillsBySource orders known backend sources canonically and sorts skills within each category", () => {
  const groups = groupSkillsBySource(sampleSkills);
  assert.deepEqual(
    groups.map((g) => ({ key: g.key, label: g.label, names: g.skills.map((s) => s.name) })),
    [
      { key: "codex", label: "Codex", names: ["code-simplifier", "cs", "cs-audit", "cs-feat"] },
      { key: "agents", label: "共享 Agents", names: ["browser-use"] },
      { key: "claude", label: "Claude", names: ["unslop"] },
      { key: "team-rules", label: "team-rules", names: ["custom-lint"] },
      { key: "other", label: "其他", names: ["legacy-skill"] },
    ],
  );
  assert.deepEqual(groupSkillsBySource([]), []);
});

test("filterVisibleSkillPaths and countSelectedSkills exclude stale and duplicate paths", () => {
  const stalePath = "/skills/removed-old/SKILL.md";
  const firstVisible = sampleSkills[0].path;
  const raw = [stalePath, firstVisible, firstVisible];

  assert.deepEqual(filterVisibleSkillPaths(raw, sampleSkills), [firstVisible]);
  assert.equal(countSelectedSkills(raw, sampleSkills), 1);
  assert.equal(countSelectedSkills([stalePath], sampleSkills), 0);
});

test("one-click select all and per-category toggle clear stale paths and avoid duplicates", () => {
  const stalePath = "/skills/removed-old/SKILL.md";
  const allVisible = sampleSkills.map((sk) => sk.path);

  // Picker normalizes selectedPaths via filterVisibleSkillPaths before toggling
  const normalized = filterVisibleSkillPaths([stalePath, allVisible[0]], sampleSkills);
  const afterSelectAll = toggleSkillGroup(normalized, sampleSkills);
  assert.equal(countSelectedSkills(afterSelectAll, sampleSkills), sampleSkills.length);
  assert.equal(afterSelectAll.length, sampleSkills.length);
  assert.equal(afterSelectAll.includes(stalePath), false);

  // Clicking select-all again clears back to empty array with no leftover stale path
  const afterUnselectAll = toggleSkillGroup(afterSelectAll, sampleSkills);
  assert.deepEqual(afterUnselectAll, []);
  assert.equal(countSelectedSkills(afterUnselectAll, sampleSkills), 0);

  // Per-category toggle only affects that category
  const groups = groupSkillsBySource(sampleSkills);
  const codexGroup = groups.find((g) => g.key === "codex");
  const claudeGroup = groups.find((g) => g.key === "claude");

  let selected = toggleSkillGroup([], codexGroup.skills);
  assert.equal(countSelectedSkills(selected, codexGroup.skills), codexGroup.skills.length);
  assert.equal(countSelectedSkills(selected, claudeGroup.skills), 0);

  selected = toggleSkillGroup(selected, claudeGroup.skills);
  assert.equal(countSelectedSkills(selected, sampleSkills), codexGroup.skills.length + claudeGroup.skills.length);

  // Toggle codex category off leaves claude intact
  selected = toggleSkillGroup(selected, codexGroup.skills);
  assert.equal(countSelectedSkills(selected, codexGroup.skills), 0);
  assert.equal(countSelectedSkills(selected, claudeGroup.skills), claudeGroup.skills.length);
});
