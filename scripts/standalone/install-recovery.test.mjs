import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
const powershell = process.env.INSTALL_TEST_POWERSHELL || "pwsh";

async function available() {
  try { await exec(powershell, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"]); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

// The package's CLI is a shell stub: it records each call and can fail on request.
async function stage(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "install-recovery-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const trace = path.join(dir, "calls.txt");
  const env = { ...process.env, USERPROFILE: path.join(dir, "profile"), INSTALL_TEST_TRACE: trace };
  const bundle = async (version, omit = []) => {
    const source = path.join(dir, `package-${version}`);
    await mkdir(path.join(source, "web"), { recursive: true });
    await mkdir(path.join(source, "licenses"));
    await cp(path.join(root, "scripts/standalone/install.ps1"), path.join(source, "install.ps1"));
    await writeFile(path.join(source, "local-ai-agent.exe"), `#!/bin/sh
if [ "$1" = -installation-dir ]; then exit 0; fi
printf '%s\\n' "$1" >> "$INSTALL_TEST_TRACE"
if [ "$1" = -install ] && [ "\${INSTALL_TEST_INSTALL_FAIL:-0}" = 1 ]; then exit 8; fi
# version ${version}
`, { mode: 0o755 });
    for (const name of ["agents.json", "task_template.json", "LICENSE", "NOTICE.md", "web/index.html", "licenses/test.txt"]) {
      if (!omit.includes(name)) await writeFile(path.join(source, name), version);
    }
    return source;
  };
  const install = (source, target, extra = [], overrides = {}) =>
    exec(powershell, ["-NoProfile", "-File", path.join(source, "install.ps1"), "-Prefix", target, ...extra], { env: { ...env, ...overrides }, timeout: 60_000 });
  return { dir, trace, bundle, install };
}

test("PowerShell: a failed copy keeps the previous installation and restarts it", async t => {
  if (!(await available())) return t.skip("PowerShell is not installed; set INSTALL_TEST_POWERSHELL to a portable pwsh.");
  const { dir, trace, bundle, install } = await stage(t);
  const target = path.join(dir, "installed");
  await install(await bundle("1.0.0"), target);
  const binary = await readFile(path.join(target, "local-ai-agent.exe"), "utf8");
  await writeFile(trace, "");

  await assert.rejects(install(await bundle("1.0.1", ["NOTICE.md"]), target));
  assert.equal(await readFile(path.join(target, "web/index.html"), "utf8"), "1.0.0");
  assert.equal(await readFile(path.join(target, "NOTICE.md"), "utf8"), "1.0.0");
  assert.equal(await readFile(path.join(target, "local-ai-agent.exe"), "utf8"), binary);
  assert.equal(existsSync(path.join(target, ".upgrade")), false);
  assert.equal(await readFile(trace, "utf8"), "-stop\n-stop-core\n-no-browser\n");

  await writeFile(trace, "");
  await install(await bundle("1.0.2"), target);
  assert.equal(await readFile(path.join(target, "web/index.html"), "utf8"), "1.0.2");
  assert.equal(await readFile(trace, "utf8"), "-stop\n-stop-core\n-install\n-no-browser\n");
});

test("PowerShell: a first installation that fails to register can be retried", async t => {
  if (!(await available())) return t.skip("PowerShell is not installed; set INSTALL_TEST_POWERSHELL to a portable pwsh.");
  const { dir, bundle, install } = await stage(t);
  const target = path.join(dir, "installed");
  const source = await bundle("1.0.0");
  await assert.rejects(install(source, target, ["-DeferStart"], { INSTALL_TEST_INSTALL_FAIL: "1" }));
  assert.equal(existsSync(path.join(target, "local-ai-agent.exe")), false);
  await install(source, target, ["-DeferStart"]);
  assert.equal(await readFile(path.join(target, "web/index.html"), "utf8"), "1.0.0");
});
