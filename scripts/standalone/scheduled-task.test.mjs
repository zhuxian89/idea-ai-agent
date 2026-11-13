import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const backend = fileURLToPath(new URL("../../runtime/server/internal/backend/", import.meta.url));
const pwsh = process.env.INSTALL_TEST_POWERSHELL || "pwsh";

async function fixture(t) {
  try {
    await exec(pwsh, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"]);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    t.skip("PowerShell is not installed; set INSTALL_TEST_POWERSHELL.");
    return;
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), "scheduled-task-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("Scheduled tasks: registration, login/restart policy and lifecycle commands", async t => {
  const dir = await fixture(t);
  if (!dir) return;
  const config = {
    name: "LocalAIAgent-test-core", user_id: "S-1-5-21-1234",
    powershell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    runner: "C:\\Users\\测试 用户\\Local AI Agent\\run.ps1",
  };
  const configPath = path.join(dir, "任务 配置.json");
  await writeFile(configPath, JSON.stringify(config));
  const harness = path.join(dir, "control-test.ps1");
  // The real control script runs against cmdlet substitutes on non-Windows hosts.
  await writeFile(harness, `param($Control, $ConfigPath)
$ErrorActionPreference = 'Stop'
function New-ScheduledTaskAction { param($Execute, $Argument) return @{ execute=$Execute; argument=$Argument } }
function New-ScheduledTaskTrigger { param([switch]$AtLogOn, $User) return @{ login=$AtLogOn.IsPresent; user=$User } }
function New-ScheduledTaskPrincipal { param($UserId, $LogonType, $RunLevel) return @{ user=$UserId; logon=$LogonType; level=$RunLevel } }
function New-ScheduledTaskSettingsSet {
  param($ExecutionTimeLimit, $RestartCount, $RestartInterval, $MultipleInstances,
    [switch]$StartWhenAvailable, [switch]$AllowStartIfOnBatteries, [switch]$DontStopIfGoingOnBatteries)
  return @{ limit=$ExecutionTimeLimit.TotalSeconds; restarts=$RestartCount; interval=$RestartInterval.TotalSeconds;
    instances=$MultipleInstances; available=$StartWhenAvailable.IsPresent;
    battery=$AllowStartIfOnBatteries.IsPresent; keepBattery=$DontStopIfGoingOnBatteries.IsPresent }
}
function Register-ScheduledTask { param($TaskName, $Action, $Trigger, $Principal, $Settings, [switch]$Force)
  $global:Registered = @{ name=$TaskName; action=$Action; trigger=$Trigger; principal=$Principal; settings=$Settings; force=$Force.IsPresent }
}
$global:Calls = @()
$global:Checks = 0
function Start-ScheduledTask { param($TaskName) $global:Calls += "start:$TaskName" }
function Stop-ScheduledTask { param($TaskName) $global:Calls += "stop:$TaskName" }
function Get-ScheduledTask { param($TaskName) $global:Checks++; if ($global:Checks -eq 1) { return @{ State='Running' } }; return @{ State='Ready' } }
function Unregister-ScheduledTask { param($TaskName, [switch]$Confirm) $global:Calls += "remove:$TaskName"; if ($Confirm) { throw 'Unexpected prompt' } }
foreach ($Operation in @('install','start','stop','remove')) { & $Control $Operation $ConfigPath }
@{ registered=$global:Registered; calls=$global:Calls; checks=$global:Checks } | ConvertTo-Json -Depth 6 -Compress
`);
  const { stdout } = await exec(pwsh, ["-NoProfile", "-File", harness, path.join(backend, "scheduled_task_control.ps1"), configPath]);
  const result = JSON.parse(stdout);
  const task = result.registered;
  assert.equal(task.name, config.name);
  assert.equal(task.force, true);
  assert.equal(task.action.execute, config.powershell);
  assert.ok(task.action.argument.endsWith(`-File "${config.runner}" "${configPath}"`));
  assert.match(task.action.argument, /-WindowStyle Hidden/);
  assert.deepEqual(task.trigger, { login: true, user: config.user_id });
  assert.deepEqual(task.principal, { user: config.user_id, logon: "Interactive", level: "Limited" });
  assert.deepEqual(task.settings, { limit: 0, restarts: 999, interval: 60, instances: "IgnoreNew", available: true, battery: true, keepBattery: true });
  assert.deepEqual(result.calls, ["start", "stop", "remove"].map(operation => `${operation}:${config.name}`));
  assert.equal(result.checks, 2);
});

