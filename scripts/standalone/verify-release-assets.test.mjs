import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TARGETS, detectBinary, expectedAssets, parseTargets, verifyAssets } from "./verify-release-assets.mjs";

const VERSION = "9.9.9";
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const MARKER = "__LOCAL_AI_AGENT_ARCHIVE__\n";

// Minimal executables with a valid header for the platform and CPU, so the real checks run on them.
function fakeExecutable(os_, arch) {
  const buf = Buffer.alloc(0x200);
  if (os_ === "linux") {
    buf.writeUInt32BE(0x7f454c46, 0); buf[4] = 2; buf.writeUInt16LE(arch === "amd64" ? 0x3e : 0xb7, 18);
  } else if (os_ === "darwin") {
    buf.writeUInt32LE(0xfeedfacf, 0); buf.writeUInt32LE(arch === "amd64" ? 0x01000007 : 0x0100000c, 4);
  } else {
    buf[0] = 0x4d; buf[1] = 0x5a; buf.writeUInt32LE(0x80, 0x3c);
    buf.writeUInt32LE(0x4550, 0x80); buf.writeUInt16LE(arch === "amd64" ? 0x8664 : 0xaa64, 0x84); buf.writeUInt16LE(0x20b, 0x80 + 24);
  }
  return Buffer.concat([buf, Buffer.from(`main.version=${VERSION}\0`)]);
}

function sha(file) {
  const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
  writeFileSync(file + ".sha256", `${digest}  ${path.basename(file)}\n`);
}

// A tiny repository and the 24 assets built from it, laid out like scripts/package-standalone.mjs does.
function release(targets = Object.keys(TARGETS)) {
  const root = mkdtempSync(path.join(os.tmpdir(), "release-assets-test-"));
  const files = {
    "scripts/install.sh": "#!/bin/sh\necho online\n",
    "scripts/standalone/install.sh": "#!/bin/sh\necho package\n",
    "runtime/web/dist/index.html": "<html></html>",
    "runtime/web/dist/assets/app.js": "console.log('app')",
  };
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), text);
  }
  writeFileSync(path.join(root, "scripts/standalone/download.ps1"), Buffer.concat([BOM, Buffer.from("# download\n")]));
  writeFileSync(path.join(root, "scripts/standalone/install.ps1"), Buffer.concat([BOM, Buffer.from("# install\n")]));
  const dir = path.join(root, "assets");
  mkdirSync(dir);
  for (const [target, t] of Object.entries(TARGETS).filter(([k]) => targets.includes(k))) {
    const name = `local-ai-agent-${VERSION}-${target}`;
    const bundle = path.join(root, "work", name);
    mkdirSync(path.join(bundle, "web"), { recursive: true });
    writeFileSync(path.join(bundle, t.exe), fakeExecutable(t.os, t.arch));
    chmodSync(path.join(bundle, t.exe), 0o755);
    for (const f of ["agents.json", "task_template.json", "LICENSE", "NOTICE.md", "README.md"]) writeFileSync(path.join(bundle, f), f);
    cpSync(path.join(root, "runtime/web/dist"), path.join(bundle, "web"), { recursive: true });
    const script = t.os === "windows" ? "install.ps1" : "install.sh";
    cpSync(path.join(root, "scripts/standalone", script), path.join(bundle, script));
    const archive = path.join(dir, `${name}.${t.archive}`);
    if (t.archive === "zip") execFileSync("zip", ["-qr", archive, name], { cwd: path.join(root, "work") });
    else execFileSync("tar", ["-czf", archive, name], { cwd: path.join(root, "work") });
    sha(archive);
    if (t.os !== "windows") {
      const header = `#!/bin/sh\nset -eu\nsh "$work_dir/${name}/install.sh" "$@"\nexit 0\n${MARKER}`;
      const installer = path.join(dir, `${name}.sh`);
      writeFileSync(installer, Buffer.concat([Buffer.from(header), readFileSync(archive)]), { mode: 0o755 });
      sha(installer);
    }
  }
  const entries = [];
  if (targets.some((k) => TARGETS[k].os !== "windows")) entries.push(["scripts/install.sh", "install.sh"]);
  if (targets.some((k) => TARGETS[k].os === "windows")) entries.push(["scripts/standalone/download.ps1", "install.ps1"]);
  for (const [from, to] of entries) {
    cpSync(path.join(root, from), path.join(dir, to));
    sha(path.join(dir, to));
  }
  return { root, dir, targets };
}
const check = (r) => verifyAssets(r.dir, VERSION, r.root, () => {}, { skipBuildInfo: true, targets: r.targets });
const repack = (r, target, edit) => {
  const t = TARGETS[target];
  const name = `local-ai-agent-${VERSION}-${target}`;
  const work = path.join(r.root, "repack");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work);
  const archive = path.join(r.dir, `${name}.${t.archive}`);
  if (t.archive === "zip") execFileSync("unzip", ["-q", archive, "-d", work]); else execFileSync("tar", ["-xzf", archive, "-C", work]);
  edit(path.join(work, name));
  rmSync(archive);
  if (t.archive === "zip") execFileSync("zip", ["-qr", archive, name], { cwd: work }); else execFileSync("tar", ["-czf", archive, name], { cwd: work });
  sha(archive);
};

