#!/usr/bin/env node
// plugin-plan.mjs   (reads VERSION, MODE, REPLACE_EXISTING, CHANGES, REF_NAME and optionally GITHUB_OUTPUT)
//
// First step of .github/workflows/release-plugin.yml: validates inputs before spending runner minutes on
// Gradle/Go/web builds, checks whether v<version> already exists, and emits workflow outputs.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const MODES = new Set(['draft', 'formal']);

export function planPlugin({
  version,
  mode = 'draft',
  replaceExisting = false,
  changes = '',
  refName = '',
  notesFileExists = false,
  releaseExists = false,
  tagExists = false,
}) {
  const problems = [];
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$/.test(version || '')) {
    problems.push(`"${version}" is not a valid plugin version like 0.1.27 or 0.1.28`);
  }
  const normalizedMode = (mode || 'draft').trim();
  if (!MODES.has(normalizedMode)) {
    problems.push(`unknown mode "${mode}": choose draft or formal`);
  }
  if (!refName) {
    problems.push('missing REF_NAME: run this workflow from main or branch plugin-<version>');
  } else if (refName !== 'main' && version && refName !== `plugin-${version}`) {
    problems.push(`branch "${refName}" does not match version "${version}": run from branch plugin-${version} or main`);
  }
  if (!(changes || '').trim() && !notesFileExists) {
    problems.push('no release notes: fill in the "changes" input or commit .github/release-notes/plugin-<version>.md');
  }
  if (normalizedMode === 'formal' && (releaseExists || tagExists) && !replaceExisting) {
    problems.push(
      `plugin release/tag v${version} already exists; set replace_existing=true for a same-version asset update, or bump version`,
    );
  }
  // Never turn an already-live public Latest release into a draft; use a dedicated draft tag instead.
  const draftTag = releaseExists || tagExists ? `plugin-draft-v${version}` : `v${version}`;
  return { problems, mode: normalizedMode, draftTag };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const {
    VERSION: version = '',
    MODE: mode = 'draft',
    REPLACE_EXISTING: replaceRaw = 'false',
    CHANGES: changes = '',
    REF_NAME: refName = '',
  } = process.env;
  const replaceExisting = replaceRaw === 'true';
  const notesFile = `.github/release-notes/plugin-${version}.md`;
  const standaloneVersion = readFileSync(path.join(repoRoot, 'scripts/standalone/version.txt'), 'utf8').trim();

  let releaseExists = false;
  let tagExists = false;
  if (version) {
    releaseExists = spawnSync('gh', ['release', 'view', `v${version}`], { stdio: 'ignore' }).status === 0;
    tagExists =
      spawnSync('git', ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/v${version}`], { stdio: 'ignore' })
        .status === 0;
  }

  const result = planPlugin({
    version,
    mode,
    replaceExisting,
    changes,
    refName,
    notesFileExists: existsSync(path.join(repoRoot, notesFile)),
    releaseExists,
    tagExists,
  });
  if (result.problems.length) {
    for (const p of result.problems) console.error(`::error::${p}`);
    process.exit(1);
  }

  const lines = [
    `mode=${result.mode}`,
    `notes_source=${changes.trim() ? 'input' : notesFile}`,
    `release_exists=${releaseExists}`,
    `tag_exists=${tagExists}`,
    `draft_tag=${result.draftTag}`,
    `standalone_version=${standaloneVersion}`,
  ];
  console.log(`Releasing IDEA plugin ${version} (${result.mode}, replace_existing=${replaceExisting}, standalone=${standaloneVersion})`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
  else console.log(lines.join('\n'));
}
