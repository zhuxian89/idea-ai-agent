# Local AI Agent 独立服务

独立版提供统一的多项目入口，浏览器使用当前优化后的界面。插件直接连接本地数据服务；独立远程入口单独运行。关闭或重启远程入口时，插件界面和本地聊天继续使用；关闭 IDEA 后仍可远程访问。

远程访问沿用现有 Relay，云端无需更新，其他客户端继续使用原协议。IDEA/独立版取消浏览器配对和项目二次授权，节点地址直接进入已开放项目。

## 在线安装

安装方式与上游一致：脚本识别系统和 CPU，下载对应的独立程序压缩包，校验 SHA-256，再安装到用户目录。安装后自动启动，升级默认沿用已登记的安装位置。macOS 自动注册 LaunchAgent，Windows 自动注册当前用户的计划任务；登录后启动，异常退出后恢复，无需手动配置系统服务。运行服务无需安装 Go、Node.js 或 IDEA；Agent 继续使用本机已有的 CLI 和配置。

**从 IDEA 使用独立服务时，可直接在远程面板点击“安装并继续”。也可以使用下方固定地址的脚本单独安装。脚本默认读取最新发布版本，地址无需随版本修改。**

macOS / Linux：

```sh
curl -fsSL https://raw.githubusercontent.com/zhuxian89/idea-ai-agent/main/scripts/install.sh | sh
```

Windows（PowerShell）：

```powershell
irm https://raw.githubusercontent.com/zhuxian89/idea-ai-agent/main/scripts/install.ps1 | iex
```

默认目录为 macOS / Linux 的 `~/.local/share/LocalAIAgent`，Windows 的 `%LOCALAPPDATA%\Programs\LocalAIAgent`。IDEA 通过固定用户配置目录中的安装记录找到程序，不依赖当前项目。

指定版本或目录：

