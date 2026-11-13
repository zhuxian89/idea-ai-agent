import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const versionURL = "https://raw.githubusercontent.com/zhuxian89/idea-ai-agent/main/scripts/standalone/version.txt";
const powershellInstaller = process.env.INSTALL_TEST_ONLINE_SCRIPT || "scripts/install.ps1";

function run(command, args, env = process.env, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env });
    let output = "";
    child.stdout.on("data", data => { output += data; });
    child.stderr.on("data", data => { output += data; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, output }));
  });
}

async function checked(command, args, env, cwd) {
  const result = await run(command, args, env, cwd);
  assert.equal(result.code, 0, result.output);
  return result;
}

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-ai-agent-installer-test-"));
  const files = new Map();
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    const content = files.get(request.url);
    response.writeHead(content ? 200 : 404, { "Content-Type": request.url === "/version.txt" ? "text/plain; charset=utf-8" : "application/octet-stream" });
    response.end(content || "Not found");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, HOME: directory, IDE_AGENT_REMOTE_HOST_DIR: path.join(directory, "remote"), LOCAL_AI_AGENT_DOWNLOAD_BASE_URL: base };
  return { directory, files, requests, base, env };
}

async function archive(f, version, target, powershell = false) {
  const bundle = `local-ai-agent-${version}-${target}`;
  const directory = path.join(f.directory, bundle);
  await mkdir(path.join(directory, "web"), { recursive: true });
  await mkdir(path.join(directory, "licenses"));
  for (const name of ["agents.json", "task_template.json", "LICENSE", "NOTICE.md", "web/index.html", "licenses/test.txt"]) {
    await writeFile(path.join(directory, name), version);
  }
  if (powershell) {
    await writeFile(path.join(directory, "install.ps1"), `param([string]$Prefix = $env:INSTALL_TEST_PREVIOUS_DIR, [switch]$DeferStart)
$ErrorActionPreference = 'Stop'
if ($env:INSTALL_TEST_INSTALL_FAIL -eq '1') { throw 'Package installation failed' }
New-Item -ItemType Directory -Force -Path $Prefix | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'web/index.html') (Join-Path $Prefix 'version.txt') -Force
Add-Content -LiteralPath $env:INSTALL_TEST_TRACE -Value $Prefix
if ($DeferStart) { Set-Content -LiteralPath (Join-Path $Prefix 'deferred.txt') -Value 'true' }
`);
  } else {
    await cp(path.join(root, "scripts/standalone/install.sh"), path.join(directory, "install.sh"));
    await writeFile(path.join(directory, "local-ai-agent"), `#!/bin/sh
if [ "$1" = -installation-dir ]; then printf '%s\\n' "\${INSTALL_TEST_PREVIOUS_DIR:-}"; exit; fi
printf '%s\\n' "$1" >> "$INSTALL_TEST_TRACE"
if [ "$1" = -stop ] && [ "\${INSTALL_TEST_STOP_FAIL:-0}" = 1 ]; then exit 9; fi
`, { mode: 0o755 });
  }
  const filename = bundle + (powershell ? ".zip" : ".tar.gz");
  if (powershell) await checked("zip", ["-qr", filename, bundle], f.env, f.directory);
  else await checked("tar", ["-czf", filename, bundle], { ...f.env, COPYFILE_DISABLE: "1" }, f.directory);
  const data = await readFile(path.join(f.directory, filename));
  const url = `/standalone-v${version}/${filename}`;
  f.files.set(url, data);
  f.files.set(url + ".sha256", `${createHash("sha256").update(data).digest("hex")}  ${filename}\n`);
  return url;
}

