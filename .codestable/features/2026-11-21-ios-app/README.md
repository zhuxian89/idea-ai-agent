# iOS App 计划与进度

## 当前状态（2026-11-21）

- **iOS 正式包 0.1.6（构建 7）已生成。** 正式 IPA 与 iOS 17 真机试用包逐字节相同，未签名，供巨魔安装。已核对 arm64、最低 iOS 16.0、Bark 跳转用的 `localaiagent` URL Scheme 和 SHA-256。43 个单元测试和 13 个 UI 测试通过，涵盖 Bark 链接的冷启动与已打开 App 两种情况。旧库迁移及 race 检查通过。iOS 17 真机的状态栏显示问题暂缓。[正式 IPA](../../../build/ios/release/0.1.6/LocalAIAgent-0.1.6.ipa) · [SHA-256](../../../build/ios/release/0.1.6/LocalAIAgent-0.1.6.ipa.sha256)
- **独立后台 0.1.59 macOS arm64 本地测试包已生成。** 手机对话顶栏使用三横线和单行标题，快速切换直接列出跨项目会话。整包验证与本机部署结果见独立后台交接。[独立后台计划与进度](../2026-11-11-standalone-backend/README.md)

## 早期实现记录

**实现中（2026-11-21，用户已确认开始写代码）。** 状态分开记录：

- **节点后台 Bark 推送：源码完成，自动化测试通过，已打本地测试包 0.1.53（macOS arm64，未安装），未提交，未真机验证。** 新增 `runtime/server/internal/barknotify`、`internal/api/http_bark.go`
  （`GET`/`PUT /api/bark`、`POST /api/bark/test`），事件接入在 `internal/api/appcontext.go`（会话终态、提问与审批、定时任务；会话报错后的完成事件按失败发送）。
  验证：`go vet ./...` 无输出；`go test ./... -count=1` 全部通过；barknotify 与 api 新增用例另跑过 `-race`。
  旧库迁移：Bark 设置是独立 JSON 文件，不涉及数据库表结构，未触及 `kanban` 迁移；打包前按规定另跑了 `go test ./server/internal/kanban` 与 `-race TestTaskStoreSnapshotMigration`，均通过。
  修改与测试推送要求经 Relay 的请求带有与 Relay 主机一致的浏览器来源（`internal/api/http_bark.go`，已补测试）。
- **网页「更多 → 通知 → Bark 推送」与 iOS 标记：源码完成，类型检查与 3 个 Playwright 用例通过，已随 0.1.53 测试包构建（包内网页 305 个文件，无 `/mindfs-assets/` 引用，含 Bark 界面），未真机验证。**
  `isIOSAppRuntime()`（`window.MindFSIOSApp.platform === 'ios'`）只用于隐藏 Web Push 与“添加到主屏幕”、并让 `isStandaloneDisplayMode` 为真；
  键盘与视口仍走 Safari/PWA 路径。
- **PRIVACY.md：已写明 Bark 数据流向。**
- **iOS App（`ios/`）：源码完成，模拟器验证通过，未经任何真机验证。** Swift + WKWebView，加载 `https://relay.20260310.best/nodes`，无 Capacitor、无推送能力。
  - 模拟器验证（仅 iOS 27.0，iPhone 18 Pro，Xcode 27.2）：43 个单元测试与 11 个 UI 测试全部通过（`build/ios/SafeAreaRegression-*.xcresult`，此后又新增 1 个 UI 测试）。
    覆盖：`confirm`/`alert`/`prompt`、真实文件、`Content-Disposition` 与 `blob:` 下载并弹分享面板、空白弹窗后 `location.replace`、`window.close()`、外部 `_blank`、断网覆盖层与重试、深链冷启动/回前台/拒绝其他主机、安全区策略。
  - 安全区：Relay 自带页面（登录、节点、绑定，不声明 `viewport-fit=cover`）按安全区缩进；节点页铺满，并向页面写入 `--mindfs-safe-area-top/bottom`。
    用声明 `viewport-fit=cover`、按网页同款表达式布局的夹具页，在带灵动岛的模拟器上截图确认：顶栏内容在灵动岛下方（62px），底部标签栏在 Home 指示条上方（34px），背景铺到屏幕边缘。**真机未验证。**
  - **未签名 IPA 已生成（0.1.2，构建 3）**：`build/ios/LocalAIAgent-0.1.2-unsigned.ipa`（SHA-256 `ccde6c352f16…`，构建后未改源码）。0.1.0、0.1.1 旧包已删除。
    0.1.2 在 0.1.1 基础上修复首次进入时底部空白（见“第二轮真机反馈”）。最近一次回归：43 个单元测试与 12 个 UI 测试全部通过（`build/ios/StartupViewportRegression-*.xcresult`）。
    已核对：arm64、最低 iOS 16.0、Bundle ID `com.localaiagent.app`、URL Scheme、相机/麦克风说明齐全，无签名、无描述文件、无推送权限。
  - **待用户真机验证（均未验证）**：签名工具能否安装并正常启动；iOS 17 与 iOS 16 上的键盘弹出、安全区、返回手势；相机与相册上传；登录状态能否保留；Bark 通知点击后能否进入签名后的 App 原会话；`blob:` 下载在 iOS 16/17 的行为（模拟器只证明了 iOS 27）。

