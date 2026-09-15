---
doc_type: feature-implementation
feature: voice-input
status: implemented
reference: build/design-previews/voice-recording-popover.png
---

## 用户确认

移除输入框中间的 `<>` 图标，换成麦克风；使用用户选中的录音浮层设计。用户明确选择“语音转文字，加入输入框”。不自动发送，保留已有草稿和编辑器右键代码入口。本次未请求提交或发布。

## 实现

- `VoiceRecordingPopover.tsx` 与 `voiceInput.ts`：麦克风、录音计时、真实音量波形、停止识别、Esc/取消、错误与配置入口；portal 跟随输入区上沿，支持窄栏、中英文及深浅主题。
- `TokenEditor.tsx` 与 `ActionBar.tsx`：录音期间锁定输入和发送，保存光标书签；返回普通文本，不将语音中的 `@` 等内容解析成文件引用。原草稿改变或书签失效时保留已有内容并追加结果。
- `VoiceRecorder.kt`：Java Sound 原生采集，16 kHz、单声道、16-bit PCM，内存 WAV，最多两分钟；没有浏览器 Web Speech 或浏览器麦克风兼容依赖。
- `VoiceInputController.kt`：一次操作一个 ID，后台采集/识别，取消关闭采集并中断请求；过滤迟到结果。切换会话、隐藏聊天、页面重载、重连和关闭插件均取消。
- `VoiceTranscription.kt` 与 `VoiceSettings.kt`：独立配置兼容 multipart `/audio/transcriptions` 服务，地址/模型保存 IDEA 配置，API Key 保存 Password Safe；不读取 Agent 登录凭据，不随重定向转发密钥，变更服务地址不会沿用旧服务密钥。
- `AgentToolWindowFactory.kt`：在现有本机同源桥接中添加语音命令，返回状态事件；更多菜单提供服务配置。

local.5 按用户反馈补齐供应商预设：新配置默认腾讯云，旧 local.4 配置迁移为自定义服务，切换时保留各自配置与凭据。腾讯云固定官方地址和 `16k_zh` 默认模型，仅要求 SecretId / SecretKey，通过独立的 TC3-HMAC-SHA256 JSON 接口调用 SentenceRecognition；不复用自定义服务的 Bearer 认证。录音上限随供应商变为腾讯云 60 秒、自定义 120 秒。

配置页内提供注册、服务开通、密钥管理链接和三步说明，并展示“一句话识别每月免费 5,000 次（成功识别次数），个人日常使用通常足够”，附官方额度/计费链接。额度已于 2026-09-15 核对官方文档，超额按账号设置计费或停服。

官方依据：
- https://cloud.tencent.com/document/api/1093/35646 — SentenceRecognition 默认地址、16k_zh、60 秒、Base64 后 3 MB、DataLen 原始字节数。
- https://cloud.tencent.com/document/api/1093/35641 — TC3 签名。
- https://cloud.tencent.com/document/product/1093/54362 — 注册认证、开通和获取密钥流程。
- https://cloud.tencent.com/document/product/1093/35686 — 每月 5,000 次免费额度及计费。

## 验证

- Kotlin/IDEA 测试共 40 项通过，新增 7 项覆盖音量、无配置不采集、停止识别、取消丢弃迟到结果、真实本机 HTTP multipart、认证错误、拒绝重定向与接口地址约束。未调用真实麦克风或外部语音服务。
- 浏览器/桥接/输入箭头回归共 33 项通过，覆盖原光标插入、草稿保留、原生代码/文件上下文、服务未配置、认证失败、取消、切换会话、隐藏聊天以及桥接未就绪不排队启动麦克风。
- 已检查 375px 中文浅色和 900px 英文深色浮层。发现并修复 portal 背景/主题与定位，补充实际背景色断言；波形由采集音量驱动，不使用随机动画。
- TypeScript 检查、插件构建、完整运行时/App smoke 通过。Plugin Verifier 对 IC/IU 2024.1、2024.2、2024.3 均兼容；检查发现的密码凭据旧构造器已改用同样兼容 2024.1 的新构造器。最终证据见 `build/reports/voice-*.log`。

## 验证边界

