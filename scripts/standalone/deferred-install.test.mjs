import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
test("in-panel install keeps the embedded chat alive and starts standalone only after exit", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "deferred-install-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, "package");
  await mkdir(path.join(source, "web"), { recursive: true });
  await mkdir(path.join(source, "licenses"));
  const cli = path.join(source, "local-ai-agent");
  const plugin = path.join(dir, "idea-agent");
  await exec("go", ["build", "-o", cli, "./server/cmd/mindfs-server"], { cwd: path.join(root, "runtime") });
  await exec("go", ["build", "-o", plugin, "./server/cmd/idea-agent"], { cwd: path.join(root, "runtime") });
  await cp(cli, path.join(source, "local-ai-agent.exe"));
  for (const name of ["install.sh", "install.ps1"]) await cp(path.join(root, "scripts/standalone", name), path.join(source, name));
  for (const name of ["agents.json", "task_template.json", "LICENSE"]) await cp(path.join(root, "runtime", name), path.join(source, name));
  await writeFile(path.join(source, "NOTICE.md"), "test");
  await writeFile(path.join(source, "web/index.html"), "<html><head></head><body>test</body></html>");
  for (const kind of ["Shell", "PowerShell"]) await t.test(kind, async () => {
    const home = path.join(dir, kind), discovery = path.join(home, "remote"), project = path.join(home, "project"), target = path.join(home, "installed");
    await mkdir(project, { recursive: true });
    const token = "a".repeat(64);
    const env = { ...process.env, HOME: home, USERPROFILE: home, LOCALAPPDATA: path.join(home, "AppData"),
      IDE_AGENT_REMOTE_HOST_DIR: discovery, IDE_AGENT_DATA_DIR: path.join(home, "embedded"),
      MINDFS_STATIC_DIR: path.join(source, "web"), MINDFS_RELAY_BASE_URL: "http://127.0.0.1:1", PATH: "" };
    const child = spawn(plugin, ["--project", project], { env: { ...env, IDE_AGENT_TOKEN: token }, stdio: ["pipe", "pipe", "inherit"] });
    const exited = once(child, "exit");
    let buffer = "";
    const ready = await new Promise((resolve, reject) => {
      child.stdout.on("data", data => { buffer += data; const match = buffer.match(/IDE_AGENT_READY (.+)\n/); if (match) resolve(JSON.parse(match[1])); });
      child.on("error", reject); child.on("exit", code => reject(new Error(`embedded exited ${code}: ${buffer}`)));
    });
    const command = (...args) => exec(cli, args, { env, timeout: 30_000 });
    try {
      const install = () => kind === "Shell" ? exec("/bin/sh", [path.join(source, "install.sh"), target, "--defer-start"], { env: { ...env, PATH: "/usr/bin:/bin" }, timeout: 60_000 })
        : exec(process.env.INSTALL_TEST_POWERSHELL || "pwsh", ["-NoProfile", "-File", path.join(source, "install.ps1"), "-Prefix", target, "-DeferStart"], { env, timeout: 60_000 });
      await install();
      const installed = JSON.parse(await readFile(path.join(discovery, "installation.json"), "utf8"));
      assert.equal(path.dirname(installed.executable), target);
      for (const name of ["core.json", "host.json"]) await assert.rejects(readFile(path.join(discovery, name)), { code: "ENOENT" });
      const response = await fetch(`${ready.url}/?ide_token=${token}`, { redirect: "manual" });
      assert.equal(response.status, 303);
      await assert.rejects(install(), error => /already installed/.test(error.stderr));
      assert.equal(child.exitCode, null);
      child.stdin.end("shutdown\n");
      await exited;
      delete env.IDE_AGENT_DATA_DIR;
      await command("-no-browser", "-no-relayer");
      for (const name of ["core.json", "host.json"]) await readFile(path.join(discovery, name));
    } finally {
      if (child.exitCode == null) { child.stdin.end("shutdown\n"); await exited; }
      await command("-unregister");
    }
  });
});
