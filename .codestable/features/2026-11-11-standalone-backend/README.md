# 独立后端计划与进度

## 当前状态（2026-11-19）

- **独立后台 0.1.51** 已成为默认安装版本，修复手机键盘弹出后遮住远程对话输入框的问题。Mac 节点经 iPhone 实机验收，六个平台共 24 个附件已发布并回读核验。0.1.50 Release 已下架，Git 标签保留。Hostdzire-linux 节点待升级。[正式版](https://github.com/zhuxian89/idea-ai-agent/releases/tag/standalone-v0.1.51)
- **IDEA 插件 0.1.27** 已在 GitHub 同版本更新四个平台和通用包。内置后台及远程网页更新已随包发布。已安装 0.1.27 的用户需从磁盘重装并重启 IDEA。[插件下载](https://github.com/zhuxian89/idea-ai-agent/releases/tag/v0.1.27)
- **IDEA 插件 0.1.28-local.1 macOS arm64 本地测试包**已安装到本机。最终 ZIP 的内置后台通过启动、旧会话和网页资源验证。本机实测切到内置模式及切回独立模式后，均能从远程网页发送消息。[插件 ZIP](../../../build/local-packages/idea-ai-agent-0.1.28-local.1-macos-arm64.zip)
- **0.1.49 macOS arm64 本地测试包**将手机呼吸点换成 Agent 状态框的边框流光。「更多 → 外观」提供与网页相同的开关、四种效果、配色、自定义颜色、速度、预览与恢复默认。最终包通过 Chrome 和 WebKit 手机视口验证。本机已升级，原地址、7 个项目与网页资源验证通过。用户确认手机流光试用通过。[安装包](../../../build/standalone/0.1.49/local-ai-agent-0.1.49-macos-arm64.sh)
- **0.1.48 macOS arm64 本地测试包**给手机输入框上方的 Agent 状态栏加入呼吸点。活动状态为工作时播放，开启系统减少动态效果时显示静态点。本机已升级，原地址、7 个项目和随包网页资源验证通过。手机消息已正常送达，待确认 iPhone 上的动效表现。[安装包](../../../build/standalone/0.1.48/local-ai-agent-0.1.48-macos-arm64.sh)
- **0.1.47 macOS arm64 本地测试包**将电脑和平板的「手机扫码连接」和「从公网访问」改为中性色细描边入口。扫码继续指向当前页面。通过隔离安装和相关浏览器回归，本机部署见 `build/reports/standalone-0.1.47-live-upgrade/result.txt`。[安装包](../../../build/standalone/0.1.47/local-ai-agent-0.1.47-macos-arm64.sh)
- **0.1.46 macOS arm64 本地测试包**将手机「更多」的设置集中展开，主题、语言、排序、设备类型和开关可直接操作，需要输入的操作直接打开对应表单。手机用输入框上方的活动状态，边框呼吸灯用于电脑和平板。通过 Chrome、WebKit 和隔离升级验证，待 iPhone Safari 实机试用。本机部署结果见 `build/reports/standalone-0.1.46-live-upgrade/result.txt`。[安装包](../../../build/standalone/0.1.46/local-ai-agent-0.1.46-macos-arm64.sh)
- **0.1.45 macOS arm64 本地测试包**加入手机网页全屏对话、会话卡片、快速切换、项目导航、设备选择及授权底部面板。Chrome 和 WebKit 的触屏窗口验证通过，待 iPhone Safari 实机验收。本机部署见 `build/reports/standalone-0.1.45-live-upgrade/result.txt`。[安装包](../../../build/standalone/0.1.45/local-ai-agent-0.1.45-macos-arm64.sh)
- **0.1.44 macOS arm64 本地测试包**将顶栏 Agent 配置入口改为居中弹窗，文件栏收起时也可使用。最终包通过隔离升级，本机上线后用户反馈网页和平板正常。[安装包](../../../build/standalone/0.1.44/local-ai-agent-0.1.44-macos-arm64.sh)
- **0.1.43 macOS arm64 本地测试包**修正远程网页三栏底色、普通窗口底边和文件菜单裁切。隔离安装与本机升级通过，原地址可读取 7 个项目。[安装包](../../../build/standalone/0.1.43/local-ai-agent-0.1.43-macos-arm64.sh)
- **0.1.42 macOS arm64 本地测试包**已在本机升级成功。原地址可访问，7 个项目可读取。升级结果见 `build/reports/standalone-0.1.42-live-upgrade/result.txt`。远程桌面和平板增加会话卡片、顶栏常用操作和默认开启的工作状态呼吸灯。已在隔离安装中验证从 0.1.41 升级、读取原项目与会话、更新失败恢复。手机新外壳和设备手动指定安排在第二批。[安装包](../../../build/standalone/0.1.42/local-ai-agent-0.1.42-macos-arm64.sh) · [验证记录](standalone-backend-implementation.md#远程网页第一批与-macos-0142-本地测试包)
- 独立后台与插件独立发版。发包流程、验证门槛和“只保留一个正式版”的规则见根目录 [AGENTS.md](../../../AGENTS.md) 的《独立版发包规则》。
- 0.1.39 包含：Agent 配置按 Agent 导出与导入、Linux `-bind` 与安装后显示绑定链接、Linux systemd 开机自启、不同目录同名项目、远程单文件 HTML 预览、Codex 刷新自动升级、完整重启，以及安装与升级失败后的自动恢复。验证证据见 [implementation](standalone-backend-implementation.md)。

## 已确认的约束

- 独立优先只作用于远程模块。远程停止、启动失败或认证失败，只影响远程功能；插件界面、聊天和其他本地功能继续工作。
- 一个多项目入口，继续使用当前界面和动态表情。关闭 IDEA 后仍可通过现有 Relay 使用。
- 未安装独立版时保留原插件内置后端。独立版可选安装，远程面板检测服务后提供一键安装入口。独立版只提供后台程序和脚本安装升级，不增加桌面应用或图形安装器。
- 聊天与附件原位读取，保留项目 `.mindfs` 和 home 元数据、旧远程清单、Relay 绑定及历史配置。同一目录只注册一次。
- 聚焦当前功能，不恢复钱包、充值或任务看板。
- 网页资源随各自安装包发布，不依赖 Relay 部署相同版本的前端，见 AGENTS.md。

## 待验证与待决定

- Windows 实机：全新安装的计划任务、登录自启和重启接入。GitHub Actions 已在 Windows PowerShell 5.1 验证包内安装脚本、计划任务注册、升级与失败恢复，但不含真实登录。
- Linux 真机：用 0.1.39 复跑 systemd 开机自启。macOS amd64、Linux amd64、Windows ARM64 只核对了架构。
- Codex 刷新自动升级和独立后台完整重启：自动化与隔离验证通过，真实升级刷新与 IDEA 多项目重连待用户验收。
- 聊天运行时与远程包的资源及生命周期隔离方案待确认：当前升级仍会停止共享 Core，且必须同时保证远程故障不影响本地聊天、IDEA 关闭后远程继续可用。不采用未经批准的项目抢锁和远程只读限制。
- 远程频繁重连排查已暂停：已有前台故障心跳未到 Core、本机控制心跳正常的证据，连接器与上游传输尚未区分，根因未定案。
- Antigravity 登录后完整对话、工具调用及权限确认的自动化验证待补充。
- 真实后台和插件的安装、升级与重启由用户操作，不用手动脚本绕过面板升级验收。

## 接手约定

先读本入口，再读 [checklist](standalone-backend-checklist.yaml) 与 [设计](standalone-backend-design.md)。每个步骤和失败都同步记录；代码、测试、包、发布分别报告，后续代码有改动时重新标明待验证范围。

不动 `.lithe/`，不使用 `git add .`；新增源码和测试须显式加入 Git，防止 `commit -a` 漏掉依赖。