自动化采用录音替身、本机 HTTP 服务和真实组件。未进行安装后的 IDEA 麦克风权限、设备采集与指定供应商的真人语音端到端验收；当前机器的 IDEA 主程序包含 NSMicrophoneUsageDescription。现有其他未提交的代码改动保留，不在本功能中提交或发布。

## local.5 修复验证

新增腾讯云测试覆盖独立 Python 向量核对 TC3 签名、固定地址/模型与数据长度、原生响应/认证/开通错误、旧自定义配置迁移、两项密钥即可通过表单、供应商切换保留草稿、四个官方链接和免费额度说明、60 秒录音上限事件。使用实际 Swing 配置表单渲染 `build/reports/tencent-voice/settings-tencent.png`。测试没有使用真实腾讯云凭据或发起付费识别请求。

构建与回归日志为 `build/reports/tencent-voice-*.log`。新的 Windows x64 本地测试包为 `0.1.22-local.5`，不提交、不推送、不创建 Release。

## local.6 常驻配置与录音测试

用户已确认：插件设置页常驻“语音输入 → 配置与测试”，录音浮层始终提供齿轮，原生更多菜单与首次未配置提示复用同一窗口。打开窗口前取消聊天录音并清除前端插入书签，防止旧结果写入草稿；重复点击不会重复打开配置窗口。

`VoiceTestPanel` 使用独立的 `VoiceInputController`，复用真实采集和供应商识别适配器，使用当前未保存表单的配置快照。测试结果仅显示在窗口中，测试期间禁用供应商表单和保存；支持停止识别、取消、认证/开通/设备/额度等错误提示。关闭窗口会停止测试并丢弃迟到结果。表单内容可滚动，测试控件固定可见。保存和测试独立，旧配置与密钥保持原有存储方式。

新增测试覆盖未保存配置快照、供应商密钥隔离、修改地址不复用密钥、录音停止与结果显示、输入校验、认证失败、取消/关闭丢弃迟到结果、测试区域可见性，以及真实 Web 设置页重开、齿轮与原生菜单取消聊天录音。日志：`build/reports/voice-settings-native.log`、`build/reports/voice-settings-web.log`；截图：`build/reports/voice-settings/dialog-content.png`、`build/reports/voice-input/persistent-settings.png`。未使用真实麦克风或腾讯云账号，设备权限和真人识别由 Windows 本地包继续验收。

最终 52 项 Kotlin 测试和 31 项 Web/桥接测试全部通过，TypeScript 检查通过；Windows x64 构建及 IC/IU 2024.1、2024.2、2024.3 六组 Plugin Verifier 均兼容（2024.3 有原有 CredentialAttributes 弃用提示）。最终构建日志 `build/reports/voice-settings-final.log`。包 `build/local-packages/idea-ai-agent-0.1.22-local.6-windows-amd64.zip` 已核对版本、PE x64、原生类和 Web 入口，SHA-256：`5bc12088bc5591eba923ce90b691482ac62f506015b27f9db92861d53173bb68`。仅生成本地测试包，未提交、推送或创建 Release。

## local.7 硅基流动预设

用户确认硅基流动免费政策并要求接入。官方价格页数据中 `FunAudioLLM/SenseVoiceSmall` 对应 `free-asr-model.online.utf8-bytes`，单价为 `0.000000`；这是计费项，不是 API 模型名。接口依据：https://api-docs.siliconflow.cn/docs/api/audio-transcriptions-post 。价格依据：https://siliconflow.cn/pricing （2026-09-15 核对）。

供应商选择增加硅基流动，地址与模型只读自动带出，用户只需 API Key。独立 Password Safe 条目保存硅基流动密钥，切换供应商保留各自草稿与原有配置；复用 multipart WAV / JSON text 协议和配置中的录音测试。未配置时提示填写密钥，401/403 提示检查密钥、实名认证及模型权限。当前免费说明附官方价格和限流链接，提供注册、实名认证、创建密钥指引，不把计费标识暴露为模型选项。

新增四项原生测试验证固定地址/模型与真实 multipart 请求构造、持久化供应商选择、API Key 必填及密钥草稿隔离、官方链接/中英文免费文案和真实表单渲染。未使用真实账号或外部录音识别请求；接入效果仍需用户填写自己的 API Key 后测试。