test("Scheduled runner: preserves arguments/environment, appends logs and returns exit codes", async t => {
  const dir = await fixture(t);
  if (!dir) return;
  const program = path.join(dir, "sample child.cjs");
  await writeFile(program, `console.log(JSON.stringify({ args: process.argv.slice(2), value: process.env.INSTALL_RUNNER_VALUE })); console.error('stderr log'); process.exit(Number(process.env.INSTALL_RUNNER_EXIT));`);
  const configPath = path.join(dir, "config.json");
  const log = path.join(dir, "service.log");
  for (const code of [0, 23]) {
    await writeFile(configPath, JSON.stringify({
      executable: process.execPath, arguments: [program, "参数 with spaces", "-foreground"],
      environment: { INSTALL_RUNNER_VALUE: "value with spaces", INSTALL_RUNNER_EXIT: String(code) }, log,
    }));
    try {
      await exec(pwsh, ["-NoProfile", "-File", path.join(backend, "scheduled_task_run.ps1"), configPath]);
      assert.equal(code, 0);
    } catch (error) {
      assert.equal(error.code, code);
    }
  }
  const lines = (await readFile(log, "utf8")).replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  assert.equal(lines.length, 4);
  for (let i = 0; i < 4; i += 2) {
    assert.deepEqual(JSON.parse(lines[i]), { args: ["参数 with spaces", "-foreground"], value: "value with spaces" });
    assert.equal(lines[i + 1], "stderr log");
  }
});

test("Scheduled runner: empty core options start successfully with PowerShell Legacy argument passing", async t => {
  const dir = await fixture(t);
  if (!dir) return;
  const executable = path.join(dir, process.platform === "win32" ? "local-ai-agent.exe" : "local-ai-agent");
  await exec("go", ["build", "-o", executable, "./server/cmd/mindfs-server"], {
    cwd: fileURLToPath(new URL("../../runtime/", import.meta.url)), timeout: 120_000,
  });
  const discovery = path.join(dir, "remote");
  await mkdir(discovery);
  const env = { ...process.env, HOME: dir, USERPROFILE: dir, PATH: "", IDE_AGENT_REMOTE_HOST_DIR: discovery,
    IDE_AGENT_DATA_DIR: discovery, MINDFS_RELAY_BASE_URL: "http://127.0.0.1:1" };
  delete env.IDE_AGENT_TOKEN;
  const configPath = path.join(dir, "core-task.json");
  await writeFile(configPath, JSON.stringify({ executable,
    arguments: ["--local-core", "--agent-config=", "--notify-script=", "--web-push=false"],
    environment: {}, log: path.join(dir, "core.log"),
  }));
  const harness = path.join(dir, "legacy.ps1");
  await writeFile(harness, "param($Runner,$Config)\n$PSNativeCommandArgumentPassing = 'Legacy'\n& $Runner $Config\nexit $LASTEXITCODE\n");
  const child = spawn(pwsh, ["-NoProfile", "-File", harness, path.join(backend, "scheduled_task_run.ps1"), configPath], {env, stdio:"ignore"});
  const exited = once(child, "exit");
  try {
    const deadline = Date.now() + 15_000;
    let descriptor;
    while (!descriptor && Date.now() < deadline && child.exitCode === null) {
      try { descriptor = JSON.parse(await readFile(path.join(discovery, "core.json"), "utf8")); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (!descriptor) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(descriptor, `Core did not start: ${await readFile(path.join(dir,"core.log"),"utf8")}`);
    assert.equal(descriptor.mode, "core");
    const response = await fetch(`${descriptor.url}/control/status`, {headers:{Authorization:`Bearer ${descriptor.token}`}});
    assert.equal(response.status, 200);
    assert.equal((await response.json()).protocol, 1);
  } finally {
    await exec(executable, ["-stop-core"], {env, timeout:15_000});
    const [code] = await exited;
    assert.equal(code, 0);
  }
});