HTML 原型使用示例数据演示界面与交互。方案的实机验证安排见下文。

开发语言用 Swift，最低系统版本 iOS 16，工程放本仓库 `ios/`。首版用 Bark 接收锁屏通知，按类型配置提醒。锁屏显示项目名、会话标题和一行摘要。

首版交付 IPA，由用户通过现有签名工具安装。用户没有付费 Apple 开发者账号。验收以 iPhone 锁屏收到 Bark 通知并打开签名后的 App 原会话为准。

iOS 17 是主用和优先验收系统，iOS 16 保持核心流程兼容。界面和流程见 [可点击的 HTML 设计稿](ios-app-design.html)，待用户确认。

## 真机反馈与处理（2026-11-21，iOS 17 真机，截图 `.mindfs/upload/2026-11-21/IMG_1234.PNG`）

| 反馈 | 原因 | 状态 |
|---|---|---|
| 1. 没有考虑灵动岛 | 网页用 `var(--mindfs-safe-area-top, env(safe-area-inset-top))` 做顶部和底部留白，但 `index.css` 把 `--mindfs-safe-area-top/bottom` 恒定义为 `0px`，`env()` 永远用不上；只有 Android 壳会通过 `mindfs:safe-area-updated` 事件写入这两个变量。iOS 壳铺满屏幕却没有写入，所以顶栏压在灵动岛下、底部标签栏被 Home 指示条遮住。 | **已修复（源码），模拟器验证，真机待验证。** 壳按 Android 同一约定写入变量并派发事件；横屏时 WebView 左右按安全区缩进。已有节点的旧网页也按这个约定读取，无需升级网页。 |
| 2. 设置里上面的版本检测错误（`TypeError: Load failed`） | **未定位到 App 侧原因。** 网页在浏览器里直接请求 `api.github.com` 与 `raw.githubusercontent.com`。在 App 的 WKWebView 里（模拟器，非 Relay 登录页来源）两个请求都返回 200；Mac 上两者都可达并带 `access-control-allow-origin: *`。Relay 的登录、节点页自带 `connect-src 'self'` 的内容安全策略，会让这两个请求失败，但真机显示的是节点页，节点页没有这条策略。 | **未修复，原因待确认。** 最可能是这台 iPhone 在 App 里连不上 GitHub。需要用户在同一部手机同一网络下用 Safari 打开同一节点页，对比是否也失败。 |
| 3. 「更多 → 通知」里没有 Bark 推送 | 截图里仍是旧页面：“开启通知 / 当前浏览器不支持 Web Push”和“添加到主屏幕”都在。网页资源随节点后台发布，已安装的节点是 0.1.52，不含这次的网页改动。 | **已有本地测试包 0.1.53（macOS arm64），未安装。** 路径 `build/standalone/0.1.53/`，tar.gz 与自解压 `.sh` 的校验均通过。安装会升级用户正在运行的节点。**用户已同意本机先装 0.1.53（2026-11-21）**；已用 launchd 独立任务排程升级，失败自动回滚到官方 0.1.52 包（已下载并校验，二进制与现装版本一致）。预检通过（0.1.52，`http://127.0.0.1:7441`，7 个项目）。**升级是否成功以 `build/reports/standalone-0.1.53-live-upgrade/result.txt` 为准，写本条时尚未核实。** |

