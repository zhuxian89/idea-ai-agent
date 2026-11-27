import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "vite";
import { chromium, expect } from "@playwright/test";

const rootId = "meeting-project";
const runId = "run-meeting";
const quickId = "run-linked";
const revisedPlan = "第02轮/05-正式计划-m-02-005.md";
const at = (second) => `2026-11-26T08:00:${String(second).padStart(2, "0")}Z`;
const members = [
  { slot_id: "member-1", role: "member", agent: "codex", model: "gpt-5.3-codex" },
  { slot_id: "member-2", role: "member", agent: "claude", model: "claude-opus-4-6" },
];
const longBody = Array.from({ length: 13 }, (_, i) => `第 ${i + 1} 段原生提案。逐条说明改动依据和验证方法。`).join("\n\n") +
  "\n\n这段尾部正文仍完整保留。";

function newRound(number, firstStatus) {
  const dir = `第${String(number).padStart(2, "0")}轮`;
  const kind = number === 1 ? "proposal" : "review";
  return {
    number,
    inputs: number === 1 ? ["00-会议议题.md"] : ["第01轮/03-共识与分歧.md", "第01轮/04-作者补充.md"],
    turns: members.map((member, i) => ({
      id: `m-0${number}-00${i + 1}`, slot_id: member.slot_id, kind, status: firstStatus, at: at(2 + i),
      doc: `${dir}/${number === 1 ? "01-独立提案" : "02-互评"}/成员${i + 1}.md`,
      session_key: `${runId}-m-0${number}-00${i + 1}`,
    })),
  };
}

function finishRound(detail, stalled = false) {
  const round = detail.meeting.rounds.at(-1);
  const dir = `第${String(round.number).padStart(2, "0")}轮`;
  const position = (turn, i) => ({
    quote: i === 0 ? "同意这个判定，但需保留性能检查。" : "仍有异议，入口需要兼容旧数据。",
    stance: i === 0 ? "agree" : "disagree", slot_id: turn.slot_id, doc: turn.doc, turn_id: turn.id,
    citations: [{ file_path: "src/app.go", line_start: 12, line_end: 13, citation_verified: i === 0 }],
  });
  round.turns.slice(0, 2).forEach((turn, i) => {
    turn.status = "done";
    turn.positions = [position(turn, i)];
    turn.body = i === 0 && round.number === 1 ? longBody : turn.positions[0].quote;
  });
  round.summary_doc = `${dir}/03-共识与分歧.md`;
  const positions = round.turns.slice(0, 2).map(position);
  round.items = [
    { id: "D1", title: "兼容性如何处理", aligned: false, stalled, positions },
    { id: "D2", title: "回归范围", aligned: false, stalled, positions },
  ];
  detail.run.status = "waiting_user";
  detail.run.current_step = "alignment";
  detail.docs.push(...round.turns.map((turn) => turn.doc), round.summary_doc);
}