local.7 最终验证：56 项 Kotlin 测试、31 项 Web/桥接测试及 TypeScript 检查通过；IC/IU 2024.1、2024.2、2024.3 六组兼容检查通过（2024.3 保留原有 CredentialAttributes 弃用提示）。Mac arm64 本地包已核对架构、版本、硅基流动原生预设与前端错误提示，运行时 HTTP 启动检查通过。日志 `build/reports/silicon-voice-*.log`，产物 `build/local-packages/idea-ai-agent-0.1.22-local.7-macos-arm64.zip`；未提交、推送或发布 Release。

## local.8 录音供应商可见性

用户指出录音时无法得知当前语音服务。经讨论最终范围：输入区保持单独麦克风图标，浮层标题下仅显示供应商名称（硅基流动 / 腾讯云 / 自定义服务），不显示模型，不在麦克风旁增加常驻文字。

原生录音事件携带来自本次配置快照的 provider，不包含模型、地址或密钥；在打开麦克风前返回，录音、识别和出错阶段持续展示。同一次录音供应商不随外部配置变化而改变；重试重新读取配置，迟到的旧录音事件不会覆盖新供应商。配置读取期间和未配置时有明确状态，避免沿用上次名称。

用户实测硅基流动较腾讯云慢且识别效果差，后续以腾讯云作为优先推荐，硅基流动保留可选。此为用户当前使用环境的实测反馈，不把模型开源评测或免费价格当作云服务效果保证。新安装原有腾讯云默认选择保持。

local.8 验证：57 项原生测试、31 项浏览器/桥接测试及 TypeScript 检查通过；检查中文窄栏浅色和英文宽栏深色浮层。六组 IC/IU 2024.1–2024.3 兼容检查通过。Mac M 系列包 `build/local-packages/idea-ai-agent-0.1.22-local.8-macos-arm64.zip` 已核对版本、运行时架构和原生/前端供应商字段。未进行真实语音服务调用，未提交、推送或发布 Release。

## local.9 设置页当前供应商

按用户截图，在设置页“语音输入”区域增加“当前供应商：腾讯云 / 硅基流动 / 自定义服务”，只显示供应商、不显示模型。读取原生已保存选择，空配置显示“未配置”；默认下拉选项与实际保存选择分开，未保存或取消窗口不改变当前供应商。状态展示不读取 Password Safe、不发起服务请求。

桥接首次注入携带非敏感 voiceProvider，加载完成再次同步以覆盖加载期间的配置变更；保存后通过应用消息总线通知所有已打开插件面板，前端立即更新。录音浮层仍使用本次录音的独立配置快照。覆盖首次未配置、桥接延迟、三个供应商切换、取消、重新打开设置和旧自定义配置迁移的测试。

local.9 验证：58 项原生测试、33 项浏览器/桥接/语言回归及 TypeScript 检查通过；深浅主题和窄栏设置区域已检查。六组 IC/IU 2024.1–2024.3 兼容检查通过。Mac M 系列包 `build/local-packages/idea-ai-agent-0.1.22-local.9-macos-arm64.zip` 已核对版本、架构、原生通知与前端显示。未提交、推送或发布 Release。


## 0.1.22 正式发布构建（2026-09-16）

用户授权将当前完成代码提交、推送到 main，并发布 GitHub Release，包含四个单平台安装包和一个 Marketplace 通用 ZIP。版本从 0.1.21 升级为 0.1.22，补齐中英文说明、插件 change notes、隐私说明和发布文档。

正式构建验证：Go 全套、179 项前端测试、TypeScript、58 项 Kotlin 测试、完整浏览器冒烟均通过。最终通用 ZIP 对 IC/IU 2024.1–2024.3 六目标兼容；2024.3 仍有 CredentialAttributes 构造器弃用提示。五个安装包核对版本、公共文件一致性、原生 CPU、ZIP 完整性与 SHA-256。其他平台仅交叉编译验证，未进行真实语音 API 调用。具体证据见 `docs/validation.md`，下载与功能说明见 `docs/releases/v0.1.22.md`。
