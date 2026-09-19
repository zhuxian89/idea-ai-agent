import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const webDir = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');

test('agent test: discovery, custom prompt, streaming, failure, stop and keyboard close', async t => {
  const bundle = await build({
    stdin: { resolveDir: webDir, loader: 'tsx', contents: `
      import React from 'react'; import { createRoot } from 'react-dom/client';
      import { I18nProvider } from './src/i18n';
      import { IdeaAgentSettings } from './src/components/IdeaAgentSettings';
      import { bootstrapService } from './src/services/bootstrap';
      bootstrapService.canUseProtectedAPI = () => true;
      window.ideaAgent = { locale: 'zh-CN' };
      createRoot(document.getElementById('root')).render(<I18nProvider><div className="idea-workbench"><IdeaAgentSettings
        agents={[{name:'claude', installed:true, available:false, version:'test'}]}
        busy={false} projectReady={true} notice="" probingAgent="" error="" onProbe={()=>{}} onRun={()=>{}}
      /></div></I18nProvider>);
    ` }, bundle: true, write: false, outdir: '/tmp/agent-test-fixture', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.VITE_NATIVE_PLATFORM': '""' },
  });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 375, height: 760 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('http://agent.test/**', route => route.fulfill({ contentType: 'text/html', body: '<html data-theme="light"><div id="root"></div></html>' }));
  await page.route('**/assets/agents/*.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: readFileSync(path.join(webDir, 'public', new URL(route.request().url()).pathname)) }));
  await page.goto('http://agent.test');
  const styles = ['src/index.css', 'src/ide.css'].map(file => readFileSync(path.join(webDir, file), 'utf8').replace(/^@(?:import|source)\s[^\n]*$/gm, '')).join('\n');
  await page.addStyleTag({ content: styles });
  for (const file of bundle.outputFiles.filter(file => file.path.endsWith('.css'))) await page.addStyleTag({ content: file.text });
  await page.evaluate(() => {
    window.sent = []; window.modelLoads = 0; window.mode = 'success';
    const original = window.fetch;
    window.fetch = async (input, options = {}) => {
      if (String(input).includes('/test-models')) {
        window.modelLoads++;
        return Response.json({ current_model_id: 'configured', models: [{id:'configured',name:'当前模型'},{id:'second',name:'第二模型'}] });
      }
      if (String(input).includes('/test-connection')) {
        window.sent.push(JSON.parse(options.body));
        return new Response(new ReadableStream({ start(controller) {
          const encoder = new TextEncoder();
          const send = event => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
          send({type:'starting'}); send({type:'chunk',text:'你好'});
          const timer = setTimeout(() => {
            send(window.mode === 'failure' ? {type:'error',text:'Authentication failed'} : {type:'done',elapsed_ms:1350}); controller.close();
          }, window.mode === 'slow' ? 10000 : 400);
          options.signal.addEventListener('abort', () => { clearTimeout(timer); controller.error(new DOMException('Aborted','AbortError')); });
        }}), { headers: {'Content-Type':'application/x-ndjson'} });
      }
      return original(input, options);
    };
  });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('测试消息')).toHaveValue('Hi');
  await expect(dialog.getByLabel('测试模型')).toHaveValue('configured');
  assert.equal(await page.evaluate(() => window.sent.length), 0, 'opening only discovers models');
  await dialog.getByLabel('测试模型').selectOption('second');
  await dialog.getByLabel('测试消息').fill('自定义问候');
  await dialog.getByRole('button', { name: '开始测试', exact: true }).click();
  await expect(dialog.getByLabel('响应', { exact: true })).toContainText('你好');
  await expect(dialog.getByText('测试成功', { exact: false })).toBeVisible();
  assert.deepEqual(await page.evaluate(() => window.sent[0]), { agent:'claude', model:'second', message:'自定义问候' });
  await page.evaluate(() => { window.mode = 'failure'; });
  await dialog.getByRole('button', { name:'重新测试', exact:true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Authentication failed');
  await page.evaluate(() => { window.mode = 'slow'; });
  await dialog.getByRole('button', { name:'重新测试', exact:true }).click();
  await dialog.getByRole('button', { name:'停止测试', exact:true }).click();
  await expect(dialog.getByText('已停止', { exact:true })).toBeVisible();
  const report = path.resolve(webDir, '../../build/reports/agent-connection-test'); mkdirSync(report, {recursive:true});
  for (const theme of ['light','dark']) {
    await page.locator('html').evaluate((el, value) => el.dataset.theme = value, theme);
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.screenshot({ path: path.join(report, `${theme}-375.png`) });
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name:'测试连接', exact:true })).toBeFocused();
  assert.deepEqual(errors, []);
});
