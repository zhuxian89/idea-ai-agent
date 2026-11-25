#!/usr/bin/env node
// release-notes.mjs --version V [--targets a,b|all] --changes-file F [--formal] [--default-version V0]
//
// Writes the Release body for a standalone backend release to stdout, following AGENTS.md "发布说明必须写安装方法":
// install commands per platform family, default install directory, how to upgrade, manual installation, then the
// changes of this version. A build that does not cover all six platforms is announced as a test build for the
// platforms it has. Without --formal the text is for a test pre-release (the fixed online installers still install
// the default version); --formal is for the release that has become the default.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS, parseTargets } from './verify-release-assets.mjs';

const PLATFORM_NAMES = {
  'linux-amd64': 'Linux x64', 'linux-arm64': 'Linux ARM64', 'macos-amd64': 'macOS Intel', 'macos-arm64': 'macOS Apple Silicon',
  'windows-amd64': 'Windows x64', 'windows-arm64': 'Windows ARM64',
};
const REPO_RAW = 'https://raw.githubusercontent.com/zhuxian89/idea-ai-agent/main/scripts';

export function releaseNotes({ version, targets, changes, formal = false, defaultVersion = '' }) {
  const all = targets.length === Object.keys(TARGETS).length;
  const unix = targets.filter((t) => TARGETS[t].os !== 'windows');
  const windows = targets.filter((t) => TARGETS[t].os === 'windows');
  const names = targets.map((t) => PLATFORM_NAMES[t]);
  const out = [];
  if (all && formal) out.push('适用于 macOS、Linux、Windows 的 x64 和 ARM64。');
  else if (all) out.push('**本版为测试预发布。** 固定的在线安装命令仍安装默认版本' + (defaultVersion ? ` ${defaultVersion}` : '') + '，本版需手动安装。');
  else out.push(`**本版为测试预发布，仅提供 ${names.join('、')} 安装包。** 其他平台请继续使用默认版本${defaultVersion ? ` ${defaultVersion}` : ''}；固定的在线安装命令也仍安装默认版本。`);
  out.push('', '## 本版更新', '', changes.trim(), '', '## 安装与升级', '');
  if (unix.length) {
    out.push('### macOS 和 Linux', '');
    if (formal) {
      out.push('```sh', `curl -fsSL ${REPO_RAW}/install.sh | sh`, '```', '');
    }
    const hasLinux = unix.some((t) => TARGETS[t].os === 'linux');
    const hasMac = unix.some((t) => TARGETS[t].os === 'darwin');
    const parts = ['默认安装目录为 `~/.local/share/LocalAIAgent`。'];
    if (hasMac) parts.push('macOS 安装器为当前用户注册登录启动的 LaunchAgent。');
    if (hasLinux) parts.push('Linux 首次安装后打开终端给出的绑定链接，登录并确认节点。安装器在使用 systemd 的 Linux 上配置开机自启。普通用户安装时，按终端提示运行 `sudo loginctl enable-linger <安装用户的UID>` 可启用开机自启。');
    out.push(parts.join(''), '');
  }
  if (windows.length) {
    out.push('### Windows PowerShell', '');
    if (formal) {
      out.push('```powershell', `irm ${REPO_RAW}/install.ps1 | iex`, '```', '');
    }
    out.push('默认安装目录为 `%LOCALAPPDATA%\\Programs\\LocalAIAgent`。安装器为当前用户注册登录启动的计划任务。', '');
  }
  out.push(formal ? '重复执行对应系统的安装命令即可升级。安装器沿用已登记的目录，保留项目和历史会话。也可在 IDEA 的远程访问设置中更新独立后台。'
    : '已安装的电脑按下面的手动安装方法重复执行即可升级：安装器沿用已登记的目录，保留项目和历史会话。', '', '### 手动安装', '');
  if (unix.length) out.push(`- macOS 或 Linux 下载对应架构（${unix.map((t) => PLATFORM_NAMES[t]).join('、')}）的自解压 \`.sh\` 并通过 \`sh\` 执行，或解压对应的 \`.tar.gz\` 后运行 \`sh install.sh\`。`);
  if (windows.length) out.push(`- Windows 解压对应架构（${windows.map((t) => PLATFORM_NAMES[t]).join('、')}）的 \`.zip\`，在解压目录运行 \`powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\install.ps1\`。`);
  out.push('- 每个附件均有对应的 SHA-256 校验文件。', '');
  return out.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const version = option('--version');
  const changesFile = option('--changes-file');
  if (!version || !changesFile) { console.error('usage: release-notes.mjs --version V [--targets a,b|all] --changes-file F [--formal] [--default-version V0]'); process.exit(2); }
  const changes = readFileSync(changesFile, 'utf8');
  if (!changes.trim()) { console.error('the changes file is empty: write what this version changes'); process.exit(1); }
  process.stdout.write(releaseNotes({ version, targets: parseTargets(option('--targets')), changes, formal: args.includes('--formal'), defaultVersion: option('--default-version') || '' }));
}