### 第二轮真机反馈（2026-11-21，截图 `IMG_1235.PNG`）

| 反馈 | 原因 | 状态 |
|---|---|---|
| 第一次进入时底部留出大片空白，像没识别到手机高度 | 壳在 Relay 自带页面（缩进安全区）与节点页（铺满）之间切换缩进模式，原来在页面提交之后才切。WebKit 报告的视口要扣除这些缩进，所以新页面加载瞬间读到的 `innerHeight` 是 778（= 874 − 灵动岛 62 − Home 指示条 34），网页用它算出根高度，底部就空出约 96pt。模拟器上随后会补发一次 `resize` 自动恢复，空白留不住；真机截图显示 iOS 17 上没有恢复。 | **已修复（源码），模拟器验证，iOS 17 真机待验证。** 改为在导航发出前就切好模式（含启动加载与深链）。同一夹具页修复前加载瞬间读到 778，修复后三次运行都是 874，且不再依赖 `resize`。新增 UI 测试 `testNodePageStartsWithTheFullViewportAfterAnInsetPage`。 |
| 设置里「检查更新」仍报 `TypeError: Load failed` | 手机上的检查由浏览器直连 GitHub。模拟器里同一请求（来自真实节点页来源）返回 200；这台 Mac 的 GitHub 域名解析到 `198.18.x.x`，说明它靠本机代理（Clash）才连得上，手机多半没有。**仍是推断，未在手机上证实。** | **已改为由节点查询（源码，自动化测试通过，未真机验证）；已打本地测试包 0.1.54（macOS arm64，`build/standalone/0.1.54/`，校验通过，包内含新接口与新网页）。用户已同意本机升级到 0.1.54（2026-11-21），已用 launchd 独立任务排程，失败自动回滚到 0.1.53；预检通过。升级是否成功以 `build/reports/standalone-0.1.54-live-upgrade/result.txt` 为准，写本条时尚未核实。** 新增 `GET /api/standalone/latest`，页面先问节点；旧节点没有这个接口（404）才回退到浏览器直连；节点查询失败则显示节点报告的真实原因，不再用第二个来源掩盖。节点 0.1.52 及更早没有这个接口，所以要升级节点后手机才会走新路径。 |

### 第三轮（2026-11-21）：Bark 通知内容太单薄

- 0.1.54 升级已成功（`result.txt`：0.1.54 installed and verified，7 个项目可读取）。用户反馈“都测试通过了”，随后问 Bark 通知是否只有标题。
- 核实结果：通知有标题和正文，但审批类正文只有“谁在请求”（如 `Claude Code 请求执行 Bash：`、`Codex 请求授权：commandExecution`），看不出要批准什么；
  “任务完成”取的是最后一条回复末尾 600 字的前 120 字，是中间一截而不是结论。
- 修复（源码，自动化测试通过，**未真机验证，未安装**）：审批在第一行后附最能说明操作的那一个参数的预览（命令取第一行，其余参数不发，最多 80 字）；
  完成改为取最后一条回复的最后一行；失败保持取开头。`PRIVACY.md` 已同步写明。已打本地测试包 0.1.55（`build/standalone/0.1.55/`，校验通过，未安装；安装需用户再次同意）。
- 这是对此前约定“锁屏只显示一行摘要，完整参数点开再看”的细化，不是放开完整命令：命令仍只发第一行的前 80 字，可能含敏感内容（如带令牌的 curl），用户应知晓。

### 第四轮（2026-11-21）：语言、Markdown、通知效果

- **键盘和附件选择面板是英文（`IMG_1237`）。** 原因已验证：App 的 `CFBundleDevelopmentRegion` 是 `en`，没有声明其他语言，iOS 把它当纯英文 App，
  系统弹出的附件面板（照片图库、拍照、选择文件）按 App 语言显示。模拟器中文系统下，修复前 `Bundle.main.preferredLocalizations = ["en"]`，修复后 `["zh-Hans"]`；英文系统下仍为 `en`。
  做法：`CFBundleDevelopmentRegion: zh-Hans`、`CFBundleLocalizations: [zh-Hans, en]`，权限说明放进 `zh-Hans.lproj`、`en.lproj` 的 `InfoPlist.strings`。
  **键盘是否因此变中文：推断，未验证**（iOS 按 App 语言挑起始键盘，但模拟器里测不了），附件面板文字也待真机确认。
