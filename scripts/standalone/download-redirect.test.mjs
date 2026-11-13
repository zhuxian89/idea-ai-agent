import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function run(command, script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["-NoProfile", "-NonInteractive", "-File", script, ...args]);
    let output = "";
    child.stdout.on("data", data => { output += data; });
    child.stderr.on("data", data => { output += data; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, output }));
  });
}

// Windows 默认覆盖插件实际调用的 5.1；其他平台可用 pwsh 检查同一下载函数。
const runtimes = process.env.INSTALL_TEST_POWERSHELL ? [process.env.INSTALL_TEST_POWERSHELL]
  : process.platform === "win32" ? ["powershell.exe", "pwsh"] : ["pwsh"];

for (const runtime of runtimes) test(`PowerShell download redirects and errors: ${runtime}`, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "standalone-redirect-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = path.join(directory, "download.ps1");
  const source = await readFile(new URL("../install.ps1", import.meta.url), "utf8");
  const functionStart = source.indexOf("function Get-HttpsContent {");
  const functionEnd = source.indexOf("\n$Architecture =", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  await writeFile(script, `param([string]$Uri, [string]$OutFile, [switch]$RequireHttps)
$ErrorActionPreference = 'Stop'
$AllowInsecure = -not $RequireHttps
${source.slice(functionStart, functionEnd)}
$result = Get-HttpsContent -Uri $Uri -OutFile $OutFile
if (-not $OutFile) { Write-Output $result.Content }
`);
  try { await run(runtime, script, ["-Uri", "http://127.0.0.1:1", "-RequireHttps"]); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    t.skip(`${runtime} is not installed`);
    return;
  }

  const bytes = Buffer.from([0, 128, 255, 13, 10, 42]);
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    const redirect = /^\/redirect\/(301|302|303|307|308)$/.exec(request.url);
    if (redirect) { response.writeHead(Number(redirect[1]), { Location: "../archive" }); response.end(); }
    else if (request.url === "/chain") { response.writeHead(302, { Location: "/redirect/307" }); response.end(); }
    else if (request.url === "/loop") { response.writeHead(302, { Location: "/loop" }); response.end(); }
    else if (request.url === "/missing-location") { response.writeHead(302); response.end(); }
    else if (request.url === "/archive") { response.writeHead(200); response.end(bytes); }
    else if (request.url === "/version") { response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }); response.end("0.1.27\n"); }
    else { response.writeHead(404); response.end("Not found"); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const output = path.join(directory, "download.zip");
  for (const route of ["/archive", ...[301, 302, 303, 307, 308].map(status => `/redirect/${status}`), "/chain"]) {
    const result = await run(runtime, script, ["-Uri", base + route, "-OutFile", output]);
    assert.equal(result.code, 0, result.output);
    assert.deepEqual(await readFile(output), bytes);
  }
  const metadata = await run(runtime, script, ["-Uri", base + "/version"]);
  assert.equal(metadata.code, 0, metadata.output);
  assert.equal(metadata.output.trim(), "0.1.27");
  for (const [route, message] of [["/loop", /Too many redirects/], ["/missing-location", /HTTP 302/], ["/not-found", /404/]]) {
    requests.length = 0;
    const result = await run(runtime, script, ["-Uri", base + route, "-OutFile", output]);
    assert.notEqual(result.code, 0);
    assert.match(result.output, message);
    assert.deepEqual(await readFile(output), bytes);
    if (route === "/loop") assert.equal(requests.length, 5);
  }
  requests.length = 0;
  const insecure = await run(runtime, script, ["-Uri", base + "/archive", "-RequireHttps"]);
  assert.notEqual(insecure.code, 0);
  assert.match(insecure.output, /Refusing a non-HTTPS download/);
  assert.equal(requests.length, 0);
});