test("a correct release passes every gate", () => {
  const r = release();
  try { assert.deepEqual(check(r), []); } finally { rmSync(r.root, { recursive: true, force: true }); }
});

test("asset set and checksum files are enforced", () => {
  const r = release();
  try {
    assert.equal(expectedAssets(VERSION).length, 24);
    rmSync(path.join(r.dir, `local-ai-agent-${VERSION}-linux-arm64.tar.gz`));
    assert.ok(check(r).some((f) => /missing asset: local-ai-agent-9\.9\.9-linux-arm64\.tar\.gz$/.test(f)));
    writeFileSync(path.join(r.dir, "stray.txt"), "x");
    assert.ok(check(r).some((f) => f === "unexpected asset: stray.txt"));
  } finally { rmSync(r.root, { recursive: true, force: true }); }
  const r2 = release();
  try {
    writeFileSync(path.join(r2.dir, "install.sh.sha256"), `${"0".repeat(64)}  install.sh\n`);
    assert.ok(check(r2).some((f) => /install\.sh\.sha256: does not match/.test(f)));
  } finally { rmSync(r2.root, { recursive: true, force: true }); }
});

test("the program must be built for the platform in its name", () => {
  const r = release();
  try {
    repack(r, "linux-amd64", (bundle) => writeFileSync(path.join(bundle, "local-ai-agent"), fakeExecutable("linux", "arm64")));
    assert.ok(check(r).some((f) => /linux-amd64\.tar\.gz: program is linux\/arm64, expected linux\/amd64/.test(f)));
  } finally { rmSync(r.root, { recursive: true, force: true }); }
});

test("package scripts must equal the sources and PowerShell scripts need a BOM", () => {
  const r = release();
  try {
    repack(r, "macos-arm64", (bundle) => writeFileSync(path.join(bundle, "install.sh"), "#!/bin/sh\necho tampered\n"));
    assert.ok(check(r).some((f) => /macos-arm64\.tar\.gz: install\.sh differs/.test(f)));
  } finally { rmSync(r.root, { recursive: true, force: true }); }
  const r2 = release();
  try {
    repack(r2, "windows-amd64", (bundle) => writeFileSync(path.join(bundle, "install.ps1"), "# install\n"));
    const failures = check(r2);
    assert.ok(failures.some((f) => /windows-amd64\.zip: install\.ps1 differs/.test(f)));
    assert.ok(failures.some((f) => /windows-amd64\.zip: install\.ps1 has no UTF-8 BOM/.test(f)));
  } finally { rmSync(r2.root, { recursive: true, force: true }); }
});

