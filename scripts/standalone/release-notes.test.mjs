import assert from "node:assert/strict";
import test from "node:test";
import { releaseNotes } from "./release-notes.mjs";
import { TARGETS } from "./verify-release-assets.mjs";

const all = Object.keys(TARGETS);
const changes = "- 修复一个问题。";

test("a one platform test build names its platform and offers no other platform's instructions", () => {
  const mac = releaseNotes({ version: "1.2.3", targets: ["macos-arm64"], changes, defaultVersion: "1.2.2" });
  assert.match(mac, /仅提供 macOS Apple Silicon 安装包/);
  assert.match(mac, /仍安装默认版本/);
  assert.match(mac, /### macOS 和 Linux/);
  assert.doesNotMatch(mac, /Windows|systemd|绑定链接/);
  assert.match(mac, /LaunchAgent/);
  const linux = releaseNotes({ version: "1.2.3", targets: ["linux-amd64"], changes });
  assert.match(linux, /systemd/);
  assert.doesNotMatch(linux, /LaunchAgent/);
  assert.doesNotMatch(mac, /curl -fsSL/, "a test build must not advertise the fixed online command as its installer");
  assert.match(mac, /默认安装目录为 `~\/\.local\/share\/LocalAIAgent`/);
  assert.match(mac, /SHA-256/);
  const win = releaseNotes({ version: "1.2.3", targets: ["windows-amd64"], changes });
  assert.match(win, /仅提供 Windows x64 安装包/);
  assert.match(win, /%LOCALAPPDATA%\\Programs\\LocalAIAgent/);
  assert.doesNotMatch(win, /macOS|systemd/);
  assert.match(win, /powershell\.exe -NoProfile -ExecutionPolicy Bypass -File \.\\install\.ps1/);
});

test("a test build of all platforms is still a pre-release, a formal one carries the online commands", () => {
  const test_ = releaseNotes({ version: "1.2.3", targets: all, changes });
  assert.match(test_, /本版为测试预发布/);
  assert.doesNotMatch(test_, /irm https/);
  const formal = releaseNotes({ version: "1.2.3", targets: all, changes, formal: true });
  assert.match(formal, /适用于 macOS、Linux、Windows 的 x64 和 ARM64/);
  assert.match(formal, /curl -fsSL https:\/\/raw\.githubusercontent\.com\/zhuxian89\/idea-ai-agent\/main\/scripts\/install\.sh \| sh/);
  assert.match(formal, /irm https:\/\/raw\.githubusercontent\.com\/zhuxian89\/idea-ai-agent\/main\/scripts\/install\.ps1 \| iex/);
  assert.match(formal, /重复执行对应系统的安装命令即可升级/);
  assert.match(formal, /## 本版更新\n\n- 修复一个问题。/);
});