test("开大会群聊与附件点名、多议题逐项裁决并实现、单议题选定方案并结束", async (t) => {
  const dist = process.env.IDEA_COLLAB_DIST || await mkdtemp(path.join(tmpdir(), "idea-meeting-dist-"));
  if (!process.env.IDEA_COLLAB_DIST) {
    t.after(() => rm(dist, { recursive: true, force: true }));
    await build({ root: fileURLToPath(new URL("../", import.meta.url)), logLevel: "silent", build: { outDir: dist } });
  }
  const screenshotDir = process.env.COLLAB_SCREENSHOT_DIR;
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: "zh-CN", colorScheme: "light", viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => { localStorage.setItem("mindfs-appearance-mode", "light"); });
  let socket;
  let detail;
  let quick;
  let revision = 12;
  const submitted = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.routeWebSocket(/\/ws(?:\?|$)/, (ws) => { socket = ws; });
  const emit = (type, payload) => socket?.send(JSON.stringify({ type, payload }));
  const update = () => {
    detail.run.updated_at = at(revision++);
    emit("collab.run.updated", { root_id: rootId, run: detail.run, waiting_count: Number(detail.run.status === "waiting_user") });
  };
  let groupTemplate = {
    id: "group-template", name: "会议模板", mode: "group", is_default: false, max_rounds: 2,
    final_author_slot_id: "member-2", all_available: true, availability: [],
    members: [members[0], { ...members[1], permission_mode: "agent-default" }],
  };
  const quickTemplate = {
    id: "quick-template", name: "受限实现模板", mode: "quick", is_default: false, all_available: true, availability: [],
    members: [{ ...members[0], role: "primary", permission_mode: "read-only" }, { ...members[1], role: "reviewer" }],
  };
  const agents = members.map(({ agent, model }) => ({
    name: agent, models: [{ id: model, name: model }], default_model_id: model, installed: true, available: true,
  }));

  await page.route("https://meeting.test/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname.replace(/^\/n\/[^/]+(?:\/p\/[^/]+)?/, "") || "/";
    const json = (value, status = 200) => route.fulfill({ status, json: value });
    if (pathname === "/api/dirs") return json([{ id: rootId, display_name: "演示项目", root_path: "/workspace/demo" }]);
    if (pathname === "/api/dir") return json({ entries: [] });
    if (pathname === "/api/relay/status") return json({ remote_host: false, e2ee_required: false });
    if (pathname === "/api/agents") return json({ agents, shells: [] });
    if (pathname === `/api/collab/templates/${groupTemplate.id}` && request.method() === "PUT") {
      const body = request.postDataJSON();
      assert.equal(body.max_rounds, 2);
      assert.equal(body.final_author_slot_id, "member-2");
      groupTemplate = { ...groupTemplate, ...body };
      return json(groupTemplate);
    }
    if (pathname === "/api/collab/templates") {
      return json({ items: [url.searchParams.get("mode") === "group" ? groupTemplate : quickTemplate], skills: [] });
    }
    if (pathname === "/api/collab/runs" && request.method() === "POST") {
      const body = request.postDataJSON();
      assert.equal(body.mode, "group");
      assert.equal(body.max_rounds, 2);
      assert.equal(body.final_author_slot_id, "member-2");
      assert.equal(body.members[0].permission_mode || "", "");
      assert.equal(body.members[1].permission_mode, "agent-default");
      detail = {
        run: { id: runId, root_id: rootId, mode: "group", title: body.task_prompt, task_prompt: body.task_prompt,
          snapshot: { mode: "group", topic_mode: body.topic_mode, members: body.members, final_author_slot_id: body.final_author_slot_id, max_rounds: 2 }, status: "running", current_step: "proposal",
          round: 1, steps: [], created_at: at(1), updated_at: at(2) },
        meeting: { rounds: [newRound(1, "running")] }, docs: ["00-会议议题.md"], review_items: [],
      };
      return json(detail, 201);
    }
    if (pathname === "/api/collab/runs") return json({ items: detail ? [detail.run] : [], waiting_count: 0 });
    if (pathname === `/api/collab/runs/${runId}`) return json(detail);
    if (pathname === `/api/collab/runs/${quickId}`) return json(quick);
    if (pathname === `/api/collab/runs/${runId}/meeting`) {
      const action = request.postDataJSON();
      submitted.push(action);
      const round = detail.meeting.rounds.at(-1);
      switch (action.action) {
        case "retry_turn":
          assert.equal(action.turn_id, round.turns[0].id);
          assert.equal(action.attempt, round.turns[0].at);
          return json({ ...detail, progress_action: "running" });
        case "message": {
          if (detail.run.current_step === "ready") {
            const seq = round.turns.length + 1;
            const note = `第0${round.number}轮/04-作者补充.md`;
            const reply = `第0${round.number}轮/04-补充答复/成员2-02.md`;
            round.turns.push(
              { id: `m-0${round.number}-00${seq}`, kind: "author", status: "done", at: at(40 + seq), body: action.text, doc: note, mentions: ["member-2"] },
              { id: `m-0${round.number}-00${seq + 1}`, kind: "answer", slot_id: "member-2", status: "done", at: at(41 + seq), body: "计划追问答复。", doc: reply, session_key: `${runId}-answer-${seq}` },
            );
            detail.docs.push(note, reply);
            break;
          }
          assert.match(action.text, /@成员2 .*补充/);
          assert.match(action.text, /\.mindfs\/attachments\/notes\.txt/);
          const note = "第01轮/04-作者补充.md";
          const reply = "第01轮/04-补充答复/成员2.md";
          round.turns.push({ id: "m-01-005", kind: "author", status: "done", at: at(10), body: action.text, doc: note, mentions: ["member-2"] },
            { id: "m-01-006", kind: "answer", slot_id: "member-2", status: "done", at: at(11), body: "现场点名答复。", doc: reply });
          detail.docs.push(note, reply);
          break;
        }
        case "next":
          detail.run.round = 2;
          detail.meeting.rounds.push(newRound(2, "running"));
          finishRound(detail, true);
          const followup = detail.meeting.rounds.at(-1);
          followup.items[0].positions[0].issue = "本轮重述未通过校验（引文与正文不匹配），沿用上一轮有效立场";
          followup.turns[1].position_issue = '未识别的条目编号："D01"';
          const item = followup.items[1];
          item.proposal = { ...item.positions[1], version_id: "D2-v2", quote: "成员2修订方案", stance: "propose" };
          item.positions = item.positions.map((position) => ({ ...position, version_id: "D2-v2" }));
          break;
        case "plan":
          if (action.override_all) {
            assert.ok(action.text && action.text.trim().length > 0);
            round.author_override = action.text;
            round.decisions = [];
            detail.run.current_step = "ready";
            round.turns.push(
              { id: `m-0${round.number}-005`, kind: "plan", slot_id: "member-2", status: "done", at: at(30), doc: "05-正式计划.md" },
            );
            detail.docs.push("05-正式计划.md", `第0${round.number}轮/作者裁决.md`);
            break;
          }
          if (detail.run.snapshot.topic_mode === "single") {
            detail.run.current_step = "ready";
            round.turns.push(
              { id: "m-01-005", kind: "plan", slot_id: "member-2", status: "done", at: at(30), doc: "05-正式计划.md" },
            );
            detail.docs.push("05-正式计划.md");
            break;
          }
          assert.deepEqual(action.decisions.map((value) => value.choice), ["custom", "adopt"]);
          assert.equal(action.decisions[1].version_id, "D2-v2");
          assert.equal(action.decisions[0].note, "读取已有库再验证");
          detail.run.current_step = "ready";
          round.turns.push(
            { id: "m-02-003", kind: "plan", slot_id: "member-2", status: "done", at: at(30), doc: "05-正式计划.md" },
            { id: "m-02-004", kind: "confirmation", slot_id: "member-1", status: "done", at: at(31), doc: "第02轮/05-计划核对/成员1.md", plan_id: "m-02-003", confirmed: false },
          );
          detail.docs.push("05-正式计划.md", "第02轮/作者裁决.md");
          break;
        case "revise_plan":
          assert.equal(action.plan_id, "m-02-003");
          assert.equal(action.text, "处理首稿异议");
          round.turns.push(
            { id: "m-02-005", kind: "plan", slot_id: "member-2", status: "done", at: at(32), doc: revisedPlan },
            { id: "m-02-006", kind: "confirmation", slot_id: "member-1", status: "done", at: at(33), doc: "第02轮/05-计划核对/m-02-005-成员1.md", plan_id: "m-02-005", confirmed: true },
          );
          detail.docs.push(revisedPlan);
          break;
        case "finish":
          detail.run.status = "completed";
          break;
        case "implement":
          assert.equal(action.plan_id, "m-02-005");
          assert.equal(action.quick_template_id, quickTemplate.id);
          detail.run.status = "completed";
          detail.run.quick_run_id = detail.meeting.quick_run_id = quickId;
          detail.run.quick_run_status = "running";
          quick = {
            run: { ...detail.run, id: quickId, mode: "quick", meeting_run_id: runId, quick_run_id: undefined,
              round: 1, status: "running", current_step: "impl", snapshot: { mode: "quick", members: [
                { ...members[0], role: "primary" }, { ...members[1], role: "reviewer" },
              ] }, steps: [
                ["impl", "主模型实现"], ["review", "只读审核"], ["response", "逐条回应"],
                ["decisions", "分歧裁决"], ["fix_test", "最终修改与测试"],
              ].map(([key, title], i) => ({ key, title, role: i === 0 ? "primary" : "reviewer", status: i === 0 ? "running" : "pending" })),
            }, docs: [], review_items: [],
          };
          break;
      }
      update();
      return json(detail);
    }
    if (pathname.startsWith(`/api/collab/runs/${runId}/docs/`)) {
      return json({ name: decodeURIComponent(pathname.split("/docs/")[1]), content: "# 交付文件预览\n\n可核对的 Markdown 正文" });
    }
    if (pathname === "/api/upload") return json({ files: [{ path: ".mindfs/attachments/notes.txt", name: "notes.txt", size: 3 }] });
    if (pathname.startsWith("/api/sessions/")) return json({
      key: decodeURIComponent(pathname.split("/")[3]), root_id: rootId, type: "chat", source: "collab_review",
      activity_history_version: 1, reply_metadata_version: 1,
      exchanges: [{ seq: 1, role: "assistant", content: "原生过程对话", timestamp: at(6) }],
    });
    if (pathname.startsWith("/api/")) return json({ items: [], tasks: [], agents: [], shells: [] });

    const file = pathname === "/" ? "index.html" : pathname.slice(1);
    const contentType = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml" }[path.extname(file)];
    const body = await readFile(path.join(dist, file));
    return route.fulfill({ contentType, body: file === "index.html" ?
      body.toString().replace("</head>", '<meta name="local-ai-agent-mode" content="standalone"></head>') : body });
  });

  await page.goto("https://meeting.test/");
  await page.locator(".remote-topbar .collab-entry-btn:visible").first().click();
  await page.getByRole("button", { name: "开大会", exact: true }).click();
  await page.getByRole("button", { name: "管理全局模板" }).click();
  await expect(page.getByText("成员2（主笔）", { exact: false })).toBeVisible();
  await expect(page.getByText("严格只读", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "设为默认" }).click();
  await expect(page.getByText("默认", { exact: true }).last()).toBeVisible();
  await page.locator(".collab-modal-head button").first().click();
  await expect(page.getByLabel("主笔")).toHaveValue("member-2");
  await expect(page.getByLabel("轮次上限")).toHaveValue("2");
  await expect(page.getByLabel("讨论方式")).toHaveValue("multi");
  await expect(page.getByLabel("成员1权限")).toHaveValue("");
  await page.getByLabel("成员2权限").selectOption("agent-default");
  await page.getByPlaceholder("输入会议议题", { exact: false }).fill("如何升级已有数据");
  await page.getByRole("button", { name: "开始会议", exact: true }).click();
  await expect(page.getByLabel("会议流程")).toBeVisible();
  assert.equal(detail.run.snapshot.topic_mode, "multi");

  const first = detail.meeting.rounds[0].turns[0];
  const message = page.locator("#meeting-m-01-001");
  const glow = () => message.evaluate((card) => {
    const style = getComputedStyle(card, "::before");
    return [style.content, style.animationName];
  });
  await expect(message).toHaveClass(/remote-glow-frame/);
  await expect(message).toHaveAttribute("data-glow-active", "");
  await expect.poll(glow).toEqual(["\"\"", "glow-breathe"]);
  await expect(message).toContainText("发言中");
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "meeting-running.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  const modelBar = page.getByRole("group", { name: "参会模型配置" });
  await expect(modelBar.getByRole("button", { name: /成员2 · Claude Code · claude-opus-4-6/ })).toContainText("Opus 4.6");
  await expect(modelBar).not.toContainText("沿用 Agent 配置");
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeInViewport({ ratio: 1 });
  if (screenshotDir) await page.locator(".meeting-pane").screenshot({ path: path.join(screenshotDir, "meeting-running-phone.png") });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("#meeting-m-01-001").getByRole("button", { name: "检查并重试" }).click();
  await expect(page.getByText("该成员仍在执行", { exact: true })).toBeVisible();
  await page.locator("#meeting-m-01-001 .collab-tc-select").click();
  await expect(page.locator(".collab-detail-pane").getByRole("img", { name: "发言中" })).toBeVisible();
  await expect(page.locator(".collab-detail-body")).not.toHaveClass(/remote-glow-frame/);
  await expect(page.locator(".collab-detail-footer .remote-status-activity.remote-glow-frame")).toHaveCount(1);
  finishRound(detail);
  first.readonly_state = "modified";
  update();
  await expect(page.locator(".collab-detail-pane").getByRole("img", { name: "已交付" })).toBeVisible();
  await expect(message).not.toHaveAttribute("data-glow-active");
  await expect(message).toContainText("已交付");
  await expect(message.getByText("检测到工作区变更")).toBeVisible();
  await expect(message.getByRole("button", { name: /展开全文|收起全文/ })).toHaveCount(0);
  await expect(message.getByText("这段尾部正文仍完整保留。")).toHaveCount(0);
  await expect(message.getByRole("button", { name: "草案", exact: true })).toHaveCount(0);
  await expect(message.getByRole("button", { name: "src/app.go:12–13" })).toHaveCount(0);
  const summaryToggle = page.locator(".meeting-summary-toggle").first();
  await expect(summaryToggle).toHaveAttribute("aria-expanded", "true");
  await summaryToggle.click();
  await expect(summaryToggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".meeting-summary .meeting-item")).toHaveCount(0);
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "desktop-summary-collapsed.png") });
  await summaryToggle.click();
  await expect(summaryToggle).toHaveAttribute("aria-expanded", "true");
  const firstItem = page.locator(".meeting-summary .meeting-item").first();
  await firstItem.locator("summary").click();
  await expect(firstItem.getByRole("button", { name: "src/app.go:12–13" }).first()).toBeVisible();
  await firstItem.getByRole("button", { name: "看交付文件" }).first().click();
  const docModal = page.locator(".collab-modal--doc");
  await expect(docModal.getByRole("heading", { name: "交付文件预览", exact: true })).toBeVisible();
  await expect(docModal.getByText("可核对的 Markdown 正文")).toBeVisible();
  await expect(docModal.getByRole("button", { name: "预览", exact: true })).toHaveAttribute("aria-pressed", "true");
  await docModal.getByRole("button", { name: "源码", exact: true }).click();
  await expect(docModal.locator("code")).toContainText("# 交付文件预览");
  await docModal.getByRole("button", { name: "预览", exact: true }).click();
  await expect(docModal.getByRole("heading", { name: "交付文件预览", exact: true })).toBeVisible();
  await page.locator(".collab-modal-head button").click();

  const composer = page.getByRole("textbox", { name: "会议补充" });
  await composer.fill("@");
  await page.getByLabel("点名成员").getByRole("button", { name: "成员2 · Opus 4.6" }).click();
  await expect(composer).toHaveValue("@成员2 ");
  await composer.fill("@成员2 请补充");
  await page.getByLabel("会议附件").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("note") });
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator("#meeting-m-01-006")).toContainText("成员2 · Opus 4.6");
  await expect(page.locator("#meeting-m-01-006")).toContainText("已交付");

  await expect(page.locator(".collab-shell")).toHaveCSS("background-color", "rgb(241, 242, 245)");
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "desktop-light.png") });
  const discussRemaining = page.getByRole("button", { name: "只讨论剩余分歧", exact: true });
  const firstItems = detail.meeting.rounds[0].items;
  detail.meeting.rounds[0].items = firstItems.map((item) => ({ ...item, aligned: true }));
  update();
  await expect(page.getByRole("button", { name: "生成正式计划", exact: true })).toBeVisible();
  await expect(discussRemaining).toHaveCount(0);
  await expect(page.getByRole("button", { name: "再讨论一轮", exact: true })).toHaveCount(0);
  detail.meeting.rounds[0].items = firstItems;
  update();
  await discussRemaining.click();
  await expect(page.getByRole("button", { name: /第 1 轮.*份提案/ })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: /第 2 轮.*轮流讨论/ })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("还有 2 项分歧未对齐，请你裁决")).toBeVisible();
  await expect(page.locator("#meeting-m-02-002")).toContainText('未识别的条目编号："D01"');
  await page.locator(".meeting-summary .meeting-item summary").first().click();
  await expect(firstItem.getByText("本轮重述未通过校验（引文与正文不匹配），沿用上一轮有效立场")).toBeVisible();
  await page.getByRole("button", { name: "看对话", exact: true }).first().click();
  await expect(page.locator("#meeting-m-02-001")).toBeFocused();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.locator("html").evaluate((root) => root.setAttribute("data-theme", "dark"));
  await expect(page.locator(".collab-shell")).toHaveCSS("background-color", "rgb(13, 15, 19)");
  await page.locator("#meeting-m-02-001 .collab-tc-select").click();
  await expect(page.locator(".collab-detail-pane").getByText("原生过程对话")).toBeVisible();
  await expect(page.locator('.collab-detail-pane [data-onboarding="action-bar"]').getByRole("textbox")).toBeVisible();
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "desktop-dark.png") });

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = () => page.evaluate(() => {
    const shell = document.querySelector(".collab-shell");
    return [document.documentElement.scrollWidth - window.innerWidth, shell.scrollWidth - shell.clientWidth];
  });
  await expect.poll(overflow).toEqual([0, 0]);
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "phone.png") });
  await page.getByRole("button", { name: "裁决", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "逐条裁决" });
  const generate = dialog.getByRole("button", { name: "生成正式计划" });
  const expand = dialog.getByRole("button", { name: "展开原文、理由和出处" });
  await expand.first().click();
  await expect(dialog.getByRole("button", { name: "src/app.go:12–13" })).toBeVisible();
  await expand.first().click();
  await expect(dialog.getByText("出处无效 · src/app.go:12–13", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "下一条" })).toBeDisabled();
  await dialog.getByRole("radio", { name: "都不采纳，我来写" }).click();
  await dialog.getByLabel("D1 裁决说明").fill("读取已有库再验证");
  await dialog.getByRole("button", { name: "关闭裁决" }).click();
  await page.getByRole("button", { name: "裁决", exact: true }).click();
  await dialog.getByRole("button", { name: "上一条" }).click();
  await expect(dialog.getByLabel("D1 裁决说明")).toHaveValue("读取已有库再验证");
  await dialog.getByRole("button", { name: "下一条" }).click();
  await dialog.getByRole("radio", { name: /成员2修订方案/ }).click();
  await expect(dialog.getByRole("radio", { name: /成员2修订方案/ })).toBeChecked();
  await expect(generate).toBeEnabled();
  await expect.poll(overflow).toEqual([0, 0]);
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "phone-decisions.png") });
  await page.setViewportSize({ width: 320, height: 700 });
  await expect.poll(overflow).toEqual([0, 0]);
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "phone-320-decisions.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await generate.click();
  await expect(page.getByText("实现权限 沿用 Agent 配置", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "按当前稿开始实现" })).toBeDisabled();
  await page.getByLabel("正式计划有异议，请填写处理理由").fill("处理首稿异议");
  await page.getByRole("button", { name: "退回主笔修订" }).click();
  await page.getByLabel("实现模板").selectOption(quickTemplate.id);
  await expect(page.getByText("实现权限 只读", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认并开始实现" }).click();
  await expect(page.getByRole("button", { name: /会议.*正式计划已确认/ })).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".meeting-compact-line button")).toHaveCount(1);
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "phone-compact-meeting.png") });
  await expect(page.locator(".collab-card")).toHaveCount(5);
  await page.getByRole("button", { name: "运行列表" }).click();
  await expect(page.locator(".collab-run-item")).toHaveCount(1);
  await expect(page.getByText("大会 → 快速")).toBeVisible();
  assert.deepEqual(submitted.map(({ action }) => action), ["retry_turn", "message", "next", "plan", "revise_plan", "implement"]);

  detail = quick = undefined;
  submitted.length = 0;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("https://meeting.test/");
  await page.locator(".remote-topbar .collab-entry-btn:visible").first().click();
  await page.getByRole("button", { name: "开大会", exact: true }).click();
  await page.getByRole("button", { name: "管理全局模板" }).click();
  const templateEditor = page.locator(".collab-modal");
  await templateEditor.getByRole("button", { name: "编辑", exact: true }).click();
  await templateEditor.getByLabel("讨论方式").selectOption("single");
  await templateEditor.getByRole("button", { name: "保存模板", exact: true }).click();
  await expect(templateEditor.getByRole("button", { name: "保存模板", exact: true })).toHaveCount(0);
  assert.equal(groupTemplate.topic_mode, "single");
  await templateEditor.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page.getByLabel("讨论方式")).toHaveValue("single");
  const topic = "为什么会重复发送消息？";
  await page.getByPlaceholder("输入会议议题", { exact: false }).fill(topic);
  await page.getByRole("button", { name: "开始会议", exact: true }).click();
  await expect(page.getByLabel("当前轮次")).toContainText("单议题");
  assert.equal(detail.run.snapshot.topic_mode, "single");
  finishRound(detail);
  const round = detail.meeting.rounds[0];
  const candidates = round.turns.map((turn, i) => ({
    id: "D1", title: ["按钮重复触发", "请求重试"][i], quote: ["检查事件绑定次数", "检查重试记录"][i],
    slot_id: turn.slot_id, turn_id: turn.id, doc: turn.doc, version_id: `S${i + 1}-${turn.id}`, stance: "propose",
  }));
  round.items = [{ id: "D1", title: topic, aligned: false, candidates,
    positions: candidates.map(({ id, slot_id, version_id }) => ({ id, slot_id, version_id, stance: "agree", source: "author" })) }];
  update();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".meeting-summary .meeting-item")).toHaveCount(1);
  await expect(page.getByText("尚未就方案达成一致")).toBeVisible();
  await page.getByRole("button", { name: "选择方案", exact: true }).click();
  const choose = page.getByRole("dialog", { name: "选择方案" });
  const createPlan = choose.getByRole("button", { name: "生成正式计划" });
  await expect(createPlan).toBeDisabled();
  await expect(choose.getByRole("radio", { name: /^采纳/ })).toHaveCount(2);
  await expect(choose.getByRole("button", { name: "下一条" })).toHaveCount(0);
  await choose.getByRole("radio", { name: /采纳 方案 2 · 请求重试/ }).click();
  await expect.poll(overflow).toEqual([0, 0]);
  await createPlan.click();
  const readyComposer = page.getByRole("textbox", { name: "会议补充" });
  await expect(readyComposer).toBeVisible();
  await readyComposer.fill("为什么批量场景也会触发重试？");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("为什么批量场景也会触发重试？")).toBeVisible();
  await page.getByRole("button", { name: "只要方案，结束会议" }).click();
  await expect(page.getByRole("button", { name: "查看正式计划" })).toBeVisible();
  await expect(page.getByText(/会议已结束，没有进入实现/)).toBeVisible();
  await expect(readyComposer).toBeVisible();
  assert.deepEqual(submitted.map(({ action }) => action), ["plan", "message", "finish"]);
  assert.deepEqual(submitted[0].decisions, [{ item_id: "D1", choice: "adopt", slot_id: "member-2",
    turn_id: candidates[1].turn_id, version_id: candidates[1].version_id }]);

  // 4+ 条共识与分歧默认折叠，且支持一键否决全部议题按作者方向生成正式计划
  detail = quick = undefined;
  submitted.length = 0;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("https://meeting.test/");
  await page.locator(".remote-topbar .collab-entry-btn:visible").first().click();
  await page.getByRole("button", { name: "开大会", exact: true }).click();
  await page.getByLabel("讨论方式").selectOption("multi");
  await page.getByPlaceholder("输入会议议题", { exact: false }).fill("多条目折叠与一键否决验证");
  await page.getByRole("button", { name: "开始会议", exact: true }).click();
  finishRound(detail);
  const overrideRound = detail.meeting.rounds[0];
  const basePositions = overrideRound.items[0].positions;
  overrideRound.items = [
    { id: "D1", title: "缓存淘汰策略", aligned: true, positions: basePositions },
    { id: "D2", title: "分片键选择", aligned: true, positions: basePositions },
    { id: "D3", title: "重试退避上限", aligned: false, positions: basePositions },
    { id: "D4", title: "灰度开关位置", aligned: false, positions: basePositions },
  ];
  update();
  const autoCollapsedToggle = page.locator(".meeting-summary-toggle").first();
  await expect(autoCollapsedToggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".meeting-summary .meeting-item")).toHaveCount(0);
  await autoCollapsedToggle.click();
  await expect(autoCollapsedToggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".meeting-summary .meeting-item")).toHaveCount(4);
  await page.getByRole("button", { name: "否决全部，按我方向", exact: true }).click();
  const overrideDialog = page.getByRole("dialog", { name: "否决全部议题" });
  const overrideSubmit = overrideDialog.getByRole("button", { name: "按我的方向生成正式计划" });
  await expect(overrideSubmit).toBeDisabled();
  const direction = "全部否决，直接按方案 C 重写接口并保留兼容层";
  await overrideDialog.getByLabel("作者修改方向").fill(direction);
  await expect(overrideSubmit).toBeEnabled();
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "desktop-override-modal.png") });
  await overrideSubmit.click();
  await expect(page.getByRole("button", { name: "作者裁决", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "确认并开始实现" })).toBeVisible();
  assert.deepEqual(submitted, [{ action: "plan", round: 1, override_all: true, text: direction }]);
  assert.deepEqual(errors, []);
});
