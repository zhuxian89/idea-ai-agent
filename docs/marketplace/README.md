# Marketplace 素材预览

状态：**方向与节奏预览，不是完整实录，不直接发布。**

打开 `index.html` 查看中英双语首屏、可暂停的视频和 GIF 下载。

## 交付物

- `preview/hero-en.png` / `hero-zh.png`：1280×800 首屏。
- `preview/workflow-en.gif` / `workflow-zh.gif`：约 24 秒循环演示。
- 同名 `.mp4`：有播放控制的低体积预览版本。
- `description-draft.html`：英文优先、中文随后；移除“配置、重启”主卖点，强调原生 Agent、语音、附件和固定快照。

## 内容与真实性

使用当前源码的 `IdeaWorkbench`、`ActionBar`、`SessionTabs`、`SessionViewer`、`VoiceRecordingPopover` 和 `TurnDiffSummary`，不画一套假插件 UI。品牌图标来自仓库 `pluginIcon.svg`。

演示项目为虚构的邮箱校验例子。会话和语音均为预设数据；没有真实录音，没有调用 Agent 或语音供应商，没有读取用户会话。图内保留 DEMO PREVIEW 标识。语音确实通过现有组件进入草稿；附件通过实际文件输入加入。最后真实触发组件的固定快照 `compareTurnDiff` 桥接，由演示环境拦截并验证参数；没有真实打开 IDEA Diff，原生窗口需最终实录补齐。不得把这个预览说成端到端实录或性能证明。

## 时间线

| 时间 | 画面 |
| --- | --- |
| 0–2 秒 | 主卖点与修改文件 |
| 2–5 秒 | 语音波形（预设事件） |
| 5–7 秒 | 识别文字进入草稿，不自动发送 |
| 7–10.5 秒 | 添加验收说明附件 |
| 10.5–13.5 秒 | 示例 Agent 回复 |
| 13.5–15 秒 | 本轮修改默认折叠 |
| 15–20 秒 | 点击展开文件与回合差异 |
| 20–24 秒 | 触发 IDEA 原生 Diff 入口，注明待补实录 |

## 复现

需要现有前端依赖、Playwright CLI 技能和 `ffmpeg`。

1. 在 `runtime/web` 执行 `corepack pnpm exec vite --host 127.0.0.1 --port 5188`。
2. 在仓库根目录执行 `~/.codex/skills/playwright/scripts/playwright_cli.sh -s=marketplace open`。
3. 执行 `node scripts/render-marketplace-preview.mjs`。
4. 结束后用同一 CLI 执行 `-s=marketplace close`，停止本次 Vite。

帧图与编码时间线在 `output/playwright/marketplace/`。脚本检查语音草稿、附件、默认折叠、快照桥接参数和图片加载。演示入口仅位于 `tests/fixtures`，没有被生产应用引用。

## 发布前

- 用户确认文案、首屏和节奏。
- 在干净示例项目中录制真实语音、Agent 修改和 IDEA 原生 Diff；替换演示片段，移除预览标识。
- 补充无动画的静态截图，GIF 不作为唯一信息来源。
- 将已确认文案同步到对应发布版本的 `plugin.xml` 与 Marketplace 文案文件；不提前修改旧版公开页面。
- 检查当时的 Marketplace 图片/GIF 支持、大小与尺寸要求，再上传；当前仅本地产出。