- **Bark 效果（`IMG_1237`、`IMG_1238`）。** 真机收到的完成通知正文以“……。”开头，是回复中间一截，且带原样反引号（0.1.54 的行为，已在 0.1.55 之后的源码修正）。
  Markdown 样例推送（真机 `IMG_1238`）证明：Bark 认 `markdown` 参数，横幅上去掉了加粗和代码围栏的符号，保留换行，命令单独一行；没有加粗或等宽样式；
  横幅只显示前几行（样例里的列表和引用没露出）。传了 `markdown` 后 `body` 被忽略。
- **据此的改动（源码，自动化测试通过，未装，未真机验证）：** 审批通知同时发 `body`（纯文字，老版本 Bark 的后备）和 `markdown`（状态行加粗、命令放代码块，围栏自适应命令中的反引号；
  工具名含 `_`、`*` 等会被误读的符号时不发 `markdown`）；其余通知保持纯文字，但正文里的反引号、加粗、标题、列表、链接符号已去掉。
- **前台时是否有横幅：** 通知属于 Bark 而不是本 App，在本 App 前台时横幅照常出现；节点无法得知手机是否正在看这条会话。是否做“手机正连着该会话时不发”待用户决定。
- 本地测试包 0.1.56（`build/standalone/0.1.56/`，校验通过；用其脚本同款环境从当前源码重建，二进制哈希一致）。用户已同意升级（2026-11-21），已用 launchd 独立任务排程，失败自动回滚到 0.1.54；预检通过。**升级是否成功以 `build/reports/standalone-0.1.56-live-upgrade/result.txt` 为准，写本条时尚未核实。**
- **IPA 0.1.3 回归：** 第一次回归 12 个 UI 测试中 2 个失败：弹窗的系统按钮在 App 声明中文后从 “Done” 变成 “完成”（失败时的界面层级里标签就是“完成”），测试写死了英文。已改为同时认两种语言，重跑整套：43 个单元测试与 12 个 UI 测试全部通过（`build/ios/LocalizationRegression3-*.xcresult`）。App 源码在出包后没有再改，只改了测试。0.1.56 升级已核实成功（`result.txt`）。

### 第五轮（2026-11-21）：Bark 消息没有横幅

- 用户反馈：消息没有横幅，在 Bark 里单独测试就有。
- 原因（源码与 Bark 官方文档核实）：“任务完成”用的是 `level: passive`，文档写明 `passive` 只加入通知列表、不亮屏提醒，所以没有横幅；
  Bark 自带测试用默认的 `active`，所以有。审批和提问是 `timeSensitive`、失败是 `active`，都有横幅。这是实现错误：用户明确打开了“任务完成”却被静默投递。
  未能确认用户当时触发的是哪一类通知；若是审批或提问仍无横幅，另有原因（如 Bark 的专注模式或时效性权限）。
- 修复（源码，自动化测试通过，**未装，未真机验证**）：每个已开启的类型都不再使用 `passive`；新增测试固定各类型的级别。已打本地测试包 0.1.57（`build/standalone/0.1.57/`，校验通过，与当前源码重建的二进制哈希一致）。用户已同意升级（2026-11-21），已用 launchd 独立任务排程，失败自动回滚到 0.1.56；预检通过。**升级已核实成功**（`result.txt`：0.1.57 installed and verified，7 个项目可读取，二进制与网页资源与构建一致；用户确认升级成功）。横幅是否出现待用户真机确认。

### 第六轮（2026-11-21）：键盘空隙、顶栏、状态栏

- **键盘和输入框之间空隙偏大（`IMG_1236`）。** 原因：壳一直向页面写入 `--mindfs-safe-area-bottom: 34px`（Home 指示条），网页用它给输入框留底部空隙；键盘弹出后指示条被盖住，Safari 会把这个值变成 0，壳没有。
  实测约 32pt，与 34 吻合。修复：壳监听键盘，键盘出现时写入 0，收起后恢复（源码）。模拟器验证：数值 34 → 0 → 34（UI 测试 `testBottomSafeAreaIsZeroWhileTheKeyboardIsUp`，关掉键盘检测时该测试失败）。
  **视觉上空隙是否变小未验证**：模拟器是 iOS 27，键盘弹出时页面的滚动方式与 iOS 17 不同，测试页也没有真实网页的键盘处理，量出的屏幕距离不能当证据。
