#!/usr/bin/env node
// release-plan.mjs        (reads VERSION, TARGETS, CHANGES, REF_NAME and optionally GITHUB_OUTPUT from the environment)
//
// First step of .github/workflows/release-standalone.yml: refuses a run that must not produce a release, and
// turns the inputs into the facts the later jobs switch on. Prints the plan; with GITHUB_OUTPUT set it also
// writes `targets`, one `<platform>=true|false` per platform and `notes_source`.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS, parseTargets } from './verify-release-assets.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

export function plan({ version, targets, changes, refName, defaultVersion, notesFileExists }) {
  const problems = [];
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$/.test(version || '')) problems.push(`"${version}" is not a version like 0.1.64 or 0.1.64-standalone.1`);
  if (version && version === defaultVersion) problems.push(`${version} is the published default version (scripts/standalone/version.txt); a version that was published is never reused`);
  if (!refName || refName === 'main') problems.push('run this workflow from a branch named standalone-<version>, never from main: nothing reaches main before the packages are verified');
  else if (version && refName !== `standalone-${version}`) problems.push(`branch "${refName}" does not match version "${version}": run from branch standalone-${version}`);
  let list = [];
  try { list = parseTargets(targets); } catch (error) { problems.push(error.message); }
  if (!(changes || '').trim() && !notesFileExists) problems.push('no release notes: fill in the "changes" input or commit .github/release-notes/standalone-<version>.md');
  return { problems, targets: list };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { VERSION: version = '', TARGETS: targets = 'all', CHANGES: changes = '', REF_NAME: refName = '' } = process.env;
  const notesFile = `.github/release-notes/standalone-${version}.md`;
  const defaultVersion = readFileSync(path.join(repoRoot, 'scripts/standalone/version.txt'), 'utf8').trim();
  const result = plan({ version, targets, changes, refName, defaultVersion, notesFileExists: existsSync(path.join(repoRoot, notesFile)) });
  if (result.problems.length) {
    for (const p of result.problems) console.error(`::error::${p}`);
    process.exit(1);
  }
  const lines = [`targets=${result.targets.join(',')}`, `notes_source=${changes.trim() ? 'input' : notesFile}`];
  for (const t of Object.keys(TARGETS)) lines.push(`${t.replaceAll('-', '_')}=${result.targets.includes(t)}`);
  console.log(`Releasing ${version} for: ${result.targets.join(', ')}${result.targets.length === Object.keys(TARGETS).length ? '' : ' (test build of some platforms)'}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
  else console.log(lines.join('\n'));
}