test("the web directory must be exactly dist and must not point at relay assets", () => {
  const r = release();
  try {
    repack(r, "linux-arm64", (bundle) => writeFileSync(path.join(bundle, "web/assets/app.js"), "fetch('/mindfs-assets/app.js')"));
    const failures = check(r);
    assert.ok(failures.some((f) => /linux-arm64\.tar\.gz: web\/assets\/app\.js differs from runtime\/web\/dist/.test(f)));
  } finally { rmSync(r.root, { recursive: true, force: true }); }
  const r2 = release();
  try {
    repack(r2, "windows-arm64", (bundle) => rmSync(path.join(bundle, "web/assets"), { recursive: true }));
    assert.ok(check(r2).some((f) => /windows-arm64\.zip: web files differ from runtime\/web\/dist \(1 vs 2\)/.test(f)));
  } finally { rmSync(r2.root, { recursive: true, force: true }); }
});

test("the self-extracting installer must carry exactly its archive", () => {
  const r = release();
  try {
    const sh = path.join(r.dir, `local-ai-agent-${VERSION}-macos-amd64.sh`);
    writeFileSync(sh, Buffer.concat([readFileSync(sh), Buffer.from("trailing")]), { mode: 0o755 });
    sha(sh);
    assert.ok(check(r).some((f) => /macos-amd64\.sh: embedded archive differs from .*macos-amd64\.tar\.gz/.test(f)));
  } finally { rmSync(r.root, { recursive: true, force: true }); }
});

test("online entries must equal the sources", () => {
  const r = release();
  try {
    writeFileSync(path.join(r.dir, "install.sh"), "#!/bin/sh\necho other\n");
    sha(path.join(r.dir, "install.sh"));
    assert.ok(check(r).some((f) => f === "install.sh differs from scripts/install.sh"));
  } finally { rmSync(r.root, { recursive: true, force: true }); }
});

test("executable headers are read for every platform", () => {
  assert.deepEqual(detectBinary(fakeExecutable("linux", "amd64")), { os: "linux", arch: "amd64" });
  assert.deepEqual(detectBinary(fakeExecutable("darwin", "arm64")), { os: "darwin", arch: "arm64" });
  assert.deepEqual(detectBinary(fakeExecutable("windows", "arm64")), { os: "windows", arch: "arm64" });
  assert.deepEqual(detectBinary(Buffer.from("not an executable")), { os: "unknown", arch: "unknown" });
});

test("a test build of one platform needs only its own assets", () => {
  assert.deepEqual(parseTargets("all"), Object.keys(TARGETS));
  assert.deepEqual(parseTargets("macos-arm64, windows-amd64"), ["macos-arm64", "windows-amd64"]);
  assert.throws(() => parseTargets("macos-arm64,beos"), /unknown target\(s\): beos/);
  assert.deepEqual(expectedAssets(VERSION, ["windows-amd64"]), [
    "install.ps1", "install.ps1.sha256",
    `local-ai-agent-${VERSION}-windows-amd64.zip`, `local-ai-agent-${VERSION}-windows-amd64.zip.sha256`,
  ]);
  assert.equal(expectedAssets(VERSION, ["macos-arm64"]).length, 6); // archive, .sh, install.sh and their checksums
  assert.equal(expectedAssets(VERSION, ["macos-arm64", "linux-amd64"]).length, 10);

  for (const targets of [["windows-amd64"], ["macos-arm64"], ["macos-arm64", "windows-arm64"]]) {
    const r = release(targets);
    try {
      assert.deepEqual(check(r), [], targets.join());
      // the same files are not a complete release
      assert.ok(verifyAssets(r.dir, VERSION, r.root, () => {}, { skipBuildInfo: true }).some((f) => f.startsWith("missing asset:")));
    } finally { rmSync(r.root, { recursive: true, force: true }); }
  }
  // a gate still bites inside a partial build
  const r = release(["windows-amd64"]);
  try {
    repack(r, "windows-amd64", (bundle) => writeFileSync(path.join(bundle, "install.ps1"), "# install\n"));
    assert.ok(check(r).some((f) => /windows-amd64\.zip: install\.ps1 differs/.test(f)));
  } finally { rmSync(r.root, { recursive: true, force: true }); }
});