test("Shell: download, register, update, and retain the installed version on failure", async t => {
  const f = await fixture(t);
  const platform = process.platform === "darwin" ? "macos" : "linux";
  const arch = process.arch === "x64" ? "amd64" : process.arch;
  const target = `${platform}-${arch}`;
  const prefix = path.join(f.directory, "installation with spaces");
  const trace = path.join(f.directory, "calls.txt");
  f.env.INSTALL_TEST_TRACE = trace;
  const install = (version, env = f.env) => run("sh", ["scripts/install.sh", "--version", version, "--prefix", prefix], env);

  await archive(f, "1.0.0", target);
  assert.equal((await install("1.0.0")).code, 0);
  assert.equal(await readFile(path.join(prefix, "web/index.html"), "utf8"), "1.0.0");
  assert.equal(await readFile(trace, "utf8"), "-stop\n-stop-core\n-install\n-no-browser\n");

  await writeFile(path.join(prefix, "web/obsolete.js"), "old resource");
  await writeFile(path.join(prefix, "user-data.txt"), "keep");
  await archive(f, "1.0.1", target);
  const update = await install("1.0.1");
  assert.equal(update.code, 0, update.output);
  assert.equal(await readFile(path.join(prefix, "web/index.html"), "utf8"), "1.0.1");
  assert.equal(await readFile(path.join(prefix, "user-data.txt"), "utf8"), "keep");
  await assert.rejects(readFile(path.join(prefix, "web/obsolete.js")), { code: "ENOENT" });
  assert.equal(await readFile(trace, "utf8"), "-stop\n-stop-core\n-install\n-no-browser\n-stop\n-stop-core\n-install\n-no-browser\n");

  const url = await archive(f, "1.0.2", target);
  const checksum = f.files.get(url + ".sha256");
  f.files.set(url + ".sha256", "0".repeat(64));
  const corrupted = await install("1.0.2");
  assert.notEqual(corrupted.code, 0);
  assert.match(corrupted.output, /SHA-256 verification failed/);
  assert.equal(await readFile(trace, "utf8"), "-stop\n-stop-core\n-install\n-no-browser\n-stop\n-stop-core\n-install\n-no-browser\n");
  assert.equal(await readFile(path.join(prefix, "web/index.html"), "utf8"), "1.0.1");

  f.files.set(url + ".sha256", checksum);
  const stopFailed = await install("1.0.2", { ...f.env, INSTALL_TEST_STOP_FAIL: "1" });
  assert.notEqual(stopFailed.code, 0);
  assert.equal(await readFile(path.join(prefix, "web/index.html"), "utf8"), "1.0.1");
  assert.equal(await readFile(trace, "utf8"), "-stop\n-stop-core\n-install\n-no-browser\n-stop\n-stop-core\n-install\n-no-browser\n-stop\n");

  const notFound = await install("9.9.9");
  assert.notEqual(notFound.code, 0);
  assert.equal(await readFile(trace, "utf8"), "-stop\n-stop-core\n-install\n-no-browser\n-stop\n-stop-core\n-install\n-no-browser\n-stop\n");
});

test("Shell: resolve standalone version metadata before selecting the platform archive", async t => {
  const f = await fixture(t);
  const version = "2.0.0-standalone.1";
  const target = `${process.platform === "darwin" ? "macos" : "linux"}-${process.arch === "x64" ? "amd64" : process.arch}`;
  await archive(f, version, target);
  f.files.set("/version.txt", version + "\n");
  const commands = path.join(f.directory, "commands");
  await mkdir(commands);
  const curl = (await checked("which", ["curl"])).output.trim();
  // Redirect only the metadata endpoint; downloads still use the real HTTP client.
  await writeFile(path.join(commands, "curl"), `#!/bin/sh
if [ "$2" = '${versionURL}' ]; then
  exec "$INSTALL_TEST_CURL" -fsSL "$INSTALL_TEST_METADATA_URL"
fi
exec "$INSTALL_TEST_CURL" "$@"
`, { mode: 0o755 });
  const prefix = path.join(f.directory, "installed");
  const env = {
    ...f.env, PATH: commands + path.delimiter + process.env.PATH,
    INSTALL_TEST_CURL: curl, INSTALL_TEST_METADATA_URL: f.base + "/version.txt",
    INSTALL_TEST_TRACE: path.join(f.directory, "trace.txt"),
  };
  await checked("sh", ["scripts/install.sh", "--prefix", prefix], env);
  assert.equal(f.requests[0], "/version.txt");
  assert.ok(f.requests.some(url => url.startsWith(`/standalone-v${version}/`)));
  assert.equal(await readFile(path.join(prefix, "web/index.html"), "utf8"), version);
  const nextVersion = "2.0.1";
  await archive(f, nextVersion, target);
  f.files.set("/version.txt", nextVersion + "\n");
  await checked("sh", ["scripts/install.sh", "--prefix", prefix], env);
  assert.equal(await readFile(path.join(prefix, "web/index.html"), "utf8"), nextVersion);
  assert.equal(f.requests.filter(url => url === "/version.txt").length, 2);
});

test("Shell: reuse the registered directory when no prefix is supplied", async t => {
  const f = await fixture(t);
  const target = `${process.platform === "darwin" ? "macos" : "linux"}-${process.arch === "x64" ? "amd64" : process.arch}`;
  await archive(f, "2.0.1", target);
  const prefix = path.join(f.directory, "previous installation");
  const trace = path.join(f.directory, "trace.txt");
  await checked("sh", ["scripts/install.sh", "--version", "2.0.1"], {
    ...f.env, INSTALL_TEST_TRACE: trace, INSTALL_TEST_PREVIOUS_DIR: prefix,
  });
  assert.equal(await readFile(path.join(prefix, "web/index.html"), "utf8"), "2.0.1");
  assert.equal(await readFile(trace, "utf8"), "-stop\n-stop-core\n-install\n-no-browser\n");
  await assert.rejects(readFile(path.join(f.directory, ".local/share/LocalAIAgent/local-ai-agent")), { code: "ENOENT" });
});

