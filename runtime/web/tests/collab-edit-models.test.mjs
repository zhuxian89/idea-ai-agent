import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "vite";
import { chromium, expect } from "@playwright/test";

test("快速模式与开大会运行中修改模型（含不可用模型提示与移动端适配）", async (t) => {
  const dist = process.env.IDEA_COLLAB_DIST || await mkdtemp(path.join(tmpdir(), "idea-collab-edit-dist-"));
  if (!process.env.IDEA_COLLAB_DIST) {
    t.after(() => rm(dist, { recursive: true, force: true }));
    await build({
      root: fileURLToPath(new URL("../", import.meta.url)),
      logLevel: "silent",
      build: { outDir: dist, emptyOutDir: true },
    });
  }

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: "zh-CN", colorScheme: "light", viewport: { width: 1440, height: 900 } });
  const screenshotDir = process.env.COLLAB_SCREENSHOT_DIR;
  await page.routeWebSocket(/\/ws(?:\?|$)/, () => {});

  const errors = [];
  const updateRequests = [];
  page.on("pageerror", (err) => errors.push(err.message));

  const rootId = "proj-edit";
  const agents = [
    {
      name: "codex",
      installed: true,
      available: true,
      default_model_id: "gpt-5.3-codex",
      current_model_id: "gpt-5.3-codex",
      default_effort: "high",
      efforts: ["medium", "high", "xhigh"],
      models: [
        { id: "gpt-5.3-codex", name: "gpt-5.3-codex", supportEffort: true, efforts: ["medium", "high", "xhigh"] },
        { id: "gpt-5.4", name: "gpt-5.4", supportEffort: true, efforts: ["medium", "high", "xhigh"] },
      ],
      modes: [
        { id: "default", name: "default" },
        { id: "full-access", name: "full-access" },
      ],
    },
    {
      name: "claude",
      installed: true,
      available: true,
      default_model_id: "claude-sonnet-4-6",
      current_model_id: "claude-sonnet-4-6",
      default_effort: "high",
      efforts: ["medium", "high"],
      models: [
        { id: "claude-sonnet-4-6", name: "claude-sonnet-4-6", supportEffort: true, efforts: ["medium", "high"] },
      ],
      modes: [{ id: "default", name: "default" }],
    },
  ];

  const runs = new Map([
    [
      "run-quick-failed",
      {
        run: {
          id: "run-quick-failed",
          root_id: rootId,
          mode: "quick",
          title: "快速模式模型失效恢复",
          task_prompt: "实现接口并审核",
          snapshot: {
            mode: "quick",
            members: [
              { slot_id: "primary", role: "primary", agent: "codex", model: "gpt-5.3-codex", effort: "high" },
              { slot_id: "reviewer", role: "reviewer", agent: "claude", model: "claude-removed-99", effort: "high" },
            ],
          },
          status: "failed",
          current_step: "review",
          error_message: "模型 claude-removed-99 不可用",
          steps: [
            {
              key: "impl",
              title: "主模型实现",
              role: "primary",
              slot_id: "primary",
              agent: "codex",
              model: "gpt-5.3-codex",
              effort: "high",
              session_key: "collab-q-impl",
              status: "done",
              summary: "已完成初次实现",
            },
            {
              key: "review",
              title: "只读审核",
              role: "reviewer",
              slot_id: "reviewer",
              agent: "claude",
              model: "claude-removed-99",
              effort: "high",
              read_only: true,
              session_key: "collab-q-review",
              status: "failed",
              summary: "模型 claude-removed-99 不可用",
            },
            {
              key: "response",
              title: "主模型逐条回应",
              role: "primary",
              slot_id: "primary",
              agent: "codex",
              model: "gpt-5.3-codex",
              effort: "high",
              status: "pending",
            },
          ],
          created_at: "2026-11-26T09:00:00Z",
          updated_at: "2026-11-26T09:01:00Z",
        },
        review_items: [],
        docs: ["01-初次实现说明.md"],
      },
    ],
    [
      "run-meeting-running",
      {
        run: {
          id: "run-meeting-running",
          root_id: rootId,
          mode: "group",
          round: 1,
          title: "开大会运行中更换模型",
          task_prompt: "讨论升级方案",
          snapshot: {
            mode: "group",
            final_author_slot_id: "member-1",
            max_rounds: 3,
            members: [
              { slot_id: "member-1", role: "member", agent: "codex", model: "gpt-5.3-codex", effort: "high" },
              { slot_id: "member-2", role: "member", agent: "claude", model: "claude-removed-99", effort: "high" },
              { slot_id: "member-3", role: "member", agent: "claude", model: "claude-sonnet-4-6", effort: "medium" },
              { slot_id: "member-4", role: "member", agent: "codex", model: "gpt-5.3-codex", effort: "medium" },
              { slot_id: "member-5", role: "member", agent: "codex", model: "gpt-5.4", effort: "high" },
            ],
          },
          status: "running",
          current_step: "proposal",
          steps: [],
          created_at: "2026-11-26T09:02:00Z",
          updated_at: "2026-11-26T09:03:00Z",
        },
        meeting: {
          rounds: [
            {
              number: 1,
              inputs: ["00-会议议题.md"],
              turns: [
                {
                  id: "m-01-001",
                  kind: "proposal",
                  slot_id: "member-1",
                  status: "running",
                  session_key: "run-meeting-running-m-01-001",
                  doc: "第01轮/01-独立提案/成员1.md",
                  at: "2026-11-26T09:02:10Z",
                },
                {
                  id: "m-01-002",
                  kind: "proposal",
                  slot_id: "member-2",
                  status: "running",
                  session_key: "run-meeting-running-m-01-002",
                  doc: "第01轮/01-独立提案/成员2.md",
                  at: "2026-11-26T09:02:11Z",
                },
                {
                  id: "m-01-003",
                  kind: "answer",
                  slot_id: "member-2",
                  agent: "claude",
                  status: "done",
                  body: "使用 Agent 默认模型的已交付发言。",
                  session_key: "run-meeting-running-m-01-003",
                  doc: "第01轮/04-补充答复/成员2.md",
                  at: "2026-11-26T09:02:12Z",
                },
                {
                  id: "m-01-004",
                  kind: "proposal",
                  slot_id: "member-5",
                  status: "delivering",
                  session_key: "run-meeting-running-m-01-004",
                  doc: "第01轮/01-独立提案/成员5.md",
                  at: "2026-11-26T09:02:13Z",
                },
              ],
            },
          ],
        },
        review_items: [],
        docs: ["00-会议议题.md"],
      },
    ],
  ]);

  let bump = 10;
  await page.route("https://edit.test/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const pathname = url.pathname.replace(/^\/n\/[^/]+(?:\/p\/[^/]+)?/, "") || "/";
    const json = (value, status = 200) => route.fulfill({ status, json: value });

    if (pathname === "/api/dirs") {
      return json([{ id: rootId, display_name: "演示项目", root_path: "/workspace/demo" }]);
    }
    if (pathname === "/api/dir") return json({ entries: [] });
    if (pathname === "/api/relay/status") return json({ remote_host: false, e2ee_required: false });
    if (pathname === "/api/agents") return json({ agents, shells: [] });
    if (pathname === "/api/collab/templates") return json({ items: [], skills: [] });
    if (pathname === "/api/collab/runs" && req.method() === "GET") {
      return json({ items: [...runs.values()].map((entry) => entry.run), waiting_count: 0 });
    }
    const membersMatch = /^\/api\/collab\/runs\/([^/]+)\/members$/.exec(pathname);
    if (membersMatch && req.method() === "PUT") {
      const id = decodeURIComponent(membersMatch[1]);
      const body = req.postDataJSON();
      updateRequests.push({ id, ...body });
      const detail = runs.get(id);
      detail.run.snapshot.members = body.members;
      detail.run.updated_at = `2026-11-26T09:10:${String(bump++).padStart(2, "0")}Z`;
      if (detail.run.mode === "quick") {
        const rev = body.members.find((m) => m.role === "reviewer");
        const revStep = detail.run.steps.find((s) => s.key === "review");
        if (rev && revStep) {
          revStep.agent = rev.agent;
          revStep.model = rev.model;
          revStep.effort = rev.effort;
        }
        if (body.resume) {
          detail.run.status = "running";
          detail.run.error_message = "";
          if (revStep) revStep.status = "running";
        }
      }
      return json(detail);
    }
    const runMatch = /^\/api\/collab\/runs\/([^/]+)$/.exec(pathname);
    if (runMatch && req.method() === "GET") {
      return json(runs.get(decodeURIComponent(runMatch[1])));
    }
    if (pathname.startsWith("/api/sessions/")) {
      return json({
        key: decodeURIComponent(pathname.split("/")[3]),
        root_id: rootId,
        type: "chat",
        source: "collab_stage",
        activity_history_version: 1,
        reply_metadata_version: 1,
        exchanges: [],
      });
    }
    if (pathname.startsWith("/api/")) return json({ items: [], tasks: [], agents: [], shells: [] });

    const file = pathname === "/" ? "index.html" : pathname.slice(1);
    const contentType = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml" }[path.extname(file)];
    const body = await readFile(path.join(dist, file));
    return route.fulfill({
      contentType,
      body: file === "index.html"
        ? body.toString().replace("</head>", '<meta name="local-ai-agent-mode" content="standalone"></head>')
        : body,
    });
  });

  async function assertSingleRow(bar, count) {
    await expect(bar.locator(".collab-run-model-chip")).toHaveCount(count);
    const { height, rows } = await bar.evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      rows: [...el.querySelectorAll(".collab-run-model-chip")].map((chip) => chip.getBoundingClientRect().y),
    }));
    assert.ok(height <= 54, `model bar height: ${height}px`);
    assert.equal(new Set(rows).size, 1);
  }

  async function assertDetailRow(member, model) {
    const detail = page.locator(".collab-detail-head");
    const title = detail.locator(".t");
    const value = detail.locator(".m");
    await expect(title).toHaveText(member);
    await expect(value).toContainText(model);
    assert.equal((await title.boundingBox()).y, (await value.boundingBox()).y);
    assert.ok((await detail.boundingBox()).height <= 50);
  }

  await page.goto("https://edit.test/");
  await page.locator(".remote-topbar .collab-entry-btn:visible").first().click();

  // 1. Quick Mode: open failed run, verify unavailable badge, edit reviewer model & "保存并继续"
  await page.locator(".collab-run-item", { hasText: "快速模式模型失效恢复" }).click();
  const failedStep = page.locator(".collab-card.st-failed");
  await expect(failedStep.locator(".collab-tc-status")).toHaveText("失败");
  await expect(failedStep.locator(".collab-tc-warning")).toHaveText("模型 claude-removed-99 不可用");
  const quickBar = page.getByRole("group", { name: "本次协作模型配置" });
  await expect(quickBar.getByRole("img", { name: "不可用", exact: true })).toBeVisible();
  await assertSingleRow(quickBar, 2);
  await page.getByRole("button", { name: "修改模型", exact: true }).click();
  const quickDialog = page.getByRole("dialog", { name: "修改运行模型" });
  await expect(quickDialog).toBeVisible();
  await expect(quickDialog.getByRole("button", { name: "保存并继续" })).toBeDisabled();

  // Open reviewer AgentSelector (second slot card) and switch to claude-sonnet-4-6
  await quickDialog.locator(".collab-slot-card").nth(1).locator(".collab-slot-selector button").first().click();
  await page.locator('[data-agent-menu="true"]').getByRole("button", { name: /claude-sonnet-4-6/ }).first().click();
  await page.keyboard.press("Escape");
  await expect(quickDialog.getByRole("button", { name: "保存并继续" })).toBeEnabled();
  await quickDialog.getByRole("button", { name: "保存并继续" }).click();
  await expect(quickDialog).toHaveCount(0);
  await expect(page.locator(".collab-run-model-chip.invalid")).toHaveCount(0);
  await expect(quickBar.getByRole("group", { name: /审核 · Claude Code · claude-sonnet-4-6/ })).toContainText("Sonnet 4.6");
  assert.equal(updateRequests.length, 1);
  assert.equal(updateRequests[0].id, "run-quick-failed");
  assert.equal(updateRequests[0].resume, true);
  assert.equal(updateRequests[0].members[1].model, "claude-sonnet-4-6");

  // 2. Switch a speaking member's unavailable model and change meeting permissions.
  await page.locator(".collab-run-item", { hasText: "开大会运行中更换模型" }).click();
  const modelBar = page.getByRole("group", { name: "参会模型配置" });
  const unavailable = modelBar.getByRole("button", { name: /查看成员2发言过程：成员2 · Claude Code/ });
  await expect(unavailable.getByRole("img", { name: "不可用" })).toHaveAttribute("title", /claude-removed-99/);
  await expect(modelBar.getByRole("img", { name: "有参会模型不可用" })).toBeVisible();
  await expect(modelBar).toContainText("claude-removed-99");
  await expect(modelBar).toContainText("high");
  await expect(modelBar.getByRole("img", { name: "主笔" })).toBeVisible();
  await expect(modelBar.getByRole("button", { name: /查看成员1发言过程：成员1 · Codex/ }).getByRole("img", { name: "发言中" })).toBeVisible();
  await assertSingleRow(modelBar, 5);
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "r04-meeting-desktop.png") });
  await page.getByRole("button", { name: "修改模型", exact: true }).click();
  const meetingDialog = page.getByRole("dialog", { name: "修改运行模型" });
  await expect(meetingDialog).toBeVisible();

  // Switch member-2 (second slot card) from Claude to Codex -> gpt-5.4
  await meetingDialog.locator(".collab-slot-card").nth(1).locator(".collab-slot-selector button").first().click();
  const agentMenu = page.locator('[data-agent-menu="true"]');
  await agentMenu.getByRole("button", { name: /^Codex/ }).first().click();
  await agentMenu.getByRole("button", { name: /gpt-5\.4/ }).first().click();
  await page.keyboard.press("Escape");
  const permission = meetingDialog.getByRole("button", { name: /成员2运行权限/ });
  await expect(permission).toHaveText("严格只读");
  await permission.press("ArrowDown");
  const choices = page.getByRole("listbox", { name: "成员2运行权限" });
  await expect(choices.getByRole("option", { name: "严格只读" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(permission).toHaveText("沿用 Agent 配置");
  await expect(permission).toBeFocused();
  await expect(meetingDialog.getByRole("status")).toContainText("正在发言的已修改成员将中断并用新模型重新发言");
  await meetingDialog.getByRole("button", { name: "保存并重新执行" }).click();
  await expect(meetingDialog).toHaveCount(0);
  await expect(modelBar.locator(".collab-run-model-chip.invalid")).toHaveCount(0);
  await expect(modelBar).toContainText("gpt-5.4");
  await expect(modelBar).not.toContainText("沿用 Agent 配置");
  await expect(modelBar.getByRole("button", { name: /查看成员2发言过程：成员2 · Codex · gpt-5\.4 · high · 沿用 Agent 配置/ })).toBeVisible();
  assert.equal(updateRequests.length, 2);
  assert.equal(updateRequests[1].id, "run-meeting-running");
  assert.equal(updateRequests[1].resume, false);
  assert.equal(updateRequests[1].members[1].agent, "codex");
  assert.equal(updateRequests[1].members[1].model, "gpt-5.4");
  assert.equal(updateRequests[1].members[1].permission_mode, "agent-default");

  const composer = page.getByRole("textbox", { name: "会议补充" });
  await composer.fill("@");
  const mentions = page.getByLabel("点名成员");
  await expect(mentions.getByRole("button", { name: "成员1 · 5.3-codex" })).toBeVisible();
  await expect(mentions.getByRole("button", { name: "成员2 · gpt-5.4" })).toBeVisible();
  await composer.fill("");

  const priorTurn = page.locator("#meeting-m-01-003");
  await expect(priorTurn).toContainText("成员2 · 默认模型");
  await expect(priorTurn.getByRole("img", { name: "Claude Code" })).toBeVisible();
  await priorTurn.locator(".collab-tc-select").click();
  await assertDetailRow("成员2", "默认模型");
  const detailHead = page.locator(".collab-detail-head");
  const detailBody = page.locator(".collab-detail-body");
  await expect(detailHead.getByRole("img", { name: "Claude Code" })).toBeVisible();
  await expect(detailHead.locator(".collab-detail-permission")).toHaveCount(0);
  await expect(detailHead.locator(".collab-model-dot")).toHaveCount(0);
  await expect(detailBody.getByText("run-meeting-running-m-01-003", { exact: true })).toBeVisible();
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "r04-meeting-detail-desktop.png") });

  // 3. Mobile 390px: open modal and ensure zero horizontal overflow
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.getByRole("button", { name: "返回群聊" }).isVisible()) {
    await page.getByRole("button", { name: "返回群聊" }).click();
  }
  await assertSingleRow(modelBar, 5);
  const list = modelBar.locator(".collab-run-model-list");
  assert.ok(await list.evaluate((el) => el.scrollWidth > el.clientWidth));
  if (screenshotDir) await modelBar.screenshot({ path: path.join(screenshotDir, "r04-meeting-phone.png") });
  const laterProcess = modelBar.getByRole("button", { name: "查看成员5发言过程" });
  await laterProcess.scrollIntoViewIfNeeded();
  assert.ok(await list.evaluate((el) => el.scrollLeft > 0));
  await laterProcess.click();
  await assertDetailRow("成员5", "gpt-5.4 · high");
  await expect(detailHead.getByRole("button", { name: "运行列表" })).toBeVisible();
  await expect(detailHead.locator('.collab-detail-agent img[alt="Codex"]')).toBeVisible();
  await expect(detailBody.getByText("run-meeting-running-m-01-004", { exact: true })).toBeVisible();
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "r04-meeting-detail-phone.png") });
  await page.getByRole("button", { name: "返回群聊" }).click();
  await page.getByRole("button", { name: "修改模型", exact: true }).click();
  await expect(meetingDialog).toBeVisible();
  await expect(permission).toHaveText("沿用 Agent 配置");
  await permission.click();
  await expect(choices.getByRole("option", { name: "沿用 Agent 配置" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(permission).toBeFocused();
  const overflow = await page.evaluate(() => {
    const shell = document.querySelector(".collab-shell");
    return [document.documentElement.scrollWidth - window.innerWidth, shell.scrollWidth - shell.clientWidth];
  });
  assert.deepEqual(overflow, [0, 0]);
  await page.getByRole("button", { name: "取消", exact: true }).click();

  await page.setViewportSize({ width: 520, height: 860 });
  await page.goto("https://edit.test/?ide=1");
  await page.locator(".collab-entry-btn:visible").first().click();
  await page.getByRole("button", { name: /运行列表/ }).first().click();
  await page.locator(".collab-run-item", { hasText: "开大会运行中更换模型" }).click();
  const localCard = page.locator(".meeting-message.st-running").first();
  await expect(localCard).toHaveCSS("animation-name", "collabBreatheCard");
  await expect(localCard).not.toHaveAttribute("data-glow-active");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(localCard).toHaveCSS("animation-name", "none");

  assert.deepEqual(errors, []);
});
