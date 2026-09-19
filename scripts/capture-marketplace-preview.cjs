// Loaded by playwright-cli run-code --filename. The CLI provides `page`.
async (page) => {
  const lang = await page.evaluate(() => new URL(location.href).searchParams.get('lang'));
  const zh = lang === 'zh';
  const base = `output/playwright/marketplace/${lang}`;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const capture = async (name) => {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${base}/${name}.png`, scale: 'css', animations: 'disabled' });
  };
  const scene = async n => {
    await page.evaluate(n => window.marketScene(n), n);
    await page.locator(`#artboard[data-scene="${n}"]`).waitFor();
  };
  const toggle = () => page.getByRole('button', {name: /Changed 2 files this turn|本轮修改了 2 个文件/});
  await toggle().click();
  await page.locator('[data-turn-diff-file="EmailValidator.java"]').waitFor();
  await page.mouse.move(20, 20);
  await capture('hero');
  await scene(1);
  await page.getByRole('button', {name: zh ? '语音输入' : 'Voice input', exact:true}).click();
  await page.getByRole('dialog').waitFor();
  for (let i = 0; i < 12; i++) {
    await page.evaluate(i => window.marketVoice(i + 1), i);
    await capture(`voice-${String(i).padStart(2,'0')}`);
  }
  await page.getByRole('button', {name: zh ? '语音输入' : 'Voice input', exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  if (!(await page.getByRole('textbox').innerText()).trim()) throw new Error('Voice text missing from draft');
  await capture('draft');
  await scene(2);
  await page.locator('input[type="file"]').setInputFiles('docs/marketplace/demo/acceptance.md');
  await page.getByText('acceptance.md', {exact:true}).waitFor();
  await capture('attachment');
  await scene(3);
  await page.getByText(zh ? '已更新邮箱校验逻辑，并补充回归测试。' : 'Updated email validation and added a regression test.', {exact:true}).waitFor();
  await capture('reply');
  await scene(4);
  await toggle().waitFor();
  if (await toggle().getAttribute('aria-expanded') !== 'false') throw new Error('Turn summary should default to collapsed');
  await capture('snapshot-closed');
  await toggle().click();
  await page.locator('[data-turn-diff-file="EmailValidator.java"]').waitFor();
  await capture('snapshot-files');
  await page.locator('[data-turn-diff-file="EmailValidator.java"]').click();
  await page.locator('[data-turn-diff-detail]').waitFor();
  await page.getByRole('button', {name:zh ? '双栏 diff 视图' : 'Side-by-side diff', exact:true}).click();
  await page.locator('[data-turn-diff-detail]').scrollIntoViewIfNeeded();
  await capture('snapshot-detail');
  // Real bridge action, intercepted by this media-only fixture.
  await page.getByRole('button', {name:zh ? '在 IDEA 中对比' : 'Compare in IDEA', exact:true}).first().click();
  await page.locator('#artboard[data-scene="5"]').waitFor();
  if (!(await page.evaluate(() => window.marketCompare?.snapshotId === 'demo-fixed-turn'))) throw new Error('Missing fixed-snapshot bridge payload');
  await page.locator('[data-turn-diff-file="EmailValidator.java"]').click();
  await page.mouse.move(20,20);
  await capture('compare');
  const broken = await page.locator('img').evaluateAll(nodes => nodes.filter(n => !n.complete || !n.naturalWidth).map(n=>n.alt));
  if (broken.length || errors.length) throw new Error(JSON.stringify({broken,errors}));
  return {language:lang,frames:20,voiceDraft:true,attachment:true,collapsedDefault:true,snapshotBridge:true,errors};
}