test("PowerShell: the same installer reads the latest version again when upgrading", async t => {
  const pwsh = process.env.INSTALL_TEST_POWERSHELL || "pwsh";
  try { await run(pwsh, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"]); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    t.skip("PowerShell is not installed; set INSTALL_TEST_POWERSHELL to a portable pwsh.");
    return;
  }
  const f = await fixture(t);
  const script = path.join(f.directory, "install.ps1");
  await writeFile(script, (await readFile(path.join(root, "scripts/install.ps1"), "utf8")).replace(versionURL, f.base + "/version.txt"));
  const prefix = path.join(f.directory, "installed");
  const env = { ...f.env, INSTALL_TEST_TRACE: path.join(f.directory, "calls.txt"), PROCESSOR_ARCHITECTURE: "AMD64", PROCESSOR_ARCHITEW6432: "" };
  for (const version of ["3.0.0", "3.0.1"]) {
    await archive(f, version, "windows-amd64", true);
    f.files.set("/version.txt", version + "\n");
    await checked(pwsh, ["-NoProfile", "-File", script, "-Prefix", prefix], env);
    assert.equal((await readFile(path.join(prefix, "version.txt"), "utf8")).trim(), version);
  }
  assert.equal(f.requests.filter(url => url === "/version.txt").length, 2);
});

test("PowerShell: download, verify, and invoke the package installer for x64 and ARM64", async t => {
  const pwsh = process.env.INSTALL_TEST_POWERSHELL || "pwsh";
  try { await run(pwsh, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"]); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    t.skip("PowerShell is not installed; set INSTALL_TEST_POWERSHELL to a portable pwsh.");
    return;
  }
  const f = await fixture(t);
  const trace = path.join(f.directory, "calls.txt");
  const prefix = path.join(f.directory, "installation with spaces");
  const env = { ...f.env, INSTALL_TEST_TRACE: trace, PROCESSOR_ARCHITECTURE: "AMD64", PROCESSOR_ARCHITEW6432: "" };
  const install = (version, childEnv = env) => run(pwsh, ["-NoProfile", "-File", powershellInstaller, "-Version", version, "-Prefix", prefix], childEnv);

  await archive(f, "3.0.0", "windows-amd64", true);
  const first = await install("3.0.0");
  assert.equal(first.code, 0, first.output);
  assert.equal((await readFile(path.join(prefix, "version.txt"), "utf8")).trim(), "3.0.0");
  const deferred = await run(pwsh, ["-NoProfile", "-File", powershellInstaller, "-Version", "3.0.0", "-Prefix", prefix, "-DeferStart"], env);
  assert.equal(deferred.code, 0, deferred.output);
  assert.equal((await readFile(path.join(prefix, "deferred.txt"), "utf8")).trim(), "true");
  const reused = await run(pwsh, ["-NoProfile", "-File", powershellInstaller, "-Version", "3.0.0"], { ...env, INSTALL_TEST_PREVIOUS_DIR: prefix });
  assert.equal(reused.code, 0, reused.output);
  if (process.env.INSTALL_TEST_RELEASE_VERSION) {
    const version = process.env.INSTALL_TEST_RELEASE_VERSION;
    await archive(f, version, "windows-amd64", true);
    const pinned = await run(pwsh, ["-NoProfile", "-File", powershellInstaller], { ...env, INSTALL_TEST_PREVIOUS_DIR: prefix });
    assert.equal(pinned.code, 0, pinned.output);
    assert.equal((await readFile(path.join(prefix, "version.txt"), "utf8")).trim(), version);
  }

  const url = await archive(f, "3.0.1", "windows-arm64", true);
  const armEnv = { ...env, PROCESSOR_ARCHITECTURE: "AMD64", PROCESSOR_ARCHITEW6432: "ARM64" };
  const update = await install("3.0.1", armEnv);
  assert.equal(update.code, 0, update.output);
  assert.equal((await readFile(path.join(prefix, "version.txt"), "utf8")).trim(), "3.0.1");
  const calls = await readFile(trace, "utf8");
  const checksum = f.files.get(url + ".sha256");
  f.files.set(url + ".sha256", "0".repeat(64));
  const corrupted = await install("3.0.1", armEnv);
  assert.notEqual(corrupted.code, 0);
  assert.match(corrupted.output, /SHA-256 verification failed/);
  assert.equal(await readFile(trace, "utf8"), calls);
  assert.equal((await readFile(path.join(prefix, "version.txt"), "utf8")).trim(), "3.0.1");

  f.files.set(url + ".sha256", checksum);
  const failed = await install("3.0.1", { ...armEnv, INSTALL_TEST_INSTALL_FAIL: "1" });
  assert.notEqual(failed.code, 0);
  assert.match(failed.output, /Local AI Agent installation failed/);
  assert.equal(await readFile(trace, "utf8"), calls);

  const parser = path.join(f.directory, "parse.ps1");
  await writeFile(parser, "param([string]$File)\n$errors = $null; [System.Management.Automation.Language.Parser]::ParseFile($File, [ref]$null, [ref]$errors) > $null; if ($errors) { throw ($errors | Out-String) }\n");
  for (const file of ["scripts/install.ps1", "scripts/standalone/install.ps1"]) {
    await checked(pwsh, ["-NoProfile", "-File", parser, path.join(root, file)]);
  }
});
