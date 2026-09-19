import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

// Start Vite on 5188 first. Only the media fixture is opened; no real agent runs.
const cli = resolve(homedir(), '.codex/skills/playwright/scripts/playwright_cli.sh');
const run = (...args) => execFileSync(cli, ['-s=marketplace', ...args], {stdio:'inherit'});
const out = resolve('docs/marketplace/preview');
mkdirSync(out, {recursive:true});
for (const lang of ['en','zh']) {
  const frames = resolve(`output/playwright/marketplace/${lang}`);
  mkdirSync(frames, {recursive:true});
  run('goto', `http://127.0.0.1:5188/tests/fixtures/marketplace-preview.html?ide_chrome=1&lang=${lang}`);
  run('resize','1280','800');
  run('snapshot');
  run('run-code','--filename=scripts/capture-marketplace-preview.cjs');
  copyFileSync(`${frames}/hero.png`, `${out}/hero-${lang}.png`);
  const timeline = [
    ['hero',2], ...Array.from({length:12},(_,i)=>[`voice-${String(i).padStart(2,'0')}`,0.25]),
    ['draft',2],['attachment',3.5],['reply',3],['snapshot-closed',1.5],['snapshot-files',2],['snapshot-detail',3],['compare',4],
  ];
  const recipe = timeline.map(([name,duration]) => `file '${frames}/${name}.png'\nduration ${duration}`).join('\n') + `\nfile '${frames}/compare.png'\n`;
  const concat = `${frames}/timeline.ffconcat`;
  writeFileSync(concat,recipe);
  execFileSync('ffmpeg',['-v','error','-y','-f','concat','-safe','0','-i',concat,'-t','24','-vf','fps=12,format=yuv420p','-c:v','libx264','-crf','20','-movflags','+faststart',`${out}/workflow-${lang}.mp4`],{stdio:'inherit'});
  execFileSync('ffmpeg',['-v','error','-y','-i',`${out}/workflow-${lang}.mp4`,'-filter_complex','fps=8,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4','-loop','0',`${out}/workflow-${lang}.gif`],{stdio:'inherit'});
}
console.log(`Preview assets: ${out}`);
