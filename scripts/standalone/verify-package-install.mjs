#!/usr/bin/env node
// verify-package-install.mjs <local-ai-agent-VERSION-PLATFORM.tar.gz>
//
// Installs the FINAL macOS or Linux archive in a throw-away HOME and prefix, with `--defer-start`, so nothing is
// started and no login service is registered. Checks, on the program that was built for this machine:
//   1. a first installation that fails half way (the web directory is missing) leaves nothing behind;
//   2. the same package then installs from the self-extracting `.sh` that ships next to the archive;
//   3. the installed program reports the prefix and records itself for IDEA discovery;
//   4. installing over an existing installation is refused and leaves it intact.
// It never touches an installed service: HOME, XDG_CONFIG_HOME and every IDE_AGENT_* / MINDFS_* variable
// are replaced, so the data and discovery directories live in the temporary HOME.
// Starting the service, upgrading a running one and the failed-upgrade restart need a real service manager;
// they stay with verify-linux-self-update.py (Linux) and the local upgrade of the installed service (macOS).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const archive = process.argv[2] && path.resolve(process.argv[2]);
if (!archive || !/\.tar\.gz$/.test(archive)) { console.error('usage: verify-package-install.mjs <archive.tar.gz>'); process.exit(2); }
const name = path.basename(archive).replace(/\.tar\.gz$/, '');
const selfExtracting = path.join(path.dirname(archive), name + '.sh');
const home = mkdtempSync(path.join(os.tmpdir(), 'package-install-'));
const runtimeDir = path.join(home, 'run');
mkdirSync(runtimeDir, { mode: 0o700 });
const env = {
  PATH: process.env.PATH,
  HOME: home,
  XDG_CONFIG_HOME: path.join(home, '.config'),
  XDG_RUNTIME_DIR: runtimeDir,
  DBUS_SESSION_BUS_ADDRESS: `unix:path=${path.join(runtimeDir, 'bus')}`,
  TMPDIR: process.env.TMPDIR || os.tmpdir(),
};
let step = 0;
const log = (message) => console.log(`  ${++step}. ${message}`);
const run = (command, args, options = {}) => spawnSync(command, args, { env, encoding: 'utf8', timeout: 60_000, ...options });
try {
  const extracted = path.join(home, 'extracted');
  execFileSync('mkdir', ['-p', extracted]);
  execFileSync('tar', ['-xzf', archive, '-C', extracted]);
  const bundle = path.join(extracted, name);
  assert.ok(existsSync(path.join(bundle, 'install.sh')), 'install.sh is missing in the package');

  // 1. a failed first installation leaves no program and no record
  const broken = path.join(home, 'broken');
  execFileSync('cp', ['-R', bundle, broken]);
  rmSync(path.join(broken, 'web'), { recursive: true });
  const brokenPrefix = path.join(home, 'prefix-broken');
  const failed = run('sh', [path.join(broken, 'install.sh'), brokenPrefix, '--defer-start']);
  assert.notEqual(failed.status, 0, 'installing a package without web/ must fail');
  assert.ok(!existsSync(path.join(brokenPrefix, 'local-ai-agent')), 'a failed first installation left the program behind');
  assert.ok(!existsSync(path.join(brokenPrefix, '.upgrade')), 'a failed installation left its staging directory');
  log('a half finished first installation leaves nothing installed, so it can simply be retried');

  // 2. a fresh installation through the self-extracting installer
  const prefix = path.join(home, 'prefix');
  const fresh = existsSync(selfExtracting)
    ? run('sh', [selfExtracting, prefix, '--defer-start'])
    : run('sh', [path.join(bundle, 'install.sh'), prefix, '--defer-start']);
  assert.equal(fresh.status, 0, `fresh installation failed: ${fresh.stderr}${fresh.stdout}`);
  for (const f of ['local-ai-agent', 'agents.json', 'task_template.json', 'LICENSE', 'NOTICE.md', 'web/index.html', 'licenses']) {
    assert.ok(existsSync(path.join(prefix, f)), `${f} was not installed`);
  }
  assert.ok(!existsSync(path.join(prefix, '.upgrade')), 'the staging directory was not cleaned up');
  log(`fresh installation through ${existsSync(selfExtracting) ? path.basename(selfExtracting) : 'install.sh'}`);

  // 3. the program is the one from the archive, finds its prefix and registered itself for discovery
  assert.ok(readFileSync(path.join(prefix, 'local-ai-agent')).equals(readFileSync(path.join(bundle, 'local-ai-agent'))), 'the installed program differs from the archive');
  const printed = run(path.join(prefix, 'local-ai-agent'), ['-installation-dir']);
  assert.equal(printed.status, 0, printed.stderr);
  assert.equal(realpathSync(printed.stdout.trim()), realpathSync(prefix), 'the program reports another installation directory');
  const records = [];
  const find = (dir) => readdirSync(dir, { withFileTypes: true }).forEach((e) => { const p = path.join(dir, e.name); if (e.isDirectory()) find(p); else if (e.name === 'installation.json') records.push(p); });
  find(home);
  assert.equal(records.length, 1, `expected one installation record, found ${records.length}`);
  assert.equal(realpathSync(JSON.parse(readFileSync(records[0], 'utf8')).executable), realpathSync(path.join(prefix, 'local-ai-agent')));
  log('the installed program equals the archive, reports its prefix and is recorded for IDEA discovery');

  // 4. installing over an existing installation is refused without damage
  const before = readFileSync(path.join(prefix, 'local-ai-agent'));
  const again = run('sh', [path.join(bundle, 'install.sh'), prefix, '--defer-start']);
  assert.notEqual(again.status, 0, 'a second --defer-start installation must be refused');
  assert.ok(readFileSync(path.join(prefix, 'local-ai-agent')).equals(before), 'the refused installation changed the program');
  assert.ok(existsSync(path.join(prefix, 'web/index.html')));
  log('installing over an existing installation is refused and leaves it intact');
  console.log(`OK: ${name} installs cleanly in an isolated HOME`);
} catch (error) {
  console.error(`FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(home, { recursive: true, force: true });
}