- **左右按钮太显眼、三个控件没对齐（`IMG_1239`）。** 原因：`.remote-phone-icon` 用强调蓝色；标题块是两行网格，下拉小箭头落在第二行，比两侧按钮低 6.5px（测试复现）。
  修复（网页样式，已有 5 个手机壳测试全部通过，含新增的轴线与颜色测试）：两个图标改为次要文字色，按下时变亮；小箭头跨两行垂直居中，与两侧按钮同一条轴线。功能不变。随节点网页发布，需升级节点才生效。
- **灵动岛两侧没有时间和电量。** 所有真机截图的顶部都是空的，配置里没有隐藏状态栏，判断是状态栏文字与页面同色（深色字压在深色页上）。
  现有做法依赖 `preferredStatusBarStyle`，而 App 是 SwiftUI 根控制器嵌入 `UIViewControllerRepresentable`，系统不一定转交这个询问。
  修复：同时按页面颜色设置窗口的界面风格（系统默认状态栏样式随它变化），源码已改。**未验证**：模拟器是 iOS 27，状态栏文字会按页面内容自动变色，复现不了症状，也就无法证明修复在 iOS 17 上有效。
  副作用：键盘、弹窗、分享面板会跟随页面深浅。
- 本轮产物：IPA 0.1.5（`build/ios/LocalAIAgent-0.1.5-unsigned.ipa`，SHA-256 `80a26724861d…`，出包前整套回归通过：43 个单元测试 + 13 个 UI 测试，`build/ios/HeaderRegression-*.xcresult`；未签名、无描述文件、最低 iOS 16.0）。
  节点包 0.1.58（`build/standalone/0.1.58/`，校验通过，与当前源码重建的二进制哈希一致）。用户已长期授权升级独立后台，已用 launchd 独立任务排程（回滚目标 0.1.57），预检通过。
  本机升级已通过校验，原地址可读 7 个项目，二进制与网页资源匹配。[结果](../../../build/reports/standalone-0.1.58-live-upgrade/result.txt)

另发现并处理：Bark 的修改与测试推送原先对经 Relay 转发的任何请求开放。现在要求请求带有与 Relay 主机一致的浏览器来源，跨站页面不能改推送目标或触发推送；本机直接访问不受影响。
这不是账号级权限：节点地址本身仍是访问凭据，与节点其他功能一致，拿到地址的人伪造请求头仍可调用。

### 第七轮（2026-11-21）单行顶栏、快速切换和状态栏

- 对话顶栏的三横线入口靠左，点击区域为 44 × 44 点。会话标题和紧随其后的下拉箭头与两侧按钮垂直居中。文件预览入口用返回箭头。
- 快速切换列出各项目的已加载会话，依次显示等你回答、运行中和其他会话，同类按置顶和最近更新排序。每行显示标题、项目和状态，当前会话以描边及对勾标识。搜索匹配标题、项目和预览。
- `WebViewController` 作为 UIKit 场景的根控制器，按页面颜色选择状态栏前景。iOS 27 模拟器截图可见深色背景的白色时间与电量、浅色背景的黑色时间与电量。冷启动和已打开 App 两种情况下都加载了 Bark 链接指定的地址。键盘弹出时底部安全区归零的回归通过。[iOS 回归](../../../build/ios/UIKitRootRegression.xcresult)
- 最终 IPA 核对通过。arm64、最低 iOS 16.0、`localaiagent` URL Scheme、UIKit 场景入口及未签名状态均符合交付配置。[SHA-256](../../../build/ios/LocalAIAgent-0.1.6-unsigned.ipa.sha256)
- iOS 17 真机复测确认巨魔安装的是 0.1.6。顶部已留出灵动岛安全区，状态栏在深浅主题下都空白（`IMG_1241.jpeg`）。iOS 27 灵动岛模拟器能显示时间和电量，本机未能取得 iOS 17 模拟器运行时，真机原因待定位。按用户反馈暂缓处理。

### 登录保持（2026-11-22）

