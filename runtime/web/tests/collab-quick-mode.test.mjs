import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "vite";
import { chromium, expect } from "@playwright/test";

test("Collab Quick Mode shell, global templates, dispute decisions, reused conversation, and 3-device layouts", async (t) => {
  const outDir =
    process.env.IDEA_COLLAB_DIST ||
    (await mkdtemp(path.join(os.tmpdir(), "idea-collab-dist-")));
  if (!process.env.IDEA_COLLAB_DIST) {
    t.after(() => rm(outDir, { recursive: true, force: true }));
    await build({
      root: fileURLToPath(new URL("../", import.meta.url)),
      logLevel: "silent",
      build: { outDir, emptyOutDir: true },
    });
  }

  const screenshotDir = process.env.COLLAB_SCREENSHOT_DIR || "";
  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1440, height: 900 } });
  let runSocket;
  await page.routeWebSocket(/\/ws(?:\?|$)/, (socket) => {
    runSocket = socket;
  });

  const errors = [];
  const submittedPayloads = [];
  const cleanedPayloads = [];
  const startedPayloads = [];
  const savedTemplatePayloads = [];
  const sessionFetchLog = [];
  let uploadCallCount = 0;
  let holdUploadPromise = null;
  let releaseUpload = null;
  let holdStartRunPromise = null;
  let releaseStartRun = null;
  let holdDocPromise = null;
  let releaseDoc = null;
  let holdPausePromise = null;
  let releasePause = null;
  let holdProj2RunsPromise = null;
  let releaseProj2Runs = null;
  let holdProgressDetail = null;
  const progressRequests = [];
  page.on("pageerror", (err) => errors.push(err.message));

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
      default_model_id: "claude-opus-4-6",
      current_model_id: "claude-opus-4-6",
      default_effort: "high",
      efforts: ["medium", "high"],
      models: [
        { id: "claude-opus-4-6", name: "claude-opus-4-6", supportEffort: true, efforts: ["medium", "high"] },
      ],
      modes: [
        { id: "default", name: "default" },
        { id: "acceptEdits", name: "acceptEdits" },
      ],
    },
  ];

  const templates = [
    {
      id: "tpl-default",
      name: "Codex 主写 + Claude 严审",
      mode: "quick",
      is_default: true,
      members: [
        { slot_id: "primary", role: "primary", agent: "codex", model: "gpt-5.3-codex", effort: "high" },
        { slot_id: "reviewer", role: "reviewer", agent: "claude", model: "claude-opus-4-6", effort: "high" },
      ],
      skill_paths: ["/skills/code-simplifier/SKILL.md", "/skills/removed-stale/SKILL.md"],
      all_available: true,
      availability: [
        { slot_id: "primary", role: "primary", agent: "codex", model: "gpt-5.3-codex", available: true },
        { slot_id: "reviewer", role: "reviewer", agent: "claude", model: "claude-opus-4-6", available: true },
      ],
      created_at: "2026-11-25T08:00:00Z",
      updated_at: "2026-11-25T08:00:00Z",
    },
    {
      id: "tpl-broken",
      name: "已下线模型模板",
      mode: "quick",
      is_default: false,
      members: [
        { slot_id: "primary", role: "primary", agent: "codex", model: "gpt-5.3-codex", effort: "high" },
        { slot_id: "reviewer", role: "reviewer", agent: "claude", model: "claude-removed-99", effort: "high" },
      ],
      skill_paths: [],
      all_available: false,
      availability: [
        { slot_id: "primary", role: "primary", agent: "codex", model: "gpt-5.3-codex", available: true },
        {
          slot_id: "reviewer",
          role: "reviewer",
          agent: "claude",
          model: "claude-removed-99",
          available: false,
          reason: "模型 claude-removed-99 不在 claude 当前可用列表中，请手动选择替代模型",
        },
      ],
      created_at: "2026-11-25T08:01:00Z",
      updated_at: "2026-11-25T08:01:00Z",
    },
    {
      id: "tpl-default-empty-effort",
      name: "默认模型且未指定思考强度",
      mode: "quick",
      is_default: false,
      members: [
        { slot_id: "primary", role: "primary", agent: "codex", model: "", effort: "" },
        { slot_id: "reviewer", role: "reviewer", agent: "claude", model: "", effort: "" },
      ],
      skill_paths: [],
      all_available: true,
      availability: [
        { slot_id: "primary", role: "primary", agent: "codex", model: "", available: true },
        { slot_id: "reviewer", role: "reviewer", agent: "claude", model: "", available: true },
      ],
      created_at: "2026-11-25T08:02:00Z",
      updated_at: "2026-11-25T08:02:00Z",
    },
  ];

  const runsById = new Map([
    [
      "run-wait",
      {
        run: {
          id: "run-wait",
          root_id: "proj-1",
          mode: "quick",
          title: "重构流式控制块过滤器并补齐边界单测",
          task_prompt: "重构流式控制块过滤器并补齐边界单测",
          template_id: "tpl-default",
          template_name: "Codex 主写 + Claude 严审",
          snapshot: {
            template_id: "tpl-default",
            template_name: "Codex 主写 + Claude 严审",
            mode: "quick",
            members: templates[0].members,
            skill_paths: templates[0].skill_paths,
          },
          status: "waiting_user",
          current_step: "decisions",
          readonly_check_state: "clean",
          steps: [
            {
              key: "impl",
              title: "主模型实现",
              role: "primary",
              agent: "codex",
              model: "gpt-5.3-codex",
              effort: "high",
              session_key: "collab-run-wait-impl",
              doc_path: ".mindfs/runs/run-wait/01-impl.md",
              status: "done",
              summary: "已完成流式行缓冲状态机与 4 反引号嵌套用例（2 个文件变更）",
            },
            {
              key: "review",
              title: "独立只读审核",
              role: "reviewer",
              agent: "claude",
              model: "claude-opus-4-6",
              effort: "high",
              read_only: true,
              session_key: "collab-run-wait-review",
              doc_path: ".mindfs/runs/run-wait/02-review.md",
              status: "done",
              summary: "提出 3 条审核意见（功能 2 · 规范 1），工作区只读核对无改动",
            },
            {
              key: "response",
              title: "主模型逐条回应",
              role: "primary",
              agent: "codex",
              model: "gpt-5.3-codex",
              effort: "high",
              session_key: "collab-run-wait-impl",
              doc_path: ".mindfs/runs/run-wait/03-response.md",
              status: "done",
              summary: "接受 1 条，2 条分歧（含 1 条空说明兜底）转交作者裁决",
            },
            {
              key: "decisions",
              title: "分歧拍板",
              role: "author",
              doc_path: ".mindfs/runs/run-wait/04-decisions.md",
              status: "waiting_user",
              summary: "共 2 条分歧待你裁决（未预选默认项）",
            },
            {
              key: "fix_test",
              title: "修改与测试报告",
              role: "primary",
              agent: "codex",
              model: "gpt-5.3-codex",
              effort: "high",
              session_key: "collab-run-wait-impl",
              doc_path: ".mindfs/runs/run-wait/05-report.md",
              status: "pending",
            },
          ],
          created_at: "2026-11-25T08:10:00Z",
          updated_at: "2026-11-25T08:15:00Z",
        },
        review_items: [
          {
            item_id: "R1",
            ordinal: 1,
            dimension: "functional",
            severity: "high",
            file_path: "runtime/server/internal/collab/control_filter.go",
            line_start: 42,
            citation_verified: true,
            title: "未闭合控制块在流结束时不应泄漏",
            description: "当流在 ```mindfs-control 内部意外中断时，Flush 不得把半截 JSON 推给前端。",
            primary_status: "accepted",
            primary_note: "同意，在 Flush 中丢弃未闭合的隐藏控制块缓冲区并补单测。",
          },
          {
            item_id: "R2",
            ordinal: 2,
            dimension: "standard",
            severity: "medium",
            file_path: "runtime/server/internal/collab/control_filter.go",
            line_start: 88,
            citation_verified: true,
            rule_ref: "~/.codex/AGENTS.md · 避免过度工程化",
            title: "无需为单线程流过滤器引入读写锁",
            description: "单个流式 turn 串行回调 Write/Flush，额外 sync.RWMutex 属于冗余防御。",
            primary_status: "disputed",
            primary_note: "考虑到未来可能并发调用保留了锁，请作者拍板是否移除。",
          },
          {
            item_id: "R3",
            ordinal: 3,
            dimension: "functional",
            severity: "low",
            file_path: "runtime/server/internal/collab/nonexistent.go",
            line_start: 999,
            citation_verified: false,
            citation_note: "文件不存在",
            title: "建议拆分独立 buffer 池",
            description: "可引入全局 sync.Pool 复用切片。",
            primary_status: "disputed",
            parse_fallback: true,
            primary_note: "主模型对 accepted 未提供修改说明，系统按分歧转交作者拍板。",
          },
        ],
        docs: ["01-impl.md", "02-review.md", "03-response.md"],
      },
    ],
    [
      "run-wait-b",
      {
        run: {
          id: "run-wait-b",
          root_id: "proj-1",
          mode: "quick",
          title: "第二条独立待裁决任务",
          task_prompt: "第二条独立待裁决任务",
          template_id: "tpl-default",
          template_name: "Codex 主写 + Claude 严审",
          snapshot: {
            template_id: "tpl-default",
            template_name: "Codex 主写 + Claude 严审",
            mode: "quick",
            members: templates[0].members,
            skill_paths: templates[0].skill_paths,
          },
          status: "waiting_user",
          current_step: "decisions",
          readonly_check_state: "modified",
          readonly_check_note: "只读审核期间工作区有改动",
          steps: [
            {
              key: "impl",
              title: "主模型实现",
              role: "primary",
              agent: "codex",
              model: "gpt-5.3-codex",
              session_key: "collab-run-wait-impl",
              status: "done",
              summary: "已完成",
            },
            {
              key: "review",
              title: "独立只读审核",
              role: "reviewer",
              agent: "claude",
              model: "claude-opus-4-6",
              read_only: true,
              session_key: "collab-run-wait-review",
              status: "done",
              summary: "提出 2 条分歧",
            },
            {
              key: "response",
              title: "主模型逐条回应",
              role: "primary",
              agent: "codex",
              model: "gpt-5.3-codex",
              session_key: "collab-run-wait-impl",
              status: "done",
              summary: "2 条分歧待拍板",
            },
            {
              key: "decisions",
              title: "分歧拍板",
              role: "author",
              status: "waiting_user",
              summary: "2 条分歧待你裁决",
            },
            {
              key: "fix_test",
              title: "修改与测试报告",
              role: "primary",
              status: "pending",
            },
          ],
          created_at: "2026-11-25T08:05:00Z",
          updated_at: "2026-11-25T08:06:00Z",
        },
        review_items: [
          {
            item_id: "R2",
            ordinal: 1,
            dimension: "functional",
            severity: "medium",
            file_path: "runtime/server/app/server.go",
            line_start: 20,
            citation_verified: true,
            title: "运行 B 的 R2 条目",
            description: "不应继承运行 A 对 R2 的选择。",
            primary_status: "disputed",
            primary_note: "请作者独立裁决运行 B 的 R2。",
          },
          {
            item_id: "R3",
            ordinal: 2,
            dimension: "functional",
            severity: "low",
            file_path: "runtime/server/app/server.go",
            line_start: 35,
            citation_verified: true,
            title: "运行 B 的 R3 条目",
            description: "不应继承运行 A 对 R3 的自定义指示。",
            primary_status: "disputed",
            primary_note: "请作者独立裁决运行 B 的 R3。",
          },
        ],
        docs: ["01-impl.md", "02-review.md", "03-response.md"],
      },
    ],
    [
      "run-default-model",
      {
        run: {
          id: "run-default-model",
          root_id: "proj-1",
          mode: "quick",
          title: "附件：截图[1].png",
          task_prompt: "[file: .mindfs/attachments/截图[1].png]",
          template_id: "tpl-default-empty-effort",
          template_name: "默认模型且未指定思考强度",
          snapshot: {
            template_id: "tpl-default-empty-effort",
            template_name: "默认模型且未指定思考强度",
            mode: "quick",
            members: [
              { slot_id: "primary", role: "primary", agent: "codex", model: "", effort: "high" },
              { slot_id: "reviewer", role: "reviewer", agent: "claude", model: "", effort: "high" },
            ],
            skill_paths: [],
          },
          status: "completed",
          current_step: "done",
          test_status: "passed",
          steps: [
            {
              key: "impl",
              title: "主模型实现",
              role: "primary",
              agent: "codex",
              model: "",
              effort: "high",
              session_key: "collab-run-default-impl",
              doc_path: ".mindfs/runs/run-default-model/01-impl.md",
              status: "done",
              summary: "已完成",
            },
            {
              key: "review",
              title: "独立只读审核",
              role: "reviewer",
              agent: "claude",
              model: "",
              effort: "high",
              read_only: true,
              session_key: "collab-run-wait-review",
              status: "done",
              summary: "无问题",
            },
            { key: "response", title: "主模型逐条回应", role: "primary", status: "skipped" },
            { key: "decisions", title: "分歧拍板", role: "author", status: "skipped" },
            {
              key: "fix_test",
              title: "修改与测试报告",
              role: "primary",
              agent: "codex",
              model: "",
              effort: "high",
              session_key: "collab-run-default-impl",
              status: "done",
              summary: "测试通过",
            },
          ],
          created_at: "2026-11-25T07:50:00Z",
          updated_at: "2026-11-25T07:55:00Z",
        },
        review_items: [],
        docs: ["01-impl.md"],
      },
    ],
    [
      "run-proj2-check",
      {
        run: {
          id: "run-proj2-check",
          root_id: "proj-2",
          mode: "quick",
          title: "补齐账单对账幂等校验",
          task_prompt: "补齐账单对账幂等校验",
          template_id: "tpl-default",
          template_name: "Codex 主写 + Claude 严审",
          snapshot: {
            template_id: "tpl-default",
            template_name: "Codex 主写 + Claude 严审",
            mode: "quick",
            members: templates[0].members,
            skill_paths: [],
          },
          status: "completed",
          current_step: "done",
          test_status: "passed",
          steps: [
            {
              key: "impl",
              title: "主模型实现",
              role: "primary",
              agent: "codex",
              model: "gpt-5.3-codex",
              effort: "high",
              session_key: "collab-run-proj2-impl",
              doc_path: ".mindfs/runs/run-proj2-check/01-impl.md",
              status: "done",
              summary: "已补齐账单幂等键校验",
            },
          ],
          created_at: "2026-11-25T07:40:00Z",
          updated_at: "2026-11-25T07:45:00Z",
        },
        review_items: [],
        docs: ["01-impl.md"],
      },
    ],
  ]);

  const sessionsByKey = {
    "single-chat-1": {
      activity_history_version: 1,
      reply_metadata_version: 1,
      key: "single-chat-1",
      session_key: "single-chat-1",
      root_id: "proj-1",
      name: "日常单聊会话",
      type: "chat",
      agent: "codex",
      model: "gpt-5.3-codex",
      created_at: "2026-11-25T08:00:00Z",
      updated_at: "2026-11-25T08:00:05Z",
      exchanges: [
        {
          seq: 1,
          role: "user",
          content: "单聊里的原始上下文不应被协作污染",
          timestamp: "2026-11-25T08:00:00Z",
        },
        {
          seq: 2,
          role: "assistant",
          agent: "codex",
          model: "gpt-5.3-codex",
          content: "收到，单聊会话保持完全独立。",
          timestamp: "2026-11-25T08:00:05Z",
        },
      ],
    },
    "collab-run-wait-impl": {
      activity_history_version: 1,
      reply_metadata_version: 1,
      key: "collab-run-wait-impl",
      session_key: "collab-run-wait-impl",
      root_id: "proj-1",
      name: "主模型实现 · 重构流式控制块过滤器",
      type: "chat",
      source: "collab_stage",
      agent: "codex",
      model: "gpt-5.3-codex",
      effort: "high",
      created_at: "2026-11-25T08:10:00Z",
      updated_at: "2026-11-25T08:12:00Z",
      exchanges: [
        {
          seq: 1,
          role: "user",
          content: "[系统阶段提示] 请完成实现并输出 .mindfs/runs/run-wait/01-impl.md",
          timestamp: "2026-11-25T08:10:00Z",
        },
        {
          seq: 2,
          role: "assistant",
          agent: "codex",
          model: "gpt-5.3-codex",
          content: "我已实现 `ControlBlockFilter` 并写入 `.mindfs/runs/run-wait/01-impl.md`，也回应了全部 3 条审核意见。",
          timestamp: "2026-11-25T08:12:00Z",
        },
      ],
    },
    "collab-run-wait-review": {
      activity_history_version: 1,
      reply_metadata_version: 1,
      key: "collab-run-wait-review",
      session_key: "collab-run-wait-review",
      root_id: "proj-1",
      name: "独立只读审核 · 重构流式控制块过滤器",
      type: "chat",
      source: "collab_review",
      agent: "claude",
      model: "claude-opus-4-6",
      effort: "high",
      created_at: "2026-11-25T08:13:00Z",
      updated_at: "2026-11-25T08:13:05Z",
      exchanges: [
        {
          seq: 1,
          role: "assistant",
          agent: "claude",
          model: "claude-opus-4-6",
          content: "已完成只读代码与全局编码准则对照审核，共提出 R1、R2、R3 三条意见。",
          timestamp: "2026-11-25T08:13:00Z",
        },
      ],
    },
    "collab-run-default-impl": {
      activity_history_version: 1,
      reply_metadata_version: 1,
      key: "collab-run-default-impl",
      session_key: "collab-run-default-impl",
      root_id: "proj-1",
      name: "主模型实现 · 附件：截图[1].png",
      type: "chat",
      source: "collab_stage",
      agent: "codex",
      model: "",
      effort: "high",
      created_at: "2026-11-25T07:50:00Z",
      updated_at: "2026-11-25T07:55:00Z",
      exchanges: [
        {
          seq: 1,
          role: "user",
          content: "## 作者任务\n[file: .mindfs/attachments/截图[1].png]",
          timestamp: "2026-11-25T07:50:00Z",
        },
        {
          seq: 2,
          role: "assistant",
          agent: "codex",
          model: "",
          content: "已查看附件截图并完成处理。",
          timestamp: "2026-11-25T07:55:00Z",
        },
      ],
    },
    "single-chat-proj2": {
      activity_history_version: 1,
      reply_metadata_version: 1,
      key: "single-chat-proj2",
      session_key: "single-chat-proj2",
      root_id: "proj-2",
      name: "账单服务日常单聊",
      type: "chat",
      agent: "codex",
      model: "gpt-5.3-codex",
      created_at: "2026-11-25T07:30:00Z",
      updated_at: "2026-11-25T07:31:00Z",
      exchanges: [
        {
          seq: 1,
          role: "user",
          content: "确认账单项目单聊上下文",
          timestamp: "2026-11-25T07:30:00Z",
        },
        {
          seq: 2,
          role: "assistant",
          agent: "codex",
          model: "gpt-5.3-codex",
          content: "项目2原始单聊正文保持完好。",
          timestamp: "2026-11-25T07:31:00Z",
        },
      ],
    },
    "collab-run-proj2-impl": {
      activity_history_version: 1,
      reply_metadata_version: 1,
      key: "collab-run-proj2-impl",
      session_key: "collab-run-proj2-impl",
      root_id: "proj-2",
      name: "主模型实现 · 补齐账单对账幂等校验",
      type: "chat",
      source: "collab_stage",
      agent: "codex",
      model: "gpt-5.3-codex",
      effort: "high",
      created_at: "2026-11-25T07:40:00Z",
      updated_at: "2026-11-25T07:45:00Z",
      exchanges: [
        {
          seq: 1,
          role: "assistant",
          agent: "codex",
          model: "gpt-5.3-codex",
          content: "项目2账单对账阶段输出不应泄漏回单聊。",
          timestamp: "2026-11-25T07:45:00Z",
        },
      ],
    },
  };

  await page.route("https://entry.test/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const pathname = url.pathname.replace(/^\/n\/[^/]+(?:\/p\/[^/]+)?/, "") || "/";
    const json = (payload, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(payload),
      });

    if (pathname.startsWith("/api/")) {
      if (pathname === "/api/relay/status") {
        return json({ remote_host: false, e2ee_required: false, node_name: "Mac" });
      }
      if (pathname === "/api/remote/projects") {
        return json({
          projects: [
            { project_id: "proj-1", name: "idea-ai-agent", label: "", availability: "online" },
          ],
        });
      }
      if (pathname === "/api/dirs") {
        return json([
          {
            id: "proj-1",
            display_name: "idea-ai-agent",
            root_path: "/workspace/idea-ai-agent",
            is_git_repo: true,
          },
          {
            id: "proj-2",
            display_name: "billing-service",
            root_path: "/workspace/billing-service",
            is_git_repo: true,
          },
        ]);
      }
      if (pathname === "/api/dir") {
        return json({ entries: [] });
      }
      if (pathname === "/api/agents") {
        return json({ agents, shells: [] });
      }
      if (pathname === "/api/upload" && method === "POST") {
        uploadCallCount += 1;
        if (holdUploadPromise) {
          await holdUploadPromise;
        }
        const rawBody = req.postData() || "";
        const names = [...rawBody.matchAll(/filename="([^"]+)"/g)].map((m) => m[1]);
        const files = (names.length > 0 ? names : ["attachment.png"]).map((name) => ({
          path: `.mindfs/attachments/${name}`,
          name,
          mime: name.endsWith(".png") ? "image/png" : "text/plain",
          size: 128,
        }));
        return json({ files });
      }
      if (pathname === "/api/file/raw" && method === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "image/png",
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2dIAAAAASUVORK5CYII=",
            "base64",
          ),
        });
      }
      if (pathname === "/api/sessions") {
        if (url.searchParams.get("multi_root") === "1") {
          return json({
            groups: [
              {
                root_id: "proj-1",
                root_name: "idea-ai-agent",
                latest_session_time: "2026-11-25T08:00:05Z",
                items: [sessionsByKey["single-chat-1"]],
                total_count: 1,
              },
            ],
          });
        }
        const rootFilter = url.searchParams.get("root") || "";
        const items =
          rootFilter === "proj-2"
            ? [sessionsByKey["single-chat-proj2"]]
            : [sessionsByKey["single-chat-1"]];
        return json({
          items,
          total_count: items.length,
        });
      }
      const sessionMatch = /^\/api\/sessions\/([^/]+)(?:\/sync)?$/.exec(pathname);
      if (sessionMatch && (method === "GET" || method === "POST")) {
        const key = decodeURIComponent(sessionMatch[1]);
        const reqRoot = url.searchParams.get("root") || "";
        sessionFetchLog.push({ root: reqRoot, key });
        return json(sessionsByKey[key] || sessionsByKey["single-chat-1"]);
      }
      const mockSkills = [
        {
          name: "code-simplifier",
          description: "精简冗余代码",
          path: "/skills/code-simplifier/SKILL.md",
          source: "codex",
        },
        {
          name: "cs",
          description: "CodeStable 总控入口",
          path: "/skills/codex/cs/SKILL.md",
          source: "codex",
        },
        {
          name: "cs-arch",
          description: "架构规范检查",
          path: "/skills/codex/cs-arch/SKILL.md",
          source: "codex",
        },
        {
          name: "cs-audit",
          description: "系统审计检查",
          path: "/skills/codex/cs-audit/SKILL.md",
          source: "codex",
        },
        {
          name: "cs-brainstorm",
          description: "方案头脑风暴",
          path: "/skills/codex/cs-brainstorm/SKILL.md",
          source: "codex",
        },
        {
          name: "cs-decide",
          description: "决策记录规范",
          path: "/skills/codex/cs-decide/SKILL.md",
          source: "codex",
        },
        {
          name: "cs-explore",
          description: "代码库探索",
          path: "/skills/codex/cs-explore/SKILL.md",
          source: "codex",
        },
        {
          name: "cs-feat",
          description: "功能开发流程",
          path: "/skills/codex/cs-feat/SKILL.md",
          source: "codex",
        },
        {
          name: "cs-feat-accept",
          description: "功能验收流程",
          path: "/skills/codex/cs-feat-accept/SKILL.md",
          source: "codex",
        },
        {
          name: "cs-feat-design",
          description: "功能设计阶段",
          path: "/skills/codex/cs-feat-design/SKILL.md",
          source: "codex",
        },
        {
          name: "cs-feat-ff",
          description: "快速推进功能",
          path: "/skills/codex/cs-feat-ff/SKILL.md",
          source: "codex",
        },
        {
          name: "cs-feat-impl",
          description: "功能实现规范",
          path: "/skills/codex/cs-feat-impl/SKILL.md",
          source: "codex",
        },
        {
          name: "cs-feat-plan",
          description: "功能规划阶段",
          path: "/skills/codex/cs-feat-plan/SKILL.md",
          source: "codex",
        },
        {
          name: "cs-feat-review",
          description: "功能审核阶段",
          path: "/skills/codex/cs-feat-review/SKILL.md",
          source: "codex",
        },
        {
          name: "cs-feat-test",
          description: "功能测试规范",
          path: "/skills/codex/cs-feat-test/SKILL.md",
          source: "codex",
        },
        {
          name: "cs-fix",
          description: "缺陷修复流程",
          path: "/skills/codex/cs-fix/SKILL.md",
          source: "codex",
        },
        {
          name: "cs-issue",
          description: "问题排查记录",
          path: "/skills/codex/cs-issue/SKILL.md",
          source: "codex",
        },
        {
          name: "cs-migrate",
          description: "数据迁移规范",
          path: "/skills/codex/cs-migrate/SKILL.md",
          source: "codex",
        },
        {
          name: "cs-release",
          description: "发版门禁检查",
          path: "/skills/codex/cs-release/SKILL.md",
          source: "codex",
        },
        {
          name: "cs-security",
          description: "安全边界审核",
          path: "/skills/codex/cs-security/SKILL.md",
          source: "codex",
        },
        {
          name: "cs-spec",
          description: "规格文档维护",
          path: "/skills/codex/cs-spec/SKILL.md",
          source: "codex",
        },
        {
          name: "cs-verify",
          description: "端到端验证清单",
          path: "/skills/codex/cs-verify/SKILL.md",
          source: "codex",
        },
        {
          name: "browser-use",
          description: "浏览器自动化",
          path: "/skills/agents/browser-use/SKILL.md",
          source: "agents",
        },
        {
          name: "unslop",
          description: "界面质感打磨",
          path: "/skills/claude/unslop/SKILL.md",
          source: "claude",
        },
      ];
      if (pathname === "/api/collab/templates" && method === "GET") {
        return json({
          items: templates,
          skills: mockSkills,
        });
      }
      if (pathname === "/api/collab/templates" && method === "POST") {
        const body = JSON.parse(req.postData() || "{}");
        savedTemplatePayloads.push(body);
        const created = {
          id: `tpl-saved-${savedTemplatePayloads.length}`,
          name: body.name,
          mode: body.mode || "quick",
          is_default: Boolean(body.is_default),
          members: body.members || [],
          skill_paths: body.skill_paths || [],
          all_available: true,
          availability: (body.members || []).map((m) => ({
            slot_id: m.slot_id,
            role: m.role,
            agent: m.agent,
            model: m.model || "",
            available: true,
          })),
          created_at: "2026-11-26T00:00:00Z",
          updated_at: "2026-11-26T00:00:00Z",
        };
        if (created.is_default) {
          for (const t of templates) t.is_default = false;
        }
        templates.push(created);
        return json(created);
      }
      const templateIdMatch = /^\/api\/collab\/templates\/([^/]+)$/.exec(pathname);
      if (templateIdMatch && method === "PUT") {
        const id = decodeURIComponent(templateIdMatch[1]);
        const body = JSON.parse(req.postData() || "{}");
        savedTemplatePayloads.push(body);
        const idx = templates.findIndex((t) => t.id === id);
        const updated = {
          ...(idx >= 0 ? templates[idx] : {}),
          ...body,
          id,
          skill_paths: body.skill_paths || [],
          all_available: true,
          updated_at: "2026-11-26T00:01:00Z",
        };
        if (updated.is_default) {
          for (const t of templates) {
            if (t.id !== id) t.is_default = false;
          }
        }
        if (idx >= 0) templates[idx] = updated;
        return json(updated);
      }
      if (pathname === "/api/collab/runs" && method === "GET") {
        const rootFilter = url.searchParams.get("root") || "";
        if (rootFilter === "proj-2" && holdProj2RunsPromise) {
          await holdProj2RunsPromise;
        }
        const items = [...runsById.values()]
          .map((d) => d.run)
          .filter((r) => !rootFilter || r.root_id === rootFilter);
        const waiting_count = items.filter((r) => r.status === "waiting_user").length;
        return json({ items, waiting_count });
      }
      if (pathname === "/api/collab/runs" && method === "POST") {
        if (holdStartRunPromise) {
          await holdStartRunPromise;
        }
        const body = JSON.parse(req.postData() || "{}");
        startedPayloads.push(body);
        const newId = `run-new-${startedPayloads.length}`;
        const created = {
          run: {
            id: newId,
            root_id: body.root_id,
            mode: "quick",
            title: body.task_prompt.slice(0, 32),
            task_prompt: body.task_prompt,
            template_id: body.template_id,
            template_name: body.template_name,
            snapshot: {
              template_id: body.template_id,
              template_name: body.template_name,
              mode: "quick",
              members: body.members,
              skill_paths: body.skill_paths || [],
            },
            status: "running",
            current_step: "review",
            steps: [
              {
                key: "impl",
                title: "主模型实现",
                role: "primary",
                agent: "codex",
                model: "gpt-5.3-codex",
                effort: "high",
                session_key: "collab-run-wait-impl",
                doc_path: `.mindfs/runs/${newId}/01-impl.md`,
                status: "done",
                summary: "主模型已生成实现说明与代码变更",
              },
              {
                key: "review",
                title: "独立只读审核",
                role: "reviewer",
                agent: "claude",
                model: "claude-opus-4-6",
                effort: "high",
                read_only: true,
                session_key: "collab-run-wait-review",
                doc_path: `.mindfs/runs/${newId}/02-review.md`,
                status: "running",
                summary: "正在对照全局编码准则与代码行号进行只读审核...",
              },
              { key: "response", title: "主模型逐条回应", role: "primary", status: "pending" },
              { key: "decisions", title: "分歧拍板", role: "author", status: "pending" },
              { key: "fix_test", title: "修改与测试报告", role: "primary", status: "pending" },
            ],
            created_at: "2026-11-25T08:20:00Z",
            updated_at: "2026-11-25T08:20:00Z",
          },
          review_items: [],
          docs: ["01-impl.md", "02-review.md"],
        };
        runsById.set(newId, created);
        return json(created, 201);
      }
      if (pathname === "/api/collab/runs/review-again-test/changes") {
        if (!url.searchParams.has("path")) return json({ paths: ["src/main.go"], partial: false });
        assert.equal(url.searchParams.get("path"), "src/main.go");
        return json([{ session_key: "impl", seq: 2, title: "主模型实现", update: {
          diff: "diff --git a/src/main.go b/src/main.go\n--- a/src/main.go\n+++ b/src/main.go\n@@ -1 +1 @@\n-oldValue\n+newValue",
        } }]);
      }
      if (pathname === "/api/collab/runs/review-again-test/review-again" && method === "POST") {
        assert.equal(url.searchParams.get("round"), "1");
        const body = JSON.parse(req.postData() || "{}");
        assert.equal(body.author_note, "请额外核查空数组边界与并发锁\n[file: .mindfs/attachments/review-evidence.png]");
        const detail = runsById.get("review-again-test");
        Object.assign(detail.run, { round: 2, current_step: "review", status: "running", test_status: "" });
        Object.assign(detail.run.steps[1], {
          status: "running",
          author_note: body.author_note,
          doc_path: ".mindfs/runs/review-again-test/第02轮/02-审核意见.md",
        });
        detail.review_items = [];
        return json(detail);
      }
      const detailMatch = /^\/api\/collab\/runs\/([^/]+)$/.exec(pathname);
      if (detailMatch && method === "GET") {
        const id = decodeURIComponent(detailMatch[1]);
        const rootParam = url.searchParams.get("root") || "";
        const found = runsById.get(id);
        if (!found || (rootParam && found.run.root_id !== rootParam)) {
          return json({ error: "run not found" }, 404);
        }
        if (id === "run-new-1" && holdProgressDetail) {
          const saved = structuredClone(found);
          await holdProgressDetail;
          return json(saved);
        }
        return json(found);
      }
      const continueMatch = /^\/api\/collab\/runs\/([^/]+)\/continue$/.exec(pathname);
      if (continueMatch && method === "POST") {
        const id = decodeURIComponent(continueMatch[1]);
        progressRequests.push([url.searchParams.get("root"), id]);
        return json({ ...runsById.get(id), progress_action: "running" });
      }
      const docMatch = /^\/api\/collab\/runs\/([^/]+)\/docs\/(.+)$/.exec(pathname);
      if (docMatch && method === "GET") {
        if (holdDocPromise) {
          await holdDocPromise;
        }
        const docName = decodeURIComponent(docMatch[2]);
        return json({
          name: docName,
          content: `# ${docName}\n\n- **核对结论**：工作区只读检查通过（clean）\n- [control_filter.go](runtime/server/internal/collab/control_filter.go#L42)`,
        });
      }
      const pauseMatch = /^\/api\/collab\/runs\/([^/]+)\/pause$/.exec(pathname);
      if (pauseMatch && method === "POST") {
        if (holdPausePromise) {
          await holdPausePromise;
        }
        const id = decodeURIComponent(pauseMatch[1]);
        const existing = runsById.get(id);
        if (!existing) return json({ error: "run not found" }, 404);
        existing.run.status = "waiting_user";
        return json(existing);
      }
      const decisionsMatch = /^\/api\/collab\/runs\/([^/]+)\/decisions$/.exec(pathname);
      if (decisionsMatch && method === "POST") {
        const id = decodeURIComponent(decisionsMatch[1]);
        const body = JSON.parse(req.postData() || "{}");
        submittedPayloads.push(body);
        const existing = runsById.get(id);
        existing.run.status = "completed";
        existing.run.current_step = "done";
        existing.run.test_status = "passed";
        existing.run.test_command = "go test -race ./server/internal/collab";
        existing.run.steps[3].status = "done";
        existing.run.steps[3].summary = "作者已完成 2 条分歧裁决";
        existing.run.steps[4].status = "done";
        existing.run.steps[4].summary = "已完成裁决落地并通过全量单测";
        existing.docs = ["01-impl.md", "02-review.md", "03-response.md", "04-decisions.md", "05-report.md"];
        for (const dec of body.decisions || []) {
          const item = existing.review_items.find((x) => x.item_id === dec.item_id);
          if (item) {
            item.author_decision = dec.decision;
            item.author_note = dec.note || "";
          }
        }
        return json(existing);
      }
      const cleanMatch = /^\/api\/collab\/runs\/([^/]+)\/cleanup-docs$/.exec(pathname);
      if (cleanMatch && method === "POST") {
        const id = decodeURIComponent(cleanMatch[1]);
        const body = JSON.parse(req.postData() || "{}");
        cleanedPayloads.push(body);
        const existing = runsById.get(id);
        existing.run.docs_cleaned = true;
        existing.docs = body.keep_docs || [];
        return json({ removed: ["01-impl.md", "02-review.md", "03-response.md", "04-decisions.md"], detail: existing });
      }
      return json({ dirs: [], agents: [], shells: [], tasks: [], templates: [], items: [] });
    }

    const file = pathname === "/" ? "index.html" : pathname.slice(1);
    const ext = path.extname(file);
    const contentType =
      ext === ".js"
        ? "text/javascript"
        : ext === ".css"
          ? "text/css"
          : ext === ".html"
            ? "text/html"
            : ext === ".svg"
              ? "image/svg+xml"
              : "application/octet-stream";
    const body = await readFile(path.join(outDir, file));
    return route.fulfill({
      contentType,
      body:
        file === "index.html"
          ? body
              .toString()
              .replace(
                "</head>",
                '<meta name="local-ai-agent-mode" content="standalone"><meta name="local-ai-agent-version" content="0.1.66"></head>',
              )
          : body,
    });
  });

  // 1. Desktop Single-Chat: verify top-center 多Agent模式 entry + waiting badge (2) & zero sidebar clutter
  await page.addInitScript(() => {
    if (!localStorage.getItem("mindfs-remote-glow")) {
      localStorage.setItem("mindfs-remote-glow", JSON.stringify({ on: true, fx: "orbit", color: "teal", custom: "#6366f1", speed: "fast" }));
    }
  });
  await page.goto("https://entry.test/");
  await page.getByRole("button", { name: "打开文件树菜单" }).click();
  await expect(page.getByRole("button", { name: /Agent 状态框流光/ })).toBeVisible();
  await page.getByRole("button", { name: "打开文件树菜单" }).click();
  const entryBtn = page.locator(".remote-topbar .collab-entry-btn:visible").first();
  await expect(entryBtn).toBeVisible();
  await expect(entryBtn).toContainText("多Agent模式");
  await expect(entryBtn.locator(".collab-entry-badge")).toHaveText("2");
  await expect(page.locator(".workspace-sessions .collab-entry-btn")).toHaveCount(0);
  const topCenterBox = await entryBtn.boundingBox();
  assert.ok(topCenterBox, "top-center entry button must have bounding box");
  const entryCenterX = topCenterBox.x + topCenterBox.width / 2;
  assert.ok(
    Math.abs(entryCenterX - 1440 / 2) <= 6,
    `expected 多Agent模式 centered near 720px, got ${entryCenterX}px`,
  );
  if (screenshotDir) {
    await page.screenshot({ path: path.join(screenshotDir, "00-desktop-topbar-center.png") });
  }

  // Start directly from unselected single-chat (no session clicked yet), enter Collab, view a stage session, and return:
  // URL and main view must NOT leak the collab stage conversation into single-chat!
  await entryBtn.click();
  await expect(page.locator(".collab-shell")).toBeVisible();
  const projectSelect = page.locator(".collab-project-bar select");
  await expect(projectSelect).toBeVisible();
  await expect(projectSelect).toHaveValue("proj-1");
  await expect(page.locator(".collab-project-bar")).toContainText("当前项目");
  await expect(page.locator(".collab-project-path")).toHaveText("/workspace/idea-ai-agent");
  await expect(page.locator(".collab-sb-foot")).toContainText("idea-ai-agent");

  await page.locator(".collab-run-item", { hasText: "重构流式控制块过滤器并补齐边界单测" }).click();
  await expect(
    page.locator(".collab-detail-pane").getByText(/我已实现.*ControlBlockFilter/),
  ).toBeVisible();
  assert.equal(new URL(page.url()).searchParams.get("session") || "", "");
  await page.getByRole("button", { name: "返回单聊" }).first().click();
  await expect(page.locator(".collab-shell")).toHaveCount(0);
  assert.equal(new URL(page.url()).searchParams.get("session") || "", "");
  await expect(page.getByText(/我已实现.*ControlBlockFilter/)).toHaveCount(0);

  // Switch project inside Collab via dropdown (preserves draft prompt, reloads project runs, submits to selected project,
  // and returning to single-chat stays on the newly selected project without reverting!)
  await entryBtn.click();
  await expect(page.locator(".collab-shell")).toBeVisible();
  // R1 + R4: Viewing a run in proj-1, opening a slow doc, and switching to proj-2 must:
  // 1) NEVER bind/fetch proj-1's stage session under proj-2 (R1)
  // 2) NEVER pop up proj-1's doc preview modal on proj-2 once the slow doc resolves (R4)
  await page.locator(".collab-run-item", { hasText: "重构流式控制块过滤器并补齐边界单测" }).click();
  await expect(
    page.locator(".collab-detail-pane").getByText(/我已实现.*ControlBlockFilter/),
  ).toBeVisible();
  await expect(page.locator(".collab-card").getByText(/我已实现.*ControlBlockFilter/)).toHaveCount(0);
  const completedReview = page.locator(".collab-card.st-done").filter({ hasText: "独立只读审核" });
  const stepDetails = page.locator(".collab-step-details");
  await expect(completedReview.locator(".collab-tc-status")).toHaveText("已完成");
  await expect(page.locator(".collab-card.st-pending .collab-tc-status")).toHaveText("待开始");
  await expect(completedReview.getByRole("button")).toHaveCount(1);
  await expect(completedReview).not.toContainText("Claude Code");
  const reviewHeader = completedReview.getByRole("button");
  await reviewHeader.press("Enter");
  await expect(reviewHeader).toBeFocused();
  await expect(reviewHeader).toHaveCSS("outline-width", "2px");
  await stepDetails.locator(":scope > summary").click();
  await expect(stepDetails).toContainText("提出 3 条审核意见");
  await expect(stepDetails).toContainText("处已核实");
  sessionFetchLog.length = 0;
  holdDocPromise = new Promise((resolve) => {
    releaseDoc = resolve;
  });
  await page.getByRole("button", { name: "02-review.md" }).click();
  await projectSelect.selectOption("proj-2");
  await expect(projectSelect).toHaveValue("proj-2");
  await expect(page.locator(".collab-run-item", { hasText: "补齐账单对账幂等校验" })).toBeVisible();
  releaseDoc();
  holdDocPromise = null;
  await page.waitForTimeout(100);
  await expect(page.locator(".collab-modal")).toHaveCount(0);
  assert.deepEqual(
    sessionFetchLog.filter((item) => item.root === "proj-2" && item.key.startsWith("collab-run-wait")),
    [],
    "switching projects must not bind or fetch previous project's stage session under new root",
  );

  // R5: Clicking pause on a running proj-2 run then switching to proj-1 while pause & listRuns race:
  // Re-test pause race from proj-1 -> proj-2 after starting a running task on proj-2
  await projectSelect.selectOption("proj-1");
  await expect(projectSelect).toHaveValue("proj-1");
  await page.locator(".collab-task-textarea").fill("修正账单回调重试边界");
  await projectSelect.selectOption("proj-2");
  await expect(projectSelect).toHaveValue("proj-2");
  await expect(page.locator(".collab-project-path")).toHaveText("/workspace/billing-service");
  await expect(page.locator(".collab-sb-foot")).toContainText("billing-service");
  await expect(page.locator(".collab-run-item", { hasText: "补齐账单对账幂等校验" })).toBeVisible();
  await expect(page.locator(".collab-run-item", { hasText: "重构流式控制块过滤器并补齐边界单测" })).toHaveCount(0);
  await expect(page.locator(".collab-task-textarea")).toHaveValue("修正账单回调重试边界");
  assert.equal(new URL(page.url()).searchParams.get("root") || "", "proj-2");
  assert.equal(new URL(page.url()).searchParams.get("session") || "", "");

  // R7: Verify .collab-project-path uses --cb-text-sec (>= 4.5:1 contrast in light & dark themes)
  const pathColors = await page.evaluate(() => {
    const root = document.documentElement;
    const prevTheme = root.getAttribute("data-theme");
    const prevAppearance = root.getAttribute("data-appearance");
    const read = () => {
      const pathEl = document.querySelector(".collab-project-path");
      return pathEl ? getComputedStyle(pathEl).color : "";
    };
    root.removeAttribute("data-theme");
    root.removeAttribute("data-appearance");
    const light = read();
    root.setAttribute("data-theme", "dark");
    const dark = read();
    if (prevTheme === null) root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", prevTheme);
    if (prevAppearance === null) root.removeAttribute("data-appearance");
    else root.setAttribute("data-appearance", prevAppearance);
    return { light, dark };
  });
  assert.equal(pathColors.light, "rgb(81, 81, 84)", "light mode project path should use --cb-text-sec (#515154, 7.07:1)");
  assert.equal(pathColors.dark, "rgb(161, 161, 170)", "dark mode project path should use --cb-text-sec (#a1a1aa, 7.48:1)");

  // Starting a run after switching project targets proj-2
  await page.getByRole("button", { name: "开始一写一审" }).click();
  const runningCard = page.locator(".collab-card.st-running");
  await expect(runningCard).toContainText("独立只读审核");
  await expect(runningCard.locator(".collab-tc-status")).toHaveText("进行中");
  const readGlow = (locator) => locator.evaluate((el) => {
    const style = getComputedStyle(el, "::before");
    return [style.visibility, style.animationName, style.content];
  });
  const runningDot = page.locator(".collab-run-item.active .collab-run-dot");
  await expect(runningCard).toHaveClass(/remote-glow-frame/);
  await expect(runningCard).toHaveAttribute("data-glow-active", "");
  await expect.poll(() => readGlow(runningCard)).toEqual(["visible", "glow-flow, glow-breathe", "\"\""]);
  await expect(runningDot).toHaveCSS("animation-name", "collabPulseDot");
  await expect(page.locator(".collab-run-dot.completed")).toHaveCSS("animation-name", "none");
  await expect(page.locator(".collab-detail-body")).not.toHaveClass(/remote-glow-frame/);
  await expect(page.locator(".collab-detail-footer .remote-status-activity.remote-glow-frame")).toHaveCount(1);
  if (screenshotDir) {
    await page.screenshot({ path: path.join(screenshotDir, "02a-desktop-running-glow.png") });
  }
  assert.equal(startedPayloads.length, 1);
  assert.equal(startedPayloads[0].root_id, "proj-2");
  await expect.poll(() => !!runSocket).toBe(true);
  let releaseProgressDetail;
  holdProgressDetail = new Promise((resolve) => { releaseProgressDetail = resolve; });
  t.after(() => releaseProgressDetail());
  const inFlight = page.waitForResponse((res) => new URL(res.url()).pathname === "/api/collab/runs/run-new-1");
  const current = runsById.get("run-new-1");
  const advanced = structuredClone(current.run);
  advanced.current_step = "response";
  advanced.updated_at = "2026-11-25T08:20:00.000005Z";
  advanced.steps[1].status = "done";
  Object.assign(advanced.steps[2], { status: "running", session_key: "collab-run-wait-impl" });
  runSocket.send(JSON.stringify({ type: "collab.run.updated", payload: { root_id: "proj-2", run: advanced } }));
  await expect(runningCard).toContainText("主模型逐条回应");
  await expect(page.locator(".collab-detail-title")).toContainText("主模型逐条回应");
  current.run = advanced;
  releaseProgressDetail();
  holdProgressDetail = null;
  await inFlight;
  await expect(runningCard).toContainText("主模型逐条回应");
  await runningCard.getByRole("button", { name: "检查进度并继续" }).click();
  await expect.poll(() => progressRequests).toEqual([["proj-2", "run-new-1"]]);
  await expect(runningCard.getByRole("button", { name: "检查进度并继续" })).toBeEnabled();

  const failed = structuredClone(advanced);
  failed.status = "failed";
  failed.updated_at = "2026-11-25T08:20:00.000006Z";
  failed.steps[2].status = "failed";
  failed.steps[2].summary = "当前模型服务不可用";
  current.run = failed;
  runSocket.send(JSON.stringify({ type: "collab.run.updated", payload: { root_id: "proj-2", run: failed } }));
  const failedCard = page.locator(".collab-card.st-failed");
  await expect(failedCard.locator(".collab-tc-status")).toHaveText("失败");
  await expect(failedCard.locator(".collab-tc-warning")).toHaveText("当前模型服务不可用");
  await expect(failedCard.getByRole("button", { name: "检查进度并继续" })).toBeEnabled();
  current.run = { ...advanced, updated_at: "2026-11-25T08:20:00.000007Z" };
  runSocket.send(JSON.stringify({ type: "collab.run.updated", payload: { root_id: "proj-2", run: current.run } }));
  await expect(runningCard.locator(".collab-tc-status")).toHaveText("进行中");
  startedPayloads.length = 0;

  // Switching project while viewing an active run must NOT trigger 404 or error toast
  await projectSelect.selectOption("proj-1");
  await expect(projectSelect).toHaveValue("proj-1");
  await expect(page.locator(".collab-run-item", { hasText: "重构流式控制块过滤器并补齐边界单测" })).toBeVisible();
  await expect(page.getByText("多Agent模式 · 新建一写一审")).toBeVisible();

  // R5: Start a running run in proj-1, trigger Pause while switching to proj-2, and resolve Pause BEFORE proj-2 listRuns.
  // Old pause handler's stale refreshRuns must NOT invalidate proj-2's in-flight listRuns and leave proj-2 blank!
  await page.locator(".collab-task-textarea").fill("验证暂停竞态不清空目标项目列表");
  await page.getByRole("button", { name: "开始一写一审" }).click();
  await expect(page.locator(".collab-card.st-running")).toContainText("独立只读审核");
  startedPayloads.length = 0;
  holdPausePromise = new Promise((resolve) => {
    releasePause = resolve;
  });
  holdProj2RunsPromise = new Promise((resolve) => {
    releaseProj2Runs = resolve;
  });
  await page.getByRole("button", { name: "暂停干预" }).click();
  await projectSelect.selectOption("proj-2");
  await expect(projectSelect).toHaveValue("proj-2");
  // Resolve old proj-1 pause first while proj-2 listRuns is still pending
  releasePause();
  holdPausePromise = null;
  await page.waitForTimeout(80);
  // Now resolve proj-2 listRuns -> proj-2 runs MUST render (not dropped by stale seq bump!)
  releaseProj2Runs();
  holdProj2RunsPromise = null;
  await expect(page.locator(".collab-run-item", { hasText: "补齐账单对账幂等校验" })).toBeVisible();

  // R2: View a collab stage in proj-2, then click "返回单聊":
  // Single-chat must stay on proj-2 and MUST NOT restore or display the collab stage conversation!
  await page.locator(".collab-run-item", { hasText: "补齐账单对账幂等校验" }).click();
  await expect(
    page.locator(".collab-detail-pane").getByText("项目2账单对账阶段输出不应泄漏回单聊。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回单聊" }).first().click();
  await expect(page.locator(".collab-shell")).toHaveCount(0);
  assert.equal(new URL(page.url()).searchParams.get("root") || "", "proj-2");
  assert.equal(new URL(page.url()).searchParams.get("session") || "", "");
  await expect(page.getByText("项目2账单对账阶段输出不应泄漏回单聊。")).toHaveCount(0);

  // R2 (with existing single-chat selected in proj-2): select proj-2's single-chat, re-enter collab,
  // switch proj-2 -> proj-1 -> proj-2, view proj-2 collab stage, exit -> must restore proj-2's single-chat!
  await page.locator("text=账单服务日常单聊 >> visible=true").first().click();
  await expect(page.getByText("项目2原始单聊正文保持完好。")).toBeVisible();
  await entryBtn.click();
  await expect(page.locator(".collab-shell")).toBeVisible();
  await projectSelect.selectOption("proj-1");
  await expect(projectSelect).toHaveValue("proj-1");
  await page.getByRole("button", { name: "返回单聊" }).first().click();
  await expect(page.locator(".collab-shell")).toHaveCount(0);
  await entryBtn.click();
  await expect(page.locator(".collab-shell")).toBeVisible();
  await projectSelect.selectOption("proj-2");
  await expect(projectSelect).toHaveValue("proj-2");
  await page.locator(".collab-run-item", { hasText: "补齐账单对账幂等校验" }).click();
  await expect(
    page.locator(".collab-detail-pane").getByText("项目2账单对账阶段输出不应泄漏回单聊。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回单聊" }).first().click();
  await expect(page.locator(".collab-shell")).toHaveCount(0);
  assert.equal(new URL(page.url()).searchParams.get("root") || "", "proj-2");
  await expect(page.getByText("项目2原始单聊正文保持完好。")).toBeVisible();
  await expect(page.getByText("项目2账单对账阶段输出不应泄漏回单聊。")).toHaveCount(0);

  // Switch back to proj-1 before continuing existing single-chat restoration checks
  await entryBtn.click();
  await expect(page.locator(".collab-shell")).toBeVisible();
  await projectSelect.selectOption("proj-1");
  await expect(projectSelect).toHaveValue("proj-1");
  await page.getByRole("button", { name: "返回单聊" }).first().click();
  await expect(page.locator(".collab-shell")).toHaveCount(0);

  // Now select an existing single-chat session, enter Collab, and verify returning restores it
  await page.locator("text=日常单聊会话 >> visible=true").first().click();
  await expect(page.getByText("收到，单聊会话保持完全独立。")).toBeVisible();
  await expect(page.getByText("主模型实现 · 重构流式控制块过滤器")).toHaveCount(0);

  await entryBtn.click();
  await expect(page.locator(".collab-shell")).toBeVisible();
  await page.getByRole("button", { name: "＋ 新建快速协作" }).click();
  await expect(page.getByText("多Agent模式 · 新建一写一审")).toBeVisible();
  await page.getByRole("button", { name: "返回单聊" }).first().click();
  await expect(page.locator(".collab-shell")).toHaveCount(0);
  await expect(page.getByText("收到，单聊会话保持完全独立。")).toBeVisible();

  // 2. Global Templates, Model Echo & Unavailable Model Blocking (no silent substitution)
  await entryBtn.click();
  await expect(page.locator(".collab-shell")).toBeVisible();
  const templateSelect = page.locator(".collab-setup-wrap select");
  await expect(templateSelect).toHaveValue("tpl-default");

  // Setup slot cards MUST echo the selected agent, model, and effort clearly!
  const setupSlots = page.locator(".collab-setup-wrap .collab-slot-card");
  await expect(setupSlots.nth(0)).toContainText("Codex · gpt-5.3-codex");
  await expect(setupSlots.nth(0)).toContainText("思考：high");
  await expect(setupSlots.nth(1)).toContainText("Claude Code · claude-opus-4-6");
  await expect(setupSlots.nth(1)).toContainText("思考：high");

  // Template modal must also echo selected models in both template list and editor form!
  await page.getByRole("button", { name: "管理全局模板" }).click();
  await expect(page.locator(".collab-modal")).toContainText("主模型 · Codex · gpt-5.3-codex · high");
  await expect(page.locator(".collab-modal")).toContainText("审核模型 · Claude Code · claude-opus-4-6 · high");
  await page.locator(".collab-modal").getByRole("button", { name: "编辑" }).first().click();
  const modalSlots = page.locator(".collab-modal .collab-slot-card");
  await expect(modalSlots.nth(0)).toContainText("Codex · gpt-5.3-codex");
  await expect(modalSlots.nth(1)).toContainText("Claude Code · claude-opus-4-6");
  // Selecting default model inside modal echoes resolved default model name
  await modalSlots.nth(0).locator(".collab-slot-selector button").first().click();
  await page.locator('[data-agent-menu="true"]').getByRole("button", { name: /默认模型/ }).click();
  await expect(modalSlots.nth(0)).toContainText("Codex · 默认模型 (gpt-5.3-codex)");

  // Categorized Skill Picker inside Global Template Modal: grouped by source + scrollable layout + per-category & one-click select all
  const totalSkillCount = 24;
  const assertSkillPickerScrollableAndClickable = async (picker, contextLabel) => {
    const list = picker.locator(".collab-skill-picker-list");
    await expect(list).toBeVisible();

    const layout = await list.evaluate((el) => {
      const listStyle = getComputedStyle(el);
      const groups = [...el.querySelectorAll(".collab-skill-group")].map((group) => {
        const groupStyle = getComputedStyle(group);
        const head = group.querySelector(".collab-skill-group-head");
        const items = group.querySelector(".collab-skill-group-items");
        const groupRect = group.getBoundingClientRect();
        const headRect = head ? head.getBoundingClientRect() : { height: 0 };
        const itemsRect = items ? items.getBoundingClientRect() : { height: 0 };
        return {
          key: group.getAttribute("data-skill-group"),
          flexShrink: groupStyle.flexShrink,
          clientHeight: group.clientHeight,
          scrollHeight: group.scrollHeight,
          renderedHeight: groupRect.height,
          contentHeight: headRect.height + itemsRect.height,
        };
      });
      return {
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        overflowY: listStyle.overflowY,
        overscrollBehaviorY: listStyle.overscrollBehaviorY,
        groups,
      };
    });

    assert.ok(
      layout.scrollHeight > layout.clientHeight,
      `${contextLabel}: skill picker list must overflow vertically so it can scroll (scrollHeight=${layout.scrollHeight}, clientHeight=${layout.clientHeight})`,
    );
    assert.ok(
      layout.overflowY === "auto" || layout.overflowY === "scroll",
      `${contextLabel}: expected overflow-y auto/scroll, got ${layout.overflowY}`,
    );
    assert.equal(
      layout.overscrollBehaviorY,
      "contain",
      `${contextLabel}: expected overscroll-behavior-y contain`,
    );
    assert.equal(layout.groups.length, 3, `${contextLabel}: expected 3 skill groups`);
    for (const g of layout.groups) {
      assert.equal(
        g.flexShrink,
        "0",
        `${contextLabel}: group ${g.key} must not shrink (flexShrink=${g.flexShrink})`,
      );
      assert.ok(
        g.clientHeight >= g.scrollHeight,
        `${contextLabel}: group ${g.key} must not clip vertically (clientHeight=${g.clientHeight}, scrollHeight=${g.scrollHeight})`,
      );
      assert.ok(
        g.renderedHeight + 1 >= g.contentHeight,
        `${contextLabel}: group ${g.key} height (${g.renderedHeight}) must cover header+items (${g.contentHeight})`,
      );
    }

    // Scroll to the bottom and verify the last group's last skill is reachable and clickable
    const scrolledTop = await list.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      return el.scrollTop;
    });
    assert.ok(scrolledTop > 0, `${contextLabel}: scrolling to bottom must advance scrollTop`);

    const lastGroup = picker.locator('[data-skill-group="claude"]');
    const lastChip = lastGroup.locator(".collab-skill-chip", { hasText: "unslop" });
    await expect(lastChip).toBeVisible();
    const chipInListBounds = await list.evaluate((el) => {
      const listRect = el.getBoundingClientRect();
      const chips = el.querySelectorAll('[data-skill-group="claude"] .collab-skill-chip');
      const target = chips[chips.length - 1];
      if (!target) return null;
      const chipRect = target.getBoundingClientRect();
      return {
        listTop: listRect.top,
        listBottom: listRect.bottom,
        chipTop: chipRect.top,
        chipBottom: chipRect.bottom,
      };
    });
    assert.ok(
      chipInListBounds &&
        chipInListBounds.chipTop >= chipInListBounds.listTop - 1 &&
        chipInListBounds.chipBottom <= chipInListBounds.listBottom + 1,
      `${contextLabel}: last skill chip must be fully visible inside scrolled list: ${JSON.stringify(chipInListBounds)}`,
    );

    const lastCheckbox = lastChip.locator('input[type="checkbox"]');
    const wasChecked = await lastCheckbox.isChecked();
    await lastChip.click();
    assert.equal(
      await lastCheckbox.isChecked(),
      !wasChecked,
      `${contextLabel}: clicking last skill chip after scrolling must toggle selection`,
    );
    // Restore original state before continuing other assertions
    await lastChip.click();
    assert.equal(await lastCheckbox.isChecked(), wasChecked);
  };

  const modalSkillPicker = page.locator(".collab-modal .collab-skill-picker");
  await expect(modalSkillPicker).toContainText(`已选 1 / ${totalSkillCount}`);
  await expect(modalSkillPicker.locator('[data-skill-group="codex"]')).toContainText("Codex");
  await expect(modalSkillPicker.locator('[data-skill-group="agents"]')).toContainText("共享 Agents");
  await expect(modalSkillPicker.locator('[data-skill-group="claude"]')).toContainText("Claude");
  await assertSkillPickerScrollableAndClickable(modalSkillPicker, "global template modal");

  // Per-category one-click toggle on Claude group selects only Claude skills
  await modalSkillPicker
    .locator('[data-skill-group="claude"]')
    .getByRole("button", { name: "全选本类" })
    .click();
  await expect(modalSkillPicker).toContainText(`已选 2 / ${totalSkillCount}`);
  await expect(
    modalSkillPicker.locator('[data-skill-group="claude"]').getByRole("button", { name: "取消本类" }),
  ).toBeVisible();

  // Global one-click select all checks all skills, then cancel all clears back to 0
  await modalSkillPicker.getByRole("button", { name: "一键全选" }).click();
  await expect(modalSkillPicker).toContainText(`已选 ${totalSkillCount} / ${totalSkillCount}`);
  await modalSkillPicker.getByRole("button", { name: "取消全选" }).click();
  await expect(modalSkillPicker).toContainText(`已选 0 / ${totalSkillCount}`);

  // Cancel editing tpl-default (preserve its original model) and test creating a new template with one-click select all
  await page.locator(".collab-modal").getByRole("button", { name: "取消" }).click();
  await page.locator(".collab-modal").getByRole("button", { name: "＋ 新建模板" }).click();
  await page
    .locator(".collab-modal input[type='text']")
    .fill("全量 Skill 审核模板");
  const templatePrimary = page.locator(".collab-modal .collab-slot-card").first();
  await expect(templatePrimary.getByText("沿用 Agent 配置")).toBeVisible();
  await templatePrimary.locator(".collab-slot-selector button").first().click();
  const permissionsMenu = page.locator('[data-agent-menu="true"]');
  await permissionsMenu.getByRole("button", { name: /模式/ }).click();
  await permissionsMenu.getByRole("button", { name: "full-access", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(templatePrimary.getByText("全权限", { exact: true })).toBeVisible();
  const newSkillPicker = page.locator(".collab-modal .collab-skill-picker");
  await expect(newSkillPicker).toContainText(`已选 0 / ${totalSkillCount}`);
  await newSkillPicker.getByRole("button", { name: "一键全选" }).click();
  await expect(newSkillPicker).toContainText(`已选 ${totalSkillCount} / ${totalSkillCount}`);
  await page.locator(".collab-modal").getByRole("button", { name: "保存模板" }).click();
  assert.equal(savedTemplatePayloads.length, 1);
  assert.equal(savedTemplatePayloads[0].name, "全量 Skill 审核模板");
  assert.equal(savedTemplatePayloads[0].skill_paths.length, totalSkillCount);
  assert.equal(savedTemplatePayloads[0].members[0].permission_mode, "full-access");
  await expect(page.locator(".collab-modal .collab-template-members").getByText("全权限", { exact: true })).toBeVisible();

  await page.locator(".collab-modal-head .collab-icon-btn").click();
  await expect(page.locator(".collab-modal")).toHaveCount(0);

  // Setup page collapsible Skill picker also renders categories, scrolls cleanly, and keeps button count consistent with visible selection
  const setupSkillsToggle = page.getByRole("button", { name: /附加规范 Skill/ });
  await expect(setupSkillsToggle).toContainText("附加规范 Skill (1)");
  await setupSkillsToggle.click();
  const setupSkillPicker = page.locator(".collab-setup-wrap .collab-skill-picker");
  await expect(setupSkillPicker).toBeVisible();
  await expect(setupSkillPicker.locator('[data-skill-group="codex"]')).toBeVisible();
  await expect(setupSkillPicker.locator('[data-skill-group="claude"]')).toBeVisible();
  await assertSkillPickerScrollableAndClickable(setupSkillPicker, "setup page skill picker");
  await setupSkillPicker.getByRole("button", { name: "一键全选" }).click();
  await expect(setupSkillPicker).toContainText(`已选 ${totalSkillCount} / ${totalSkillCount}`);
  await expect(setupSkillsToggle).toContainText(`附加规范 Skill (${totalSkillCount})`);
  await setupSkillPicker.getByRole("button", { name: "取消全选" }).click();
  await expect(setupSkillPicker).toContainText(`已选 0 / ${totalSkillCount}`);
  await expect(setupSkillsToggle).toContainText("附加规范 Skill (0)");
  await page.getByRole("button", { name: "还原" }).click();
  await expect(setupSkillPicker).toContainText(`已选 1 / ${totalSkillCount}`);
  await expect(setupSkillsToggle).toContainText("附加规范 Skill (1)");
  await setupSkillsToggle.click();

  // Switch to template with offline model -> red warning & Start button blocked & broken model echoed
  await templateSelect.selectOption("tpl-broken");
  await expect(setupSlots.nth(1)).toContainText("Claude Code · claude-removed-99");
  await expect(
    page.getByText("模型 claude-removed-99 不在 claude 当前可用列表中，请手动选择替代模型"),
  ).toBeVisible();
  const taskInput = page.locator(".collab-task-textarea");
  await taskInput.fill("验证不可用模型禁止静默替换");
  const startBtn = page.getByRole("button", { name: "开始一写一审" });
  await expect(startBtn).toBeDisabled();

  // Switch back to default valid template -> test attachment/image upload + paste + Start Quick Run
  await templateSelect.selectOption("tpl-default");
  await expect(startBtn).toBeEnabled();
  await setupSlots.nth(0).locator(".collab-slot-selector button").first().click();
  await permissionsMenu.getByRole("button", { name: /模式/ }).click();
  await permissionsMenu.getByRole("button", { name: "full-access", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(setupSlots.nth(0).getByText("全权限", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(permissionsMenu).toHaveCount(0);

  // Clear text first to verify attachment-only also enables Start button!
  await taskInput.fill("");
  await expect(startBtn).toBeDisabled();

  // Attach an image and a text file via file input
  const pngBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2dIAAAAASUVORK5CYII=",
    "base64",
  );
  await page.locator('.collab-task-box input[type="file"]').setInputFiles([
    { name: "ui-bug.png", mimeType: "image/png", buffer: pngBytes },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("repro steps") },
  ]);
  await expect(page.locator(".collab-attach-img-card img")).toHaveCount(1);
  await expect(page.locator(".collab-attach-file-chip")).toContainText("notes.txt");
  await expect(page.locator(".collab-attach-btn")).toContainText("附件/图片 (2)");
  await expect(startBtn).toBeEnabled();

  // Paste an image into the task textarea -> adds second image preview!
  await taskInput.evaluate((el) => {
    const dt = new DataTransfer();
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    dt.items.add(new File([bytes], "pasted-shot.png", { type: "image/png" }));
    const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
  });
  await expect(page.locator(".collab-attach-img-card img")).toHaveCount(2);
  // R7: Attachment remove buttons must maintain >= 44x44px touch targets
  const imgRemoveBox = await page.locator(".collab-attach-img-remove").first().boundingBox();
  const fileRemoveBox = await page.locator(".collab-attach-file-remove").first().boundingBox();
  assert.ok(
    imgRemoveBox && imgRemoveBox.width >= 44 && imgRemoveBox.height >= 44,
    `image remove button must be >=44x44: ${JSON.stringify(imgRemoveBox)}`,
  );
  assert.ok(
    fileRemoveBox && fileRemoveBox.width >= 44 && fileRemoveBox.height >= 44,
    `file remove button must be >=44x44: ${JSON.stringify(fileRemoveBox)}`,
  );
  // R6: Dropping plain text (no files) must NOT prevent default textarea drop
  const textDropPrevented = await page.locator(".collab-task-box").evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "拖入的文本");
    const ev = new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  assert.equal(textDropPrevented, false, "plain-text drop must not be prevented");

  // Remove the pasted image -> back to 1 image + 1 file
  await page.getByRole("button", { name: "移除附件 pasted-shot.png" }).click();
  await expect(page.locator(".collab-attach-img-card img")).toHaveCount(1);

  await taskInput.fill("按截图修复多Agent页面样式");
  await startBtn.click();
  await expect(page.locator(".collab-card.st-running")).toContainText("独立只读审核");
  assert.equal(uploadCallCount, 1);
  assert.equal(startedPayloads.length, 1);
  assert.equal(startedPayloads[0].template_id, "tpl-default");
  assert.equal(startedPayloads[0].members[0].permission_mode, "full-access");
  assert.deepEqual(startedPayloads[0].skill_paths, ["/skills/code-simplifier/SKILL.md"]);
  assert.ok(
    startedPayloads[0].task_prompt.includes("按截图修复多Agent页面样式"),
    `expected text in task_prompt: ${startedPayloads[0].task_prompt}`,
  );
  assert.ok(
    startedPayloads[0].task_prompt.includes("[file: .mindfs/attachments/ui-bug.png]"),
    `expected image token in task_prompt: ${startedPayloads[0].task_prompt}`,
  );
  assert.ok(
    startedPayloads[0].task_prompt.includes("[file: .mindfs/attachments/notes.txt]"),
    `expected file token in task_prompt: ${startedPayloads[0].task_prompt}`,
  );
  const quickModels = page.getByRole("group", { name: "本次协作模型配置" });
  await expect(quickModels.getByRole("group", { name: /主模型 · Codex · gpt-5.3-codex/ })).toContainText("5.3-codex · high");
  await expect(quickModels.getByText("全权限", { exact: true })).toBeVisible();
  const reviewerModel = quickModels.getByRole("group", { name: /审核 · Claude Code · claude-opus-4-6.*严格只读/ });
  await expect(reviewerModel).toContainText("Opus 4.6 · high");
  await expect(reviewerModel).not.toContainText("只读");
  await expect(runningCard.locator(".collab-tc-status")).toHaveText("进行中");
  await expect(runningCard).not.toContainText("Claude Code");
  await expect(page.locator(".collab-detail-title .m")).toContainText("Opus 4.6 · high");
  await expect(page.locator(".collab-detail-title").getByRole("img", { name: "Claude Code" })).toBeVisible();
  await expect(page.locator(".collab-detail-head").getByRole("img", { name: "严格只读" })).toBeVisible();
  await expect(page.locator(".collab-detail-head").getByRole("img", { name: "进行中" })).toBeVisible();
  assert.equal((await page.locator(".collab-detail-title .t").boundingBox()).y,
    (await page.locator(".collab-detail-title .m").boundingBox()).y);

  // R1 & R5: Historical run with empty model must NOT echo live agent default model,
  // and bracketed attachment path [file: ...截图[1].png] must render thumbnail without stray ".png]" text
  const defaultModelRunItem = page.locator(".collab-run-item", { hasText: "附件：截图[1].png" });
  await expect(defaultModelRunItem).toContainText("Codex · 默认模型 · high");
  await expect(defaultModelRunItem).not.toContainText("gpt-5.3-codex");
  await defaultModelRunItem.click();
  await expect(page.locator(".collab-card.st-skipped .collab-tc-status")).toHaveText(["已跳过", "已跳过"]);
  await expect(quickModels.getByRole("group", { name: /主模型 · Codex · 默认模型/ })).toContainText("默认模型 · high");
  await expect(quickModels).not.toContainText("5.3-codex");
  await expect(page.locator(".collab-detail-title .m")).toContainText("默认模型 · high");
  await expect(page.locator(".collab-detail-title .m")).not.toContainText("5.3-codex");
  await expect(page.locator(".collab-detail-pane img[alt='截图[1].png']")).toBeVisible();
  await expect(page.locator(".collab-detail-pane")).not.toContainText(".png]");

  // R2, R3, R4, R5: Template with empty effort submits displayed default effort ("high"),
  // textarea is readOnly during upload/start, and cancel-upload disappears once upload finishes
  await page.getByRole("button", { name: "＋ 新建快速协作" }).click();

  // R5 (round 2): Saving or overwriting a template that had stale skill paths must sync draftSkills
  // and clear the "已相对模板「…」临时修改" banner immediately
  await templateSelect.selectOption("tpl-default");
  await setupSlots.nth(0).locator(".collab-slot-selector button").first().click();
  await page.locator('[data-agent-menu="true"]').getByRole("button", { name: /默认模型/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-agent-menu="true"]')).toHaveCount(0);
  await expect(page.getByText("已相对模板「Codex 主写 + Claude 严审」临时修改")).toBeVisible();
  await page.getByRole("button", { name: "保存为新模板" }).click();
  await page.getByPlaceholder("新模板名称").fill("清理陈旧Skill新模板");
  await page.locator(".collab-setup-wrap").getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText(/已相对模板「.*」临时修改/)).toHaveCount(0);
  assert.equal(savedTemplatePayloads.length, 2);
  assert.equal(savedTemplatePayloads[1].name, "清理陈旧Skill新模板");
  assert.deepEqual(savedTemplatePayloads[1].skill_paths, ["/skills/code-simplifier/SKILL.md"]);

  await templateSelect.selectOption("tpl-default");
  await setupSlots.nth(0).locator(".collab-slot-selector button").first().click();
  await page.locator('[data-agent-menu="true"]').getByRole("button", { name: /默认模型/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-agent-menu="true"]')).toHaveCount(0);
  await expect(page.getByText("已相对模板「Codex 主写 + Claude 严审」临时修改")).toBeVisible();
  await page.getByRole("button", { name: "覆盖原模板" }).click();
  await expect(page.getByText(/已相对模板「.*」临时修改/)).toHaveCount(0);
  assert.equal(savedTemplatePayloads.length, 3);
  assert.deepEqual(savedTemplatePayloads[2].skill_paths, ["/skills/code-simplifier/SKILL.md"]);

  await templateSelect.selectOption("tpl-default-empty-effort");
  await expect(setupSlots.nth(0)).toContainText("思考：high");
  await expect(setupSlots.nth(1)).toContainText("思考：high");
  await page.locator('.collab-task-box input[type="file"]').setInputFiles([
    { name: "截图[1].png", mimeType: "image/png", buffer: pngBytes },
  ]);
  holdUploadPromise = new Promise((resolve) => {
    releaseUpload = resolve;
  });
  holdStartRunPromise = new Promise((resolve) => {
    releaseStartRun = resolve;
  });
  await startBtn.click();
  // R3: textarea must be readOnly during upload
  await expect(taskInput).toHaveAttribute("readonly", "");
  // Release upload while POST /api/collab/runs is still in flight
  releaseUpload();
  holdUploadPromise = null;
  // R4: once upload finishes, cancel button must vanish and primary button switches to "正在启动..."
  await expect(page.getByRole("button", { name: "取消上传" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "正在启动..." })).toBeVisible();
  await expect(taskInput).toHaveAttribute("readonly", "");
  releaseStartRun();
  holdStartRunPromise = null;
  await expect(page.locator(".collab-card.st-running")).toContainText("独立只读审核");
  assert.equal(startedPayloads.length, 2);
  assert.equal(startedPayloads[1].members[0].effort, "high");
  assert.equal(startedPayloads[1].members[1].effort, "high");
  assert.ok(
    startedPayloads[1].task_prompt.includes("[file: .mindfs/attachments/截图[1].png]"),
    `expected bracketed attachment token in task_prompt: ${startedPayloads[1].task_prompt}`,
  );

  // Open Markdown handoff doc preview modal (reusing MarkdownViewer)
  await stepDetails.locator(":scope > summary").click();
  await page.getByRole("button", { name: "02-review.md" }).click();
  await expect(page.locator(".collab-modal")).toContainText("工作区只读检查通过（clean）");

  // Dark mode screenshot of running card + doc preview
  if (screenshotDir) {
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.screenshot({ path: path.join(screenshotDir, "02-desktop-running-dark.png") });
    await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));
  }
  await page.locator(".collab-modal-head .collab-icon-btn").click();
  await expect(page.locator(".collab-modal")).toHaveCount(0);

  // 3. Select waiting dispute run -> compact card summary + step-by-step decision modal + reused SessionViewer
  await page.locator(".collab-run-item", { hasText: "重构流式控制块过滤器并补齐边界单测" }).click();
  const disputeCard = page.locator(".collab-card.st-waiting_user");
  await expect(disputeCard).toBeVisible();
  await expect(disputeCard).toContainText("2 条分歧待裁决");
  await expect(disputeCard.locator(".collab-d-item")).toHaveCount(0);

  // Right pane must render reused SessionViewer with stage conversation!
  await expect(
    page.locator(".collab-detail-pane").getByText(/我已实现.*ControlBlockFilter/),
  ).toBeVisible();

  if (screenshotDir) {
    await page.screenshot({ path: path.join(screenshotDir, "01-desktop-dispute-light.png") });
  }

  // Open decision modal from compact card button
  await disputeCard.getByRole("button", { name: "去裁决" }).click();
  const decisionDialog = page.getByRole("dialog", { name: "逐条裁决" });
  await expect(decisionDialog).toBeVisible();
  await expect(decisionDialog).toContainText("第 1 / 2 条");
  await expect(decisionDialog).toContainText("✓ 已核实");
  await expect(decisionDialog.getByRole("button", { name: "下一条" })).toBeDisabled();

  // Quick batch fill works immediately and enables submit
  await decisionDialog.getByRole("button", { name: "全部保留现状" }).click();
  await expect(decisionDialog).toContainText("已处理 2");
  await expect(decisionDialog.getByRole("button", { name: "提交裁决并继续" })).toBeEnabled();

  // Customize item 1 to "按审核改" and move to item 2
  await decisionDialog.getByRole("radio", { name: /按审核改/ }).click();
  await decisionDialog.getByRole("button", { name: /第 2 条/ }).click();
  await expect(decisionDialog).toContainText("第 2 / 2 条");
  await expect(decisionDialog).toContainText("⚠ 文件不存在");
  await expect(decisionDialog).toContainText("解析兜底转交作者");

  // Decide item 2 as "其他指示" with empty note -> submit disabled until note typed
  await decisionDialog.getByRole("radio", { name: /其他指示/ }).click();
  await expect(decisionDialog.getByRole("button", { name: "提交裁决并继续" })).toBeDisabled();
  await decisionDialog.getByLabel("R3 处理指示").fill("暂不引入 sync.Pool，保持简单切片");
  await expect(decisionDialog).toContainText("已处理 2");
  await expect(decisionDialog.getByRole("button", { name: "提交裁决并继续" })).toBeEnabled();
  if (screenshotDir) {
    await page.screenshot({ path: path.join(screenshotDir, "01b-desktop-dispute-modal.png") });
  }

  // Close modal -> draft persists on compact card
  await decisionDialog.getByRole("button", { name: "关闭裁决" }).click();
  await expect(decisionDialog).toHaveCount(0);
  await expect(disputeCard).toContainText("已选 2 / 2");

  // Switch to Run B before submitting Run A -> Run B must have 0 selected and submit/next disabled!
  await page.locator(".collab-run-item", { hasText: "第二条独立待裁决任务" }).click();
  const disputeCardB = page.locator(".collab-card.st-waiting_user");
  await expect(disputeCardB.locator(".collab-tc-status")).toHaveText("等待你");
  await expect(completedReview.locator(".collab-tc-warning")).toBeVisible();
  await expect(completedReview.locator(".collab-tc-warning")).toHaveText("只读审核期间工作区有改动");
  await expect(disputeCardB).toContainText("2 条分歧待裁决");
  await expect(disputeCardB).not.toContainText("已选");
  await disputeCardB.getByRole("button", { name: "去裁决" }).click();
  await expect(decisionDialog).toContainText("已处理 0");
  await expect(decisionDialog.getByRole("button", { name: "下一条" })).toBeDisabled();
  await decisionDialog.getByRole("button", { name: "关闭裁决" }).click();

  // Switch back to Run A -> Run A still preserves its 2/2 draft and submits to Run A!
  await page.locator(".collab-run-item", { hasText: "重构流式控制块过滤器并补齐边界单测" }).click();
  await expect(disputeCard).toContainText("已选 2 / 2");
  await disputeCard.getByRole("button", { name: "继续裁决" }).click();
  await decisionDialog.getByRole("button", { name: "提交裁决并继续" }).click();
  await expect(decisionDialog).toHaveCount(0);
  assert.equal(submittedPayloads.length, 1);
  assert.deepEqual(submittedPayloads[0].decisions, [
    { item_id: "R2", decision: "accept_review", note: "" },
    { item_id: "R3", decision: "custom", note: "暂不引入 sync.Pool，保持简单切片" },
  ]);

  // Done decisions card stays compact and opens read-only modal mirroring the decision UI
  const doneDecisionCard = page.locator(".collab-card", { hasText: "分歧拍板" });
  await expect(doneDecisionCard).toContainText("已裁决 2 条分歧");
  await expect(doneDecisionCard.locator(".collab-d-item")).toHaveCount(0);
  await doneDecisionCard.getByRole("button", { name: "查看裁决" }).click();
  const readonlyDialog = page.getByRole("dialog", { name: "查看裁决" });
  await expect(readonlyDialog).toBeVisible();
  await expect(readonlyDialog).toContainText("已裁决 · 按审核改");
  await expect(readonlyDialog.getByRole("button", { name: "全部按审核改" })).toHaveCount(0);
  await readonlyDialog.getByRole("button", { name: "下一条" }).click();
  await expect(readonlyDialog).toContainText("已裁决 · 其他指示");
  await expect(readonlyDialog).toContainText("暂不引入 sync.Pool，保持简单切片");
  if (screenshotDir) {
    await page.screenshot({ path: path.join(screenshotDir, "01c-desktop-dispute-readonly-modal.png") });
  }
  await readonlyDialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(readonlyDialog).toHaveCount(0);

  // Test result lives in stage details, with cleanup still available on the final card.
  await stepDetails.locator(":scope > summary").click();
  await expect(stepDetails.getByText(/✓ 通过/)).toBeVisible();
  const copy = structuredClone(runsById.get("run-wait"));
  Object.assign(copy.run, { id: "review-again-test", title: "独立复核按钮验证", round: 1 });
  copy.run.snapshot.members.find((member) => member.role === "primary").permission_mode = "full-access";
  copy.run.steps.forEach((step) => {step.doc_path = step.doc_path.replace("run-wait/", "review-again-test/");});
  runsById.set(copy.run.id, copy);
  await page.getByLabel("保留 05-report.md").check();
  await page.getByRole("button", { name: /清理过程文档/ }).click();
  assert.equal(cleanedPayloads.length, 1);
  assert.deepEqual(cleanedPayloads[0].keep_docs, ["05-report.md"]);
  await expect(stepDetails.getByText("已清理 .mindfs/runs/ 过程文档")).toBeVisible();
  await expect(page.locator(".collab-card").getByText("已清理 .mindfs/runs/ 过程文档")).toHaveCount(0);

  await page.reload();
  await page.locator(".collab-entry-btn:visible").first().click();
  await page.locator(".collab-run-item", { hasText: "独立复核按钮验证" }).click();
  await stepDetails.locator(":scope > summary").click();
  await page.locator("summary", { hasText: "本次改动文件" }).click();
  await page.getByRole("button", { name: "src/main.go", exact: true }).click();
  await expect(page.locator("[data-turn-diff-detail]")).toContainText("newValue");
  await page.getByRole("button", { name: "再审一轮" }).click();
  const reReviewInput = page.getByRole("textbox", { name: "补充审核意见" });
  await expect(reReviewInput).toBeVisible();
  await reReviewInput.fill("请额外核查空数组边界与并发锁");
  await page.getByLabel("审核附件").setInputFiles([
    { name: "review-evidence.png", mimeType: "image/png", buffer: Buffer.from("fake png for upload") },
    { name: "remove-me.txt", mimeType: "text/plain", buffer: Buffer.from("remove before submitting") },
  ]);
  await expect(page.getByText("review-evidence.png", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "移除附件 remove-me.txt" }).click();
  await page.getByRole("button", { name: "开始再审" }).click();
  await expect(page.locator(".collab-card.st-running")).toContainText("独立只读审核");
  await stepDetails.locator(":scope > summary").click();
  await page.getByRole("button", { name: "作者补充意见" }).click();
  await expect(page.locator(".collab-modal")).toContainText("第02轮/00-作者补充意见.md");
  await page.locator(".collab-modal-head .collab-icon-btn").click();
  await page.getByRole("button", { name: "本轮改动清单" }).click();
  await expect(page.locator(".collab-modal")).toContainText("第02轮/本轮改动清单.md");
  await page.locator(".collab-modal-head .collab-icon-btn").click();

  // 4. IDEA Compact Toolwindow Layout (?ide=1)
  await page.setViewportSize({ width: 520, height: 860 });
  await page.goto("https://entry.test/?ide=1");
  const ideaEntry = page.locator(".collab-entry-btn:visible").first();
  await expect(ideaEntry).toBeVisible();
  await expect(ideaEntry).toContainText("多Agent模式");
  await ideaEntry.click();
  await expect(page.locator(".collab-shell")).toBeVisible();
  await page.getByRole("button", { name: /运行列表/ }).first().click();
  await page.locator(".collab-run-item", { hasText: "重构流式控制块过滤器" }).click();
  await expect(page.locator(".collab-card").first()).toBeVisible();
  if (screenshotDir) {
    await page.screenshot({ path: path.join(screenshotDir, "03-idea-toolwindow.png") });
  }

  // 5. Real iPhone App / Dynamic Island Safe Area (59px top, 34px bottom) + Top Header 多Agent模式
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("https://entry.test/?device=phone");
  await page.evaluate(() => {
    const s = document.documentElement.style;
    s.setProperty("--mindfs-safe-area-top", "59.00px");
    s.setProperty("--mindfs-safe-area-bottom", "34.00px");
    window.dispatchEvent(new CustomEvent("mindfs:safe-area-updated"));
  });
  await page.locator(".remote-phone-chat-header").getByRole("button", { name: "项目", exact: true }).click();
  await page.locator(".remote-phone-nav").getByRole("button", { name: "更多" }).click();
  await page.getByRole("button", { name: /Agent 状态框流光/ }).click();
  const phoneGlowSettings = page.getByRole("dialog", { name: "Agent 状态框流光" });
  await phoneGlowSettings.getByRole("switch").click();
  await phoneGlowSettings.getByRole("button", { name: "完成", exact: true }).click();
  await page.locator(".remote-phone-nav").getByRole("button", { name: "对话", exact: true }).click();

  // Directly visible in Phone chat top header without opening Sessions first!
  const phoneEntry = page.locator(".remote-phone-chat-header .collab-entry-btn");
  await expect(phoneEntry).toBeVisible();
  await expect(phoneEntry).toContainText("多Agent模式");
  const phoneEntryBox = await phoneEntry.boundingBox();
  assert.ok(phoneEntryBox && phoneEntryBox.y >= 59, `phone entry y=${phoneEntryBox?.y} must clear Dynamic Island 59px`);
  if (screenshotDir) {
    await page.screenshot({ path: path.join(screenshotDir, "04a-phone-chat-top-entry.png") });
  }

  await phoneEntry.click();
  await expect(page.locator(".collab-shell")).toBeVisible();
  const phoneProjectSelect = page.locator(".collab-project-bar select");
  await expect(phoneProjectSelect).toBeVisible();
  await expect(phoneProjectSelect).toHaveValue("proj-1");
  const phoneProjectSelectBox = await phoneProjectSelect.boundingBox();
  assert.ok(
    phoneProjectSelectBox && phoneProjectSelectBox.width >= 44 && phoneProjectSelectBox.height >= 44,
    `mobile project select must be >=44x44 touch target: ${JSON.stringify(phoneProjectSelectBox)}`,
  );

  // Verify CollabShell header & App-standard buttons clear Dynamic Island (59px) and have 44px touch targets
  const paneHeadBox = await page.locator(".collab-pane-head").boundingBox();
  const backSingleBox = await page.getByRole("button", { name: "返回单聊" }).first().boundingBox();
  const runListBtnBox = await page.getByRole("button", { name: "运行列表" }).boundingBox();
  assert.ok(paneHeadBox && paneHeadBox.y >= 58.5, `collab-pane-head y=${paneHeadBox?.y} must clear Dynamic Island 59px`);
  assert.ok(backSingleBox && backSingleBox.y >= 58.5 && backSingleBox.height >= 44, `mobile back button must clear Dynamic Island and be >=44px tall: ${JSON.stringify(backSingleBox)}`);
  assert.ok(runListBtnBox && runListBtnBox.width >= 44 && runListBtnBox.height >= 44, `run list icon must be 44x44: ${JSON.stringify(runListBtnBox)}`);

  // Verify Template Modal clears Dynamic Island (59px) & Home Indicator (34px)
  await page.getByRole("button", { name: "全局模板" }).click();
  const modalBox = await page.locator(".collab-modal").boundingBox();
  assert.ok(
    modalBox && modalBox.y >= 59 && modalBox.y + modalBox.height <= 844 - 34 + 1,
    `template modal must clear safe areas: ${JSON.stringify(modalBox)}`,
  );
  await page.locator(".collab-modal-head .collab-icon-btn").click();
  await expect(page.locator(".collab-modal")).toHaveCount(0);

  // Verify mobile drawer (.collab-sidebar) clears Dynamic Island (59px) & Home Indicator (34px)
  await page.getByRole("button", { name: "运行列表" }).click();
  const sbTopBox = await page.locator(".collab-sb-top").boundingBox();
  const sbFootPaddingBottom = await page.locator(".collab-sb-foot").evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
  assert.ok(sbTopBox && sbTopBox.y >= 58.5, `drawer top y=${sbTopBox?.y} must clear Dynamic Island 59px`);
  assert.ok(sbFootPaddingBottom >= 43, `drawer footer paddingBottom=${sbFootPaddingBottom} must include 34px Home Indicator`);

  await page.locator(".collab-run-item", { hasText: "独立复核按钮验证" }).click();
  await expect(runningCard).toBeVisible();
  await expect(page.locator(".collab-run-models").getByText("全权限", { exact: true })).toBeVisible();
  assert.ok((await quickModels.boundingBox()).height <= 50);
  const permissionBox = await page.locator(".collab-run-models").getByText("全权限", { exact: true }).boundingBox();
  assert.ok(permissionBox && permissionBox.x + permissionBox.width <= 390, "phone permission label must fit inside the screen");
  await expect.poll(async () => (await readGlow(runningCard))[0]).toBe("hidden");
  const mobileProgressCheck = runningCard.getByRole("button", { name: "检查进度并继续" });
  await expect(mobileProgressCheck).toHaveCSS("width", "44px");
  await expect(mobileProgressCheck).toHaveCSS("height", "44px");
  if (screenshotDir) {
    await page.screenshot({ path: path.join(screenshotDir, "04b-phone-running-glow-off.png") });
  }
  await page.getByRole("button", { name: "运行列表" }).click();
  await page.locator(".collab-run-item", { hasText: "重构流式控制块过滤器" }).click();
  await expect(page.locator(".collab-workspace")).toHaveAttribute("data-mode", "stacked");
  await expect(page.locator(".collab-workspace")).toHaveAttribute("data-level", "cards");
  if (screenshotDir) {
    await page.screenshot({ path: path.join(screenshotDir, "04-phone-cards-layer.png") });
  }

  // Tap the first completed card to enter the full-screen conversation.
  const phoneCards = page.locator(".collab-card");
  const firstStep = phoneCards.first();
  const reviewStep = phoneCards.filter({ hasText: "独立只读审核" });
  const finalStep = phoneCards.filter({ hasText: "修改与测试报告" });
  await expect(firstStep.locator(".collab-tc-status")).toHaveText("已完成");
  await expect(reviewStep.locator(".collab-tc-status")).toHaveText("已完成");
  await expect(finalStep.locator(".collab-tc-status")).toHaveText("已完成");
  const cardHeight = (await firstStep.boundingBox()).height;
  assert.equal((await reviewStep.boundingBox()).height, cardHeight);
  assert.equal((await finalStep.boundingBox()).height, cardHeight);
  await firstStep.getByRole("button").click();
  await expect(page.locator(".collab-workspace")).toHaveAttribute("data-level", "detail");
  await stepDetails.locator(":scope > summary").click();
  await expect(stepDetails.getByRole("button", { name: "01-impl.md" })).toBeVisible();
  await expect(page.locator(".collab-detail-head").getByRole("img", { name: "已完成" })).toBeVisible();
  const detailHeadBox = await page.locator(".collab-detail-head").boundingBox();
  assert.ok(detailHeadBox.height <= 50);
  assert.equal((await page.locator(".collab-detail-title .t").boundingBox()).y,
    (await page.locator(".collab-detail-title .m").boundingBox()).y);
  const backCardsBtn = page.getByRole("button", { name: "返回阶段卡片" });
  await expect(backCardsBtn).toBeVisible();
  const backCardsBox = await backCardsBtn.boundingBox();
  assert.ok(detailHeadBox && detailHeadBox.y >= 58.5, `detail head y=${detailHeadBox?.y} must clear Dynamic Island 59px`);
  assert.ok(backCardsBox && backCardsBox.height >= 44, `back to cards button height=${backCardsBox?.height} must be >=44px`);
  if (screenshotDir) {
    await page.screenshot({ path: path.join(screenshotDir, "05-phone-detail-layer.png") });
  }

  // Tap "返回阶段卡片" -> returns cleanly to Layer 1 cards, then "返回单聊" returns to Phone chat!
  await backCardsBtn.click();
  await expect(page.locator(".collab-workspace")).toHaveAttribute("data-level", "cards");
  await page.getByRole("button", { name: "返回单聊" }).first().click();
  await expect(page.locator(".collab-shell")).toHaveCount(0);

  assert.deepEqual(errors, []);
});