```sh
curl -fsSL https://raw.githubusercontent.com/zhuxian89/idea-ai-agent/main/scripts/install.sh | sh -s -- --version 0.1.27 --prefix "$HOME/Applications/LocalAIAgent"
```

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/zhuxian89/idea-ai-agent/main/scripts/install.ps1))) -Version 0.1.27 -Prefix "$env:LOCALAPPDATA\Programs\LocalAIAgent"
```

更新时对同一目录重新执行安装脚本。下载和校验成功后，安装程序停止远程入口和本地数据服务，再替换程序与网页资源。升级程序会中断当前连接，聊天记录保留。安装完成后自动启动；macOS / Windows 自动更新自启配置，原端口保留。以后安装或升级都使用同一个脚本地址，自动获取最新版本；需要指定版本时传入 `--version` 或 `-Version`。

## IDEA 连接与命令行启动

首次打开插件的“远程访问”时，选择内置服务或独立服务。选择独立服务后会检测安装和运行状态；已安装则直接使用，未安装时点击“安装并继续”，插件自动下载、校验并安装，面板显示进度和失败原因。安装期间当前聊天继续运行，完成后退出全部 IDEA 并重新启动，再进入远程连接和测试界面。无需复制命令或操作终端。

macOS / Linux：

```sh
"$HOME/.local/share/LocalAIAgent/local-ai-agent"
```

Windows：

```powershell
& "$env:LOCALAPPDATA\Programs\LocalAIAgent\local-ai-agent.exe"
```

程序启动后台服务并打开浏览器。同一个服务管理所有项目，IDEA 从 A 项目进入时定位到 A；浏览器可以切换其他已添加的项目。退出 IDEA 后，服务继续运行。

当前配套插件与六平台独立后台版本统一为 `0.1.27`。从 `.3` 升级时先退出 IDEA，再运行包内安装脚本。未安装独立版时，插件继续使用原内置后端。安装后，即使远程入口停止、启动失败或认证失败，插件仍可连接本地数据服务；错误和启停操作显示在远程面板内。

远程服务未启动时，面板只提供启动操作和折叠详情，启动成功后才展示远程连接入口。首页保留二维码、打开网页、复制链接与设置；运行方式、后台更新、项目和故障排查都在设置中。

打开远程面板会自动查询 GitHub Releases，发现新版时首页设置旁显示圆点和“有新版本”，点击进入设置。独立后台区域常显版本、“检查更新”和启动、重启、停止服务按钮。发现新版后点击“更新并重启”，插件自动下载、校验、升级并重启 IDEA 回到远程设置。以后后台发布新包，无需重新安装插件即可发现更新。旧后台页面会显示简洁的原生检查入口。更新会重启后台和 IDEA，请先结束当前回复；安装目录、项目和聊天记录保留。

独立浏览器也可检查新版并打开对应 Release；自动安装通过 IDEA 的远程设置完成。

## 修改远程访问方式

首次打开远程面板时选择内置或独立服务。选择独立服务后自动检测，未安装时点击“安装并继续”，由插件下载、校验并安装，面板显示进度和错误。安装期间当前聊天继续运行。

安装完成或保存新的使用方式后，点击“重启 IDEA 并继续”，重启后自动打开原项目的远程设置，继续查看连接状态、测试和二维码。若还开着其他 IDEA 实例，请先退出。也可以点“稍后重启”，下次启动 IDEA 后打开远程面板继续；已安装的后台无需重装。

远程面板显示当前使用方式，点击“更改”可以重新选择内置或独立服务。保存时保留当前聊天和连接；只关闭项目或重开面板不会提前切换。其他 IDEA 实例仍在运行时继续沿用原方式。

切回内置时，插件停止独立数据服务与远程入口，并移除它们的登录自启配置，保留独立版程序和安装记录；再次选择独立版并重启后自动恢复自启和后台运行。两种方式沿用项目原有的 `.mindfs` 或 home 元数据，项目身份和聊天记录保留。远程设置失败显示在面板内，本地聊天可以继续使用。

## 离线安装

macOS / Linux 下载对应平台的 `.sh` 安装文件，运行一次即可完成解压、安装或升级及后台启动。macOS 同时配置登录自启和异常退出恢复：

```sh
sh ./local-ai-agent-0.1.27-macos-arm64.sh
```

已有安装自动沿用原目录；可通过第一个参数指定安装目录。

Windows：解压 ZIP，在 PowerShell 中进入解压目录并运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

使用 tar.gz 压缩包时，也可解压后运行包内脚本：

```sh
sh ./install.sh
```

自定义安装目录可传给包内 `install.sh` 的第一个参数，或 PowerShell 脚本的 `-Prefix`。

## 管理服务

以下命令中的程序名使用安装后的完整路径：

```sh
local-ai-agent -status
local-ai-agent -stop
local-ai-agent -restart
local-ai-agent -no-browser
local-ai-agent /absolute/path/to/project
```

`-stop` 和 `-restart` 控制远程入口，断开远程设备；插件的本地聊天继续运行。macOS 安装脚本自动配置 Core 和远程入口的用户 LaunchAgent，Windows 配置两个当前用户计划任务。电脑重启并登录后自动启动；异常退出由系统恢复。手动停止会保持停止，直到手动启动或下一次登录。启动和重启会沿用上次的实际端口，可用 `-addr 127.0.0.1:7441` 指定。`-foreground` 在当前终端运行远程入口。远程日志为 `LocalAIAgent/remote/logs/standalone.log`，本地数据服务日志为同目录的 `core.log`。安装程序使用 `-stop-core` 停止本地数据服务后更新程序。

## 项目与已有数据

浏览器中点击“添加项目”，可使用三种方式：

- **空白项目**：选择父目录，填写项目名称并创建。
- **加入本地目录**：浏览目录、进入子目录或返回上级，选择已有目录后添加；也可输入完整路径，前往后添加当前目录。Windows 支持切换盘符，已添加的目录会显示标记。
- **从 GitHub 导入**：选择保存目录，填写 GitHub 仓库地址；克隆并登记完成后自动切换到项目。运行服务的电脑需要安装 Git。

这里的目录位于运行服务的电脑上。IDEA 打开的项目也会注册到同一个服务。

项目内 `.mindfs` 原位保留；IDEA 连接时读取旧注册表中的元数据位置，以便复用 home 模式数据，不覆盖旧注册表。独立配置与偏好保存在用户配置目录 `LocalAIAgent/remote`。同名的不同路径项目会明确报告冲突。

以前使用过插件统一远程入口时，独立服务首次启动会读取旧远程的项目清单，按实际路径合并原先开放的项目，并沿用远程启用状态。暂停或未开放的项目保留旧记录，可在需要时通过新插件打开或在独立版中添加。目录已不存在的项目在日志中提示；不会为它新建空目录。

导入只登记项目位置，聊天记录和附件继续从原位置读取，home 模式的数据也不搬动。已有独立版项目与远程设置保留；导入完成后，后续启动不会把用户移除的项目重新加回来。

## 远程访问

在现有界面开启远程访问，沿用 [relay.20260310.best](https://relay.20260310.best) 和已有的电脑绑定身份。电脑与独立服务保持运行时，IDEA 关闭后仍可通过 Relay 进入同一个多项目入口。访问链接保留当前项目和会话定位。

从插件统一远程入口接入时，继续使用原来的 Relay 凭据。浏览器登录 Relay 后即可从首页进入节点，无需配对或项目二次授权。已导入项目的旧 `/p/项目编号/` 书签会跳转到独立入口，并保留项目、会话和文件定位。

## 移除独立安装记录

```sh
local-ai-agent -unregister
```

命令停止远程入口和本地数据服务，移除 macOS / Windows 自启配置和 IDEA 的独立安装记录，保留项目数据和用户配置。随后可删除专用安装目录。重新打开 IDEA 项目后恢复内置后端流程。

## 构建与发布约定

独立版本由 `scripts/standalone/version.txt` 指定，与插件版本分开。构建示例：

```sh
node scripts/package-standalone.mjs windows-amd64
node scripts/package-standalone.mjs macos-arm64 --skip-web
```

支持 Windows、macOS、Linux 的 amd64 和 arm64。产物位于 `build/standalone/<版本>/`，每个平台包含压缩包和对应的 `.sha256` 文件；macOS / Linux 额外生成可直接运行的 `.sh` 安装文件，包含程序与网页资源。发布到本仓库 `standalone-v<版本>` Release 后，在线脚本即可下载；插件的 `v<版本>` Release 不作为独立版来源。`LOCAL_AI_AGENT_VERSION` 可覆盖构建版本。

内部镜像或本地安装测试可用 `LOCAL_AI_AGENT_DOWNLOAD_BASE_URL` 指定下载根地址，目录结构仍为 `standalone-v<版本>/<压缩包文件名>`，并显式指定版本。

## English

The standalone distribution reuses the current Local AI Agent interface and provides one entry for all projects. The plugin connects directly to a local data service. Remote access runs in a separate process, so stopping, restarting, or failing to authenticate remote access leaves the plugin and local chats available. Opening it from IDEA selects that project, and the browser can switch to other registered projects. The service and access through the existing Relay at `relay.20260310.best` continue after IDEA closes.

On first startup, it imports previously shared projects from the plugin's unified remote entry, reuses their original conversation and attachment storage, and carries over the remote enabled state. Existing standalone settings remain in place. Paused or unshared projects remain in the old records and can be added when needed. Missing directories are reported in the log. Imports run once, so removed projects stay removed. Existing Relay credentials are reused. Sign in to Relay and open the node from its home page, with no browser pairing or additional project authorization; old project bookmarks redirect to the standalone entry while preserving project, session, and file selection.

Remote access uses the existing Relay with no cloud update or changes to other clients. IDEA and the standalone backend remove browser pairing and separate project authorization; node URLs directly access shared projects.

The fixed installer URLs above detect the platform, read the latest published version and download its standalone package, verify SHA-256, and install it in a fixed user directory. Reuse the same URL for installation and upgrades; an explicit version is optional. They support version and directory selection. Updates reuse the registered directory and start the service automatically. macOS registers user LaunchAgents and Windows registers tasks for the current user; both start at sign-in and recover after abnormal exits. The plugin and all six standalone platform packages use version 0.1.27. Quit IDEA before upgrading from .3. IDEA starts or reuses the local data service independently of remote access. Remote errors and controls stay in the remote panel. Without a standalone installation, it uses the embedded backend.

The first visit to Remote access offers Built-in or Standalone service. Selecting Standalone checks its installation and running state. If it is missing, click Install and continue: the plugin downloads, verifies and installs it, with progress and errors shown in the panel. Current chats keep running.

After installation or saving a mode change, click Restart IDEA and continue. The original project's remote settings reopen after restart, ready for connection status, testing and the QR code. Close any other IDEA instances first. Restart later closes the panel; reopen Remote access after your next restart to continue. The installed backend does not need reinstalling.

When the remote service is stopped, the panel shows the start action and expandable details. Connection setup appears once the service is running. The home page contains the QR code, access actions and Settings. Run mode, updates, projects and troubleshooting are in Settings.

Opening Remote access checks GitHub Releases automatically. An update dot and New version available link open Settings. The standalone backend area shows its version, Check for updates and start, restart or stop controls. When a newer standalone package is available, Update and restart downloads and verifies it, runs the installer, and restarts IDEA back into remote settings. Future backend releases are discovered without reinstalling the plugin. Older backend pages retain a compact native update entry. Finish the current response before updating; the installation directory, projects and chats are retained.

The standalone browser can also check versions and open the release page. Automatic installation is available through IDEA’s remote settings.

The current mode is shown in Settings; click Change to select another mode. Saving keeps current chats and connections running; changes apply after all IDEA instances exit and restart. Returning to Built-in stops the standalone services and removes their sign-in jobs while retaining the installation. Switching back restores the jobs and services. Both modes reuse existing project identities and metadata locations. Remote setup errors appear in the panel without blocking local chats.

Windows, macOS and Linux use the versioned Release installers above. For macOS and Linux local testing, run the platform-specific `.sh` installer once; it extracts the bundle and performs installation or upgrade automatically. Installation and upgrades stop the old processes, replace the program, and restart it while preserving data and the port. Standalone assets use the `standalone-v<version>` release tag, separate from plugin ZIP releases.

`-stop` and `-restart` control remote access and keep local chats running. On macOS and Windows, manual stop leaves remote access stopped until it is started again or the next login. Unregistering removes the login jobs. Startup reuses the last bound port unless `-addr` is supplied. Installation updates stop both processes before replacing files; conversation data is retained.