- Relay 原先为登录 Cookie 和 SQLite 会话设置 12 小时固定有效期。App 0.1.6 在 iOS 27 模拟器重启进程后仍能发送持久 Cookie。已发布的 0.1.59 节点网页还可复现认证查询返回 503 后误跳登录页。
- Relay 源码已为 App 登录启用 30 天不活动期限。每次成功验证后同时续期会话和持久 Cookie，主动退出、改密码或重置密码会撤销会话。继续使用原有 SQLite 表。
- 节点网页在 App 打开页面及回到前台时续期。断线后只在 Relay 认证接口返回 401 时跳转登录页，并保留原地址。Chrome 浏览器回归验证 503、网络失败、前台续期和真实 401 跳转。Relay 全量及登录相关 race 检查通过。
- Relay 登录续期和表单修正已随 `3da43c3c` 上线。公网登录页把 QQ 邮箱标记为系统密码自动填充的账号字段，健康和就绪检查通过。已过期的 App 会话需重新登录一次，跨夜保留待 iOS 17 真机确认。[镜像构建](https://github.com/zhuxian89/mindfs/actions/runs/44940601437)
- 本机节点已更新至 0.1.60-standalone.1。前台续期、断线后的登录跳转判断和移除输入框连接圆点已通过浏览器回归，用户在 iPhone 上确认圆点消失。[本机部署](../../../build/reports/standalone-0.1.60-standalone.1-live-upgrade/result.txt)

## 目标

iPhone 上的正式客户端，地位类似 IDEA 插件：电脑用插件，手机用 App。临时使用仍可打开网页。

核心体验：在 IDEA 发起任务，出门锁屏，收到通知，点开直接进入原会话，回电脑后在同一会话看到结果。

## 已确认的约束（来自用户）

- **只做 iOS。** Android 与鸿蒙壳不做。`mindfs/android`、`mindfs/harmony` 仅作参考，不修改。
- **不做扫码连接。** 用户在网页里把节点绑定到 Relay，App 登录同一账号后自动出现节点。
- **Relay 只有邮箱登录**，没有第三方登录。
- **默认 Relay 地址：** `https://relay.20260310.best/`
- **首版包含锁屏通知。** 用户认为 App 的优势就是通知。
- **不创新功能。** 网页已经成熟，App 只做“兼容”和“必须原生才能实现”的部分。
- 验收标准：可扩展，用户体验最佳。方案由实现方判断取舍，不必照搬用户提出的条目。
- **开发语言 Swift，最低系统 iOS 16，工程放 `ios/`。**
- **锁屏通知显示项目名、会话标题和一行摘要**，并在 `PRIVACY.md` 写明。
- **真机只有 iOS 16 与 iOS 17。** iOS 18 及以上的行为无法实机验证，凡依赖新系统特性的做法都不采用。

## 方案

### 1. 壳：WKWebView 直接加载 Relay

- 启动直接打开 `https://relay.20260310.best/nodes`，未登录由 Relay 自己跳到 `/login`。
  节点列表、邮箱登录、绑定、改名全部沿用 Relay 的网页。
- **不用 Capacitor，不做本地节点列表页。** Android 壳有本地列表页，是为了保存手动输入的节点地址并导入 Relay 节点；
  iOS 节点全部来自 Relay，这一层不需要，对应的 `getLauncherNodes`、`setLauncherNodes`、`storeRelayNodes`、`consumeRelayNodes` 不实现。
- 网页资源来自 Relay 和节点，不把网页打包进 App，符合 [AGENTS.md](../../../AGENTS.md) 的“网页资源必须随对应后台发布”。
- 登录状态用 `WKWebsiteDataStore.default` 持久化。

### 2. 网页识别 App 环境

- 现状：`runtime/web/src/services/runtime.ts` 的 `getNativePlatform` 只认 `android`、`harmony` 和 Capacitor；
  `App.tsx` 的 `isRelayPWAContext` 要求 `display-mode: standalone`，WKWebView 不满足。
- **iOS 沿用 PWA 路径，不当作“原生壳”。** `isNativeShellRuntime()` 为真时，`main.tsx`（第 296、408 行附近）的视口与键盘计算走原生分支，
  那是按 Android 调的；0.1.51 的 iPhone 键盘修复是在 Safari 与 PWA 路径下验过的。
- 网页新增一个明确的 iOS 标记，用于下载、外链、剪贴板等原生能力。Bark 通知配置沿用「更多 → 通知」入口。
  需逐个检查 `main.tsx`、`App.tsx`、`FileTree.tsx`、`clipboard.ts`、`replyPoller.ts`、`FileViewer.tsx` 里 `isNativeShellRuntime` 相关分支，**这一步尚未做**。
- App 内隐藏“添加到主屏幕”入口（`FileTree.tsx`）。

### 3. 原生桥接与 WebKit 处理（已实现）

多数能力由壳直接处理 WebKit 事件，网页不用改：

| 能力 | 做法 |
|---|---|
| 下载 | `WKDownload` 接管 `a[download]`（含 `blob:`）、`Content-Disposition: attachment` 与不可显示的类型，存到临时目录后弹系统分享面板，可「存储到文件」 |
| 外链 | 同源在 App 内打开，其他 http(s) 链接用系统打开；`mailto`、`tel` 等交给系统 |
| `window.open` | 同源或空白弹窗用带「完成」按钮的模态页，支持先开空白页再 `location.replace`；外部地址用系统打开 |
| `alert` / `confirm` / `prompt` | 用 `UIAlertController`，否则 WKWebView 会让 `confirm` 一律返回 false |
| 上传 | WKWebView 自带相册、拍照、文件选择；已写好相机与麦克风用途说明 |
| 状态栏与背景 | 监听页面 `theme-color` 或背景色，按亮度切换状态栏文字，避免深色主题闪白 |
| 安全区 | 节点页（`/n/…`，声明 `viewport-fit=cover`）铺满屏幕，由网页自己处理；Relay 自带页面（登录、节点、绑定）不声明，壳按安全区缩进。加载完成后以页面自己的 viewport 声明为准 |

`window.MindFSIOSApp`（仅 Relay 来源的主框架可调用）提供 `getAppInfo`、`openExternalURL`、`copyText`、`saveBase64`、`setChrome`。
不实现 Android 壳的 `configureReplyPoller`、节点存取四项、清 WebView 缓存。未启用 App-Bound Domains（会限制子框架导航）。
Bark 点击通过 URL Scheme `localaiagent://open?url=…` 或 `?path=…` 进入：只接受 https、主机必须等于 Relay、拒绝用户信息与异常端口，冷启动与回前台都会打开目标。

### 4. 锁屏通知由 Bark 接收

在「更多 → 通知 → Bark 推送」配置设备 Key、总开关和事件类型。配置针对当前节点保存。总开关开启后，默认按以下规则提醒。

| 事件类型 | 默认 | 触发条件 |
|---|---|---|
| 需要审批 | 开启 | Agent 等待操作授权 |
| 需要回答 | 开启 | Agent 等待用户输入或选择 |
| 任务失败 | 开启 | 会话本轮或定时任务最终失败 |
| 任务完成 | 关闭 | 会话本轮或定时任务成功结束 |

自动推送只匹配开启的类型。运行进度、流式消息、单个工具调用和临时断线在会话里查看。手动点「发送测试通知」时发送一条测试消息。

- **后台投递。** 复用节点后台的通知入口。独立后台已有 `notify-script` 接口，内置后台复用同一事件入口。节点先检查开关与事件类型，再异步发给 Bark，同一事件 ID 只发一次。配置通过已授权的入口保存，设备 Key 由后台持有。
- **事件来源。** Codex 和 Claude Code 的工具审批已沿用提问流程。根据交互类型区分审批和普通问题。会话结束事件包含失败后的收尾，推送按明确的终态分类，失败时只发失败提醒。
- **通知内容。** 锁屏来源显示 Bark，内容使用项目名、会话标题和一行摘要。完整的审批参数在会话中查看。
- **点击回会话。** 通知携带 App 的跳转链接，把节点、项目路径和会话交给 App。冷启动与回前台都打开原会话。登录过期时走现有登录流程，登录后继续进入目标。App 按当前账号可见节点校验目标，内置后台的链接包含 `/p/<项目 ID>/`。 [Bark 跳转文档](https://github.com/Finb/Bark/blob/master/docs/params.md)

### 5. 兼容现有节点

- App 通过现有 Relay 访问节点、项目和会话。升级并配置通知的节点可以向 Bark 投递。
- Bark 的事件筛选作用于新增的投递路径。Web Push 和已配置的通知脚本继续按各自的设置工作。验收时覆盖两种后台模式的聊天、会话终态和通知去重。

## 技术选型：开发语言

**Swift。**

- App 使用 `WKWebView`、`WKDownload`、系统分享面板、`SFSafariViewController` 和 URL Scheme。
- 壳很薄，不重做界面，Swift 代码量预计几百行级别，没有跨平台需求。
- App 用 UIKit 场景处理 Bark 打开链接。根控制器承载 `WKWebView`，处理状态栏、键盘、安全区和滚动。
- 最低系统版本 iOS 16（已确认）。`WKDownload` 需要 14.5，可直接使用；
  `WKWebView.isInspectable` 需要 16.4，必须用 `#available` 判断，不能假定所有 iOS 16 设备都有。
  用户 iOS 16 设备的小版本号未知，实现时先确认。

不选：

- **Capacitor / React Native / Flutter**：网页已成熟，不需要它们的界面层；引入 JS 桥接与额外构建链只会增加改动面。
- **Kotlin Multiplatform**：只做 iOS，没有共享逻辑。

以后若做 Android，应是独立的壳，共享的是网页和桥接协议（方法名与参数），不是原生代码。

## 目录

本仓库根目录 `ios/`（已确认）。`project.yml` 由 XcodeGen 生成工程；构建脚本 `scripts/ios/build-ipa.sh`，产物在 `build/ios/`。

## 实施顺序与验证门槛

按 [AGENTS.md](../../../AGENTS.md) 的要求，“源码完成、验证通过、安装包生成”分别记录；后续代码有改动，重新标明待验证范围。

**第一步：壳**

1. 工程骨架：加载 Relay、登录保持、`/nodes` 为首页。
2. 网页 iOS 标记及相关分支检查与修改。
3. 桥接：下载、外链、剪贴板、版本信息。
4. 输出 IPA，由用户签名安装到 iPhone，验证登录、节点自动出现、进入项目、聊天、键盘弹出、锁屏回前台重连、下载保存和外链。

**第二步：Bark 通知**

1. 节点按总开关和事件类型筛选后投递，覆盖同一事件重复到达、任务失败后收尾、手动测试通知。
2. App 的「更多 → 通知」提供配置，接通了 Bark 的节点可发送测试通知。
3. 装好签名 IPA 与 Bark，在 iOS 17 优先验收 IDEA 发起任务、锁屏收通知、点开进入原会话。覆盖登录过期和 App 冷启动，再在 iOS 16 验证同一核心流程。
4. 验证不同类型关闭时的筛选结果与现有网页通知。节点侧用临时 HOME 与临时前缀验证，保留用户已装服务。

## IPA 交付与推送验证

- 交付供用户自行签名安装的 IPA。验证签名后的 App 注册了预定的跳转链接，并能从 Bark 打开原会话。
- iPhone 上给 Bark 开启通知权限。针对已配置的节点验证锁屏收到测试通知和实际任务通知。

## 待确认与待验证

- **Bark 管理权限待修复。** 当前公网节点访问权限也覆盖修改推送配置和试发。配套后台打包前需校验节点所有者权限，再验证授权用户可以正常配置。
- **隐私。** 实施 Bark 通知后，在 [PRIVACY.md](../../../PRIVACY.md) 写明锁屏展示的内容和 Bark、Apple 推送服务参与投递。
- **Service Worker：** 网页启动时注册 `service-worker.js`。我了解到 WKWebView 里它只在 App-Bound Domains（`WKAppBoundDomains`，最多 10 个）下可用，未验证。
  Relay 域名固定，配置即可；不配只是失去缓存，不影响功能。
- **剪贴板读取：** `TokenEditor` 用 `navigator.clipboard.readText`，iOS 会弹系统“粘贴”确认气泡，未验证。
- **点击跳转地址。** 验证独立与内置节点的地址分别能定位到原会话，登录过期时保留目标。
- **默认 Relay 之外的 Relay：** 自建 Relay 的用户如何指定地址，首版不做，仅用默认地址。
- **iOS 16 与 17 的差异：** 键盘、安全区、`WKWebView` 行为按这两个系统实机验证；iOS 18 及以上只能靠系统兼容性，不能记为已验证。
- **真机投递。** 待确认 Bark 锁屏点击能在签名后的 App 进入目标会话。
