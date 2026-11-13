#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = process.argv[2];
const platforms = {
  "windows-amd64": ["windows", "amd64"], "windows-arm64": ["windows", "arm64"],
  "macos-arm64": ["darwin", "arm64"], "macos-amd64": ["darwin", "amd64"],
  "linux-amd64": ["linux", "amd64"], "linux-arm64": ["linux", "arm64"],
};
if (!platforms[target]) throw new Error("Usage: node scripts/package-standalone.mjs windows-amd64|macos-arm64|macos-amd64|windows-arm64|linux-amd64|linux-arm64 [--skip-web]");
const version = process.env.LOCAL_AI_AGENT_VERSION || readFileSync(path.join(root, "scripts/standalone/version.txt"), "utf8").trim();
if (!/^[0-9][0-9A-Za-z.+-]*$/.test(version)) throw new Error("Invalid version");
function run(command, args, cwd = root, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}
if (!process.argv.includes("--skip-web")) {
  run("npm", ["run", "typecheck"], path.join(root, "runtime/web"));
  run("npm", ["run", "build"], path.join(root, "runtime/web"));
}
const name = `local-ai-agent-${version}-${target}`;
const destination = path.join(root, "build/standalone", version);
const bundle = path.join(destination, name);
rmSync(bundle, { recursive: true, force: true });
mkdirSync(bundle, { recursive: true });
const [goos, goarch] = platforms[target];
const executable = goos === "windows" ? "local-ai-agent.exe" : "local-ai-agent";
run("go", ["build", "-trimpath", `-ldflags=-s -w -X main.version=${version}`, "-o", path.join(bundle, executable), "./server/cmd/mindfs-server"], path.join(root, "runtime"), { ...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: "0" });
cpSync(path.join(root, "runtime/web/dist"), path.join(bundle, "web"), { recursive: true });
for (const file of ["agents.json", "task_template.json"]) cpSync(path.join(root, "runtime", file), path.join(bundle, file));
for (const file of ["LICENSE", "NOTICE.md"]) cpSync(path.join(root, file), path.join(bundle, file));
mkdirSync(path.join(bundle, "licenses"));
for (const [source, filename] of [["codex-go-sdk/LICENSE", "codex-sdk.txt"], ["claude-agent-sdk-go/LICENSE", "claude-sdk.txt"], ["jsonschema-v6-LICENSE", "jsonschema.txt"]]) {
  cpSync(path.join(root, "runtime/third_party", source), path.join(bundle, "licenses", filename));
}
cpSync(path.join(root, "scripts/standalone", goos === "windows" ? "install.ps1" : "install.sh"), path.join(bundle, goos === "windows" ? "install.ps1" : "install.sh"));
cpSync(path.join(root, "docs/standalone.md"), path.join(bundle, "README.md"));
const output = path.join(destination, name + (goos === "windows" ? ".zip" : ".tar.gz"));
rmSync(output, { force: true });
if (goos === "windows") run("zip", ["-qr", output, name], destination);
else run("tar", ["-czf", output, name], destination, { ...process.env, COPYFILE_DISABLE: "1" });
checksum(output);

if (goos === "windows") {
  const installer = path.join(destination, "install.ps1");
  cpSync(path.join(root, "scripts/install.ps1"), installer);
  checksum(installer);
}

if (goos !== "windows") {
  const onlineInstaller = path.join(destination, "install.sh");
  cpSync(path.join(root, "scripts/install.sh"), onlineInstaller);
  checksum(onlineInstaller);
  const installer = path.join(destination, name + ".sh");
  const header = `#!/bin/sh
set -eu
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' 0
trap 'exit 1' HUP INT TERM
payload_line=$(awk '/^__LOCAL_AI_AGENT_ARCHIVE__$/ { print NR + 1; exit }' "$0")
tail -n +"$payload_line" "$0" | tar -xz -C "$work_dir"
sh "$work_dir/${name}/install.sh" "$@"
exit 0
__LOCAL_AI_AGENT_ARCHIVE__
`;
  writeFileSync(installer, Buffer.concat([Buffer.from(header), readFileSync(output)]), { mode: 0o755 });
  checksum(installer);
}

function checksum(file) {
  const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
  writeFileSync(file + ".sha256", `${digest}  ${path.basename(file)}\n`);
  console.log(`Package: ${file}\nSHA-256: ${digest}`);
}
