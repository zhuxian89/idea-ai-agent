#!/usr/bin/env node
// wait-online-version.mjs <expected-version> [--url <url>] [--streak 8] [--max-attempts 60]
//
// AGENTS.md: raw.githubusercontent.com caches version.txt for ~10 minutes after a push and can oscillate
// between the old and new value. Polls the exact un-parameterized URL the online installer reads until
// `streak` consecutive responses equal `expected-version`.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitOnlineVersion({
  expected,
  url,
  streak = 8,
  maxAttempts = 60,
  hitDelayMs = 4000,
  missDelayMs = 15000,
}) {
  let consecutive = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(url, { headers: { 'User-Agent': 'idea-ai-agent-version-waiter/1.0' } });
    const value = response.ok ? (await response.text()).trim() : `HTTP_${response.status}`;
    if (value === expected) {
      consecutive += 1;
      console.log(`[poll ${attempt}/${maxAttempts}] version.txt=${value} (streak ${consecutive}/${streak})`);
      if (consecutive >= streak) return;
      await sleep(hitDelayMs);
    } else {
      consecutive = 0;
      console.log(`[poll ${attempt}/${maxAttempts}] version.txt=${value}, waiting for ${expected}...`);
      await sleep(missDelayMs);
    }
  }
  throw new Error(`Timed out waiting for ${url} to return ${expected} ${streak} times in a row`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const expected = args.find((a) => !a.startsWith('--')) || '';
  const option = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : '';
  };
  const repo = process.env.GITHUB_REPOSITORY || 'zhuxian89/idea-ai-agent';
  const url = option('--url') || `https://raw.githubusercontent.com/${repo}/main/scripts/standalone/version.txt`;
  const streak = Number(option('--streak') || 8);
  const maxAttempts = Number(option('--max-attempts') || 60);
  if (!expected) {
    console.error('usage: wait-online-version.mjs <expected-version> [--url <url>] [--streak 8] [--max-attempts 60]');
    process.exit(2);
  }
  waitOnlineVersion({ expected, url, streak, maxAttempts }).catch((error) => {
    console.error(`FAILED: ${error.message}`);
    process.exit(1);
  });
}
