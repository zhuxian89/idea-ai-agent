import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));

test("PowerShell package: automatic startup, directory reuse, repeated upgrade and stop failure", async t => {
  const pwsh = process.env.INSTALL_TEST_POWERSHELL || "pwsh";
  try {
    await exec(pwsh, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"]);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    t.skip("PowerShell is not installed; set INSTALL_TEST_POWERSHELL to a portable pwsh.");
    return;
  }

  const directory = await mkdtemp(path.join(os.tmpdir(), "standalone-package-test-"));
  const source = path.join(directory, "incoming package");
  const previous = path.join(directory, "previous installation");
  const target = path.join(directory, "new installation");
  const discovery = path.join(directory, "remote");
  await mkdir(path.join(source, "web"), { recursive: true });
  await mkdir(path.join(source, "licenses"));
  await mkdir(previous);
  const executable = path.join(source, "local-ai-agent.exe");
  const env = {
    ...process.env, HOME: directory, USERPROFILE: directory, LOCALAPPDATA: path.join(directory, "AppData"),
    IDE_AGENT_DATA_DIR: discovery, IDE_AGENT_REMOTE_HOST_DIR: discovery,
    MINDFS_STATIC_DIR: path.join(source, "web"), MINDFS_RELAY_BASE_URL: "http://127.0.0.1:1",
    PATH: "",
  };
  delete env.IDE_AGENT_TOKEN;
  const cli = (program, ...args) => exec(program, args, { env, timeout: 30_000 });
  t.after(async () => {
    try {
      await cli(executable, "-unregister");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  await exec("go", ["build", "-o", executable, "./server/cmd/mindfs-server"], { cwd: path.join(root, "runtime"), timeout: 120_000 });
  await cp(path.join(root, "scripts/standalone/install.ps1"), path.join(source, "install.ps1"));
  for (const name of ["agents.json", "task_template.json", "LICENSE"]) {
    await cp(path.join(root, "runtime", name), path.join(source, name));
  }
  await writeFile(path.join(source, "NOTICE.md"), "test package");
  await writeFile(path.join(source, "web/index.html"), "<html><head></head><body>test package</body></html>");
  const readDescriptor = name => readFile(path.join(discovery, name), "utf8").then(JSON.parse);
  const install = (args = ["-Prefix", target], script = path.join(source, "install.ps1")) => exec(pwsh, ["-NoProfile", "-File", script, ...args], { env, timeout: 60_000 });
  await install([]);
  assert.equal((await readDescriptor("installation.json")).executable, path.join(env.LOCALAPPDATA, "Programs", "LocalAIAgent", "local-ai-agent.exe"));
  await readDescriptor("host.json");
  await readDescriptor("core.json");
  await cli(executable, "-unregister");

  const oldExecutable = path.join(previous, "local-ai-agent.exe");
  await cp(executable, oldExecutable);
  await cli(oldExecutable, "-no-browser", "-no-relayer");
  const oldHost = await readDescriptor("host.json");

  await install();
  const installed = path.join(target, "local-ai-agent.exe");
  assert.equal((await readDescriptor("installation.json")).executable, installed);
  let host = await readDescriptor("host.json");
  await readDescriptor("core.json");
  assert.notEqual(host.token, oldHost.token);
  assert.equal(host.url, oldHost.url);
  const login = await fetch(`${host.url}/?ide_token=${host.token}`, { redirect: "manual" });
  assert.equal(login.status, 303);
  const page = await fetch(`${host.url}/`, { headers: { Cookie: login.headers.get("set-cookie").split(";")[0] } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /test package/);

  await writeFile(path.join(target, "retained.txt"), "keep");
  for (let attempt = 0; attempt < 2; attempt++) {
    await install([]);
    assert.equal((await readDescriptor("installation.json")).executable, installed);
    const restarted = await readDescriptor("host.json");
    assert.notEqual(restarted.token, host.token);
    assert.equal(restarted.url, host.url);
    assert.equal(await readFile(path.join(target, "retained.txt"), "utf8"), "keep");
    host = restarted;
  }
  await cp(path.join(source, "install.ps1"), path.join(target, "install.ps1"));
  await install(["-Prefix", target], path.join(target, "install.ps1"));
  assert.notEqual((await readDescriptor("host.json")).token, host.token);
  host = await readDescriptor("host.json");

  // A failed stop must leave the installed executable and the local core intact.
  const hostFile = path.join(discovery, "host.json");
  const before = await readFile(installed);
  await writeFile(hostFile, JSON.stringify({ ...host, token: "0".repeat(64) }));
  try {
    await assert.rejects(install(), error => /Stop Local AI Agent before upgrading/.test(error.stderr));
    assert.deepEqual(await readFile(installed), before);
    await readDescriptor("core.json");
  } finally {
    await writeFile(hostFile, JSON.stringify(host));
  }
});
