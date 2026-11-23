import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { mount } from "./helpers/mount-app-fixture.mjs";

const fixture = `
  import { MultiProjectSessionList } from "./src/components/SessionList";
  const s = (key, name, extra = {}) => ({ key, session_key: key, name, agent: "codex", type: "chat", updated_at: "2026-11-23T08:00:00Z", ...extra });
  const groups = [
    { rootId: "UIScroller", rootName: "UIScroller", totalCount: 2, sessions: [
      s("a1", "速度档位调整与自定义"),
      s("a1-c1", "子代理甲（已结束）", { parent_session_key: "a1" }),
      s("a1-c2", "子代理乙（运行中）", { parent_session_key: "a1", pending: true }),
      s("a2", "你先看下这个项目，我是r"),
    ] },
    { rootId: "idea-ai-agent", rootName: "idea-ai-agent", totalCount: 2, sessions: [
      s("b1", "沉浸式 App 实现方案", { pending: true }),
      s("b2", "频繁断连重连原因"),
    ] },
  ];
  const noop = () => {};
  function Fixture() {
    const phone = new URLSearchParams(location.search).get("kind") === "phone";
    if (phone) return <div className="remote-phone-sessions" style={{ width: 390, height: 640, overflow: "auto" }}>
      <MultiProjectSessionList groups={groups} selectedKey="b1" selectedRootId="idea-ai-agent" onSelect={noop} onSync={noop} onPin={noop}
        onRename={noop} onDelete={noop} onScheduledTask={noop} onHandoffPack={noop} onProjectClick={noop} onLoadMoreProject={noop} onLoadChildren={noop} />
    </div>;
    return <div className="remote-shell"><aside className="remote-side" style={{ width: 250, height: 640, overflow: "auto" }}>
      <MultiProjectSessionList groups={groups} selectedKey="b1" selectedRootId="idea-ai-agent" onSelect={noop} onSync={noop} onPin={noop}
        onRename={noop} onDelete={noop} onScheduledTask={noop} onHandoffPack={noop} onProjectClick={noop} onLoadMoreProject={noop} onLoadChildren={noop} />
    </aside></div>;
  }
`;
const files = ["index.css", "components/workspaceSidebar.css", "components/remoteui/remoteDesign.css", "components/remote/remoteAccess.css", "layout/remotePhone.css"];
const css = files.map(f => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8").replace(/^@(?:import|source)\s[^\n]*$/gm, "")).join("\n");

async function render(t, kind = "side") {
  const page = await mount(t, fixture, () => ({}), 420, `/?device=tablet&kind=${kind}`, '<meta name="local-ai-agent-mode" content="standalone">');
  await page.setViewportSize({ width: 420, height: 700 });
  await page.addStyleTag({ content: css });
  await page.evaluate(() => { document.documentElement.setAttribute("data-remote-ui", ""); document.documentElement.setAttribute("data-theme", "dark"); document.body.removeAttribute("style"); });
  await expect(page.locator(".workspace-project-heading").first()).toBeVisible();
  return page;
}

for (const kind of ["side", "phone"]) test(`sub-agent sessions are not listed, in any state (${kind})`, async t => {
  const page = await render(t, kind);
  await expect(page.getByText("速度档位调整与自定义")).toBeVisible();
  await expect(page.locator(".workspace-child-group")).toHaveCount(0);
  await expect(page.getByText("子代理甲（已结束）")).toHaveCount(0);
  await expect(page.getByText("子代理乙（运行中）")).toHaveCount(0);
  await expect(page.locator(".workspace-session-row")).toHaveCount(4);
});

for (const kind of ["side", "phone"]) test(`sessions sit visibly under their project, and the project is the stronger line of text (${kind})`, async t => {
  const page = await render(t, kind);
  const m = await page.evaluate(() => {
    const box = element => { const r = element.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
    const projects = [...document.querySelectorAll(".workspace-session-project")].map(section => {
      const heading = section.querySelector(".workspace-project-heading");
      const list = section.querySelector(".workspace-project-sessions");
      const cards = [...section.querySelectorAll(".workspace-session-row")];
      const name = section.querySelector(".workspace-project-name");
      const title = cards[0].querySelector("span[title], span");
      const listStyle = getComputedStyle(list);
      return {
        heading: box(heading), toggle: box(section.querySelector(".workspace-group-toggle")), list: box(list), cards: cards.map(box),
        rail: parseFloat(listStyle.borderLeftWidth), railStyle: listStyle.borderLeftStyle,
        nameSize: parseFloat(getComputedStyle(name).fontSize), nameWeight: parseInt(getComputedStyle(name).fontWeight, 10),
        cardTitleSize: Math.max(...[...cards[0].querySelectorAll("span")].map(el => el.textContent.trim() ? parseFloat(getComputedStyle(el).fontSize) : 0)),
      };
    });
    return projects;
  });
  for (const [i, p] of m.entries()) {
    assert.ok(p.rail >= 1 && p.railStyle === "solid", `project ${i}: no guide line down the left of its sessions (border ${p.rail}px ${p.railStyle})`);
    assert.ok(p.cards[0].left - p.heading.left >= 12, `project ${i}: cards start ${p.cards[0].left - p.heading.left}px from the heading's edge: no indentation`);
    assert.ok(p.cards[0].left >= p.toggle.left + 8, `project ${i}: cards are not tucked under the project's toggle`);
    assert.ok(p.nameSize >= p.cardTitleSize + 1, `project ${i}: project name ${p.nameSize}px is not larger than a session title ${p.cardTitleSize}px`);
    assert.ok(p.nameWeight >= 650, `project ${i}: project name weight ${p.nameWeight}`);
  }
  const gap = m[1].heading.top - m[0].cards.at(-1).bottom;
  assert.ok(gap >= 14, `only ${gap}px between one project's last card and the next project's heading`);
});
