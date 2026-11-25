#!/usr/bin/env node
// release-plan.mjs        (reads VERSION, TARGETS, MODE, CHANGES, REF_NAME and optionally GITHUB_OUTPUT from the environment)
//
// First step of .github/workflows/release-standalone.yml: refuses a run that must not produce a release, and
// turns the inputs into the facts the later jobs switch on. Prints the plan; with GITHUB_OUTPUT set it also
// writes `targets`, `mode`, one `<platform>=true|false` per platform and `notes_source`.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS, parseTargets } from './verify-release-assets.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const MODES = new Set(['draft', 'prerelease', 'formal']);

export function plan({ version, targets, mode = 'draft', changes, refName, defaultVersion, notesFileExists }) {
  const problems = [];
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$/.test(version || '')) {
    problems.push(`"${version}" is not a version like 0.1.65 or 0.1.65-standalone.1`);
  }
  if (version && version === defaultVersion) {
    problems.push(`${version} is the published default version (scripts/standalone/version.txt); a version that was published is never reused`);
  }
  const normalizedMode = (mode || 'draft').trim();
  if (!MODES.has(normalizedMode)) {
    problems.push(`unknown mode "${mode}": choose draft, prerelease or formal`);
  }
  if (!refName) {
    problems.push('missing REF_NAME: run this workflow from main or branch standalone-<version>');
  } else if (refName !== 'main' && version && refName !== `standalone-${version}`) {
    problems.push(`branch "${refName}" does not match version "${version}": run from branch standalone-${version} or main`);
  }
  let list = [];
  try {
    list = parseTargets(targets);
  } catch (error) {
    problems.push(error.message);
  }
  if (normalizedMode === 'formal' && list.length > 0 && list.length !== Object.keys(TARGETS).length) {
    problems.push('formal mode updates scripts/standalone/version.txt for every platform, so targets must be "all"');
  }
  if (!(changes || '').trim() && !notesFileExists) {
    problems.push('no release notes: fill in the "changes" input or commit .github/release-notes/standalone-<version>.md');
  }
  return { problems, targets: list, mode: normalizedMode };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const {
    VERSION: version = '',
    TARGETS: targets = 'all',
    MODE: mode = 'draft',
    CHANGES: changes = '',
    REF_NAME: refName = '',
  } = process.env;
  const notesFile = `.github/release-notes/standalone-${version}.md`;
  const defaultVersion = readFileSync(path.join(repoRoot, 'scripts/standalone/version.txt'), 'utf8').trim();
  const result = plan({
    version,
    targets,
    mode,
    changes,
    refName,
    defaultVersion,
    notesFileExists: existsSync(path.join(repoRoot, notesFile)),
  });
  if (result.problems.length) {
    for (const p of result.problems) console.error(`::error::${p}`);
    process.exit(1);
  }
  const lines = [
    `targets=${result.targets.join(',')}`,
    `mode=${result.mode}`,
    `notes_source=${changes.trim() ? 'input' : notesFile}`,
  ];
  for (const t of Object.keys(TARGETS)) lines.push(`${t.replaceAll('-', '_')}=${result.targets.includes(t)}`);
  console.log(`Releasing ${version} (${result.mode}) for: ${result.targets.join(', ')}${result.targets.length === Object.keys(TARGETS).length ? '' : ' (test build of some platforms)'}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
  else console.log(lines.join('\n'));
}
