import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { mount } from "./helpers/mount-app-fixture.mjs";

const source = `import { WorkspaceFixture as Fixture } from './tests/fixtures/workspace-sidebars';`;
const response = request => {
  const url = new URL(request.url());
  if (url.pathname.endsWith('/log-path')) return { path: `/projects/${url.searchParams.get('root')}/.mindfs/sessions/${url.pathname.split('/').at(-2)}.jsonl`, agent_session_id: 'native-thread' };
  if (url.pathname.includes('/api/agents')) return { agents: [{name:'codex',available:true,installed:true,models:[{id:'test-model',name:'Test model'}],default_model_id:'test-model'}], shells: [] };
  if (url.pathname.includes('scheduled')) return { tasks: [] };
  return {};
};
async function setup(t, handle = response) {
  const page = await mount(t, source, handle, 1440, "/", '<meta name="local-ai-agent-mode" content="standalone">');
  page.setDefaultTimeout(5000);
  await page.addStyleTag({content: ['index.css', 'components/workspaceSidebar.css'].map(file => readFileSync(new URL(`../src/${file}`, import.meta.url),'utf8').replace(/^@(?:import|source)\s[^\n]*$/gm,'')).join('\n')});
  await page.route('**/assets/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ contentType: path.endsWith('.svg') ? 'image/svg+xml' : 'image/webp', body: readFileSync(new URL(`../public${path}`, import.meta.url)) });
  });
  await page.locator('img[src*="/assets/"]').evaluateAll(images=>images.forEach(img=>{img.src += '?fixture';}));
  await page.evaluate(() => { document.body.removeAttribute('style'); document.documentElement.dataset.theme = 'light'; document.execCommand = command => { if (command === 'copy') { window.copiedText = document.activeElement.value; return true; } return false; }; });
  await expect(page.locator('[data-session-key="main"]').first()).toBeVisible();
  await expect(page.getByRole('button',{name:'Add project',exact:true})).toBeVisible();
  return page;
}
const row = (page, key, root = 'a') => page.locator(`[data-session-key="${key}"][data-root-id="${root}"]`);
async function menu(page, key = 'main', root = 'a') { await row(page,key,root).getByRole('button', {name:'Session menu',exact:true}).click(); return page.getByRole('menu', {name:'Session menu'}); }

test('subagents: running defaults, ended disclosure, selected descendants, transitions and paging in both lists', async t => {
  const page = await setup(t);
  for (const single of [false,true]) {
    await page.evaluate(single => { window.fixture.setSingle(single); window.fixture.setSelected({key:'main',root_id:'a'}); }, single);
    await expect(row(page,'run-4')).toBeVisible();
    await expect(row(page,'done')).toHaveCount(0);
    const running = page.getByRole('button',{name:'Running · 4',exact:true});
    await running.click();
    await expect(running).toHaveAttribute('aria-expanded','false');
    await expect(row(page,'run-4')).toHaveCount(0);
    await running.click();
    await page.getByRole('button',{name:'Ended · 1',exact:true}).first().click();
    await expect(row(page,'done')).toBeVisible();
    await page.getByRole('button',{name:'Load more child sessions',exact:true}).click();
    await expect(row(page,'older')).toBeVisible();
    await page.getByRole('button',{name:'Ended · 2',exact:true}).first().click();
    await expect(row(page,'done')).toHaveCount(0);
    await page.evaluate(() => window.fixture.setSelected({key:'deep',root_id:'a'}));
    await expect(row(page,'deep')).toBeVisible();
    await expect(row(page,'done')).toBeVisible();
    if (!single) await page.evaluate(() => window.fixture.setGroups([{rootId:'a',rootName:'idea-ai-agent',totalCount:1,sessions:[{key:'main',session_key:'main',updated_at:'2026-11-12T10:00:00Z',root_id:'a',name:'Main'}, ...[1,2,3,4].map(i=>({key:`run-${i}`,session_key:`run-${i}`,updated_at:'2026-11-12T10:00:00Z',root_id:'a',name:`Running ${i}`,parent_session_key:'main',pending:true})),{key:'done',session_key:'done',updated_at:'2026-11-12T10:00:00Z',root_id:'a',name:'Done',parent_session_key:'main'},{key:'deep',session_key:'deep',updated_at:'2026-11-12T10:00:00Z',root_id:'a',name:'Deep',parent_session_key:'done'}]}]));
  }
  await page.evaluate(() => { window.fixture.setSelected({key:'main',root_id:'a'}); window.fixture.finish(); });
  await expect(page.getByRole('button',{name:'Running · 3',exact:true})).toBeVisible();
  await expect(row(page,'run-1')).toHaveCount(0);
  await page.evaluate(() => window.fixture.setSearch(true));
  await expect(row(page,'run-1')).toBeVisible();
  assert.ok((await page.evaluate(() => window.actions)).some(action=>action.action==='older-children'));
});

test('project groups and menu actions keep root identity and menus fit the viewport', async t => {
  const page = await setup(t);
  const groupToggle=page.getByRole('button',{name:'Collapse mindfs',exact:true});
  await groupToggle.click();
  await expect(row(page,'main','b')).toBeHidden();
  await page.getByRole('button',{name:'Expand mindfs',exact:true}).click();
  await expect(row(page,'main','b')).toBeVisible();
  let popup=await menu(page,'main','b');
  await popup.getByRole('menuitem',{name:'Copy session ID',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.copiedText),'main');
  await popup.getByRole('menuitem',{name:'Copy session path',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.copiedText)).toBe('/projects/b/.mindfs/sessions/main.jsonl');
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  popup=await menu(page,'main','b');
  await popup.getByRole('menuitem',{name:'Rename',exact:true}).click();
  await row(page,'main','b').getByRole('textbox').fill('Renamed B');
  await row(page,'main','b').getByRole('textbox').press('Enter');
  await expect(row(page,'main','b')).toContainText('Renamed B');
  popup=await menu(page,'main','b');
  await popup.getByRole('menuitem',{name:'Pin',exact:true}).click();
  assert.deepEqual((await page.evaluate(()=>window.actions)).at(-1),{action:'pin',root:'b',key:'main'});
  await page.setViewportSize({width:1440,height:400});
  popup=await menu(page,'other');
  const rect=await popup.boundingBox();
  assert.ok(rect.y>=0 && rect.y+rect.height<=400);
  await page.evaluate(() => { document.execCommand = () => false; Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(new Error('Clipboard denied'))},configurable:true}); });
  await popup.getByRole('menuitem',{name:'Copy session ID',exact:true}).click();
  await expect(popup.getByRole('alert')).toHaveText('Clipboard denied');
});

test('handoff loads correct session, preserves draft, saves a template and exposes path failures', async t => {
  const page = await setup(t);
  const editor=page.locator('[contenteditable="true"]');
  await editor.fill('已有草稿');
  let popup=await menu(page,'main','b');
  await popup.getByRole('menuitem',{name:'Handoff pack',exact:true}).click();
  let dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('textbox')).toContainText('/projects/b/.mindfs/sessions/main.jsonl');
  await dialog.getByRole('button',{name:'Edit default template',exact:true}).click();
  await dialog.getByRole('textbox').fill('接手 {session_key}\n路径 {jsonl_path}\n线程 {agent_session_id}');
  await dialog.getByRole('button',{name:'Save',exact:true}).click();
  await dialog.getByRole('button',{name:'Copy pack',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Copied',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Fill into input',exact:true}).click();
  await expect(editor).toContainText('已有草稿');
  await expect(editor).toContainText('接手 main');
  await expect(editor).toContainText('/projects/b/.mindfs/sessions/main.jsonl');
  await editor.press('End'); await editor.pressSequentially(' more');
  await expect(editor).toContainText('more');
  assert.equal((await editor.innerText()).match(/接手 main/g).length,1);
  await page.route('**/api/sessions/main/log-path?root=a', route => route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Session missing'})}));
  popup=await menu(page);
  await popup.getByRole('menuitem',{name:'Handoff pack',exact:true}).click();
  dialog=page.getByRole('dialog');
  await expect(dialog).toContainText('Session missing');
  await expect(dialog.getByRole('button',{name:'Fill into input',exact:true})).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('handoff ignores a late response from the previous session', async t => {
  const page = await setup(t);
  let release;
  await page.route('**/api/sessions/slow/log-path?root=a', async route => { await new Promise(resolve=>{release=resolve;}); await route.fulfill({contentType:'application/json',body:JSON.stringify({path:'/wrong/slow.jsonl'})}); });
  await page.evaluate(()=>window.fixture.setHandoff({key:'slow',session_key:'slow',updated_at:'2026-11-12T10:00:00Z',root_id:'a',name:'Slow'}));
  await expect.poll(()=>typeof release).toBe('function');
  await page.evaluate(()=>window.fixture.setHandoff({key:'main',session_key:'main',root_id:'b',name:'Current B'}));
  await expect(page.getByRole('dialog').getByRole('textbox')).toContainText('/projects/b/');
  release();
  await expect(page.getByRole('dialog').getByRole('textbox')).not.toContainText('/wrong/');
});

test('current-session schedule sends the binding and general manager keeps ordinary schedules', async t => {
  const writes=[];
  const page=await setup(t, request=> {if(request.method()==='POST' && request.url().includes('scheduled')){writes.push(request.postDataJSON());return {task:{id:'created',...writes.at(-1)}};}return response(request);});
  const popup=await menu(page,'main','b');
  await popup.getByRole('menuitem',{name:'Scheduled tasks',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toContainText('Fixed session');
  await dialog.locator('textarea').fill('check progress');
  await dialog.getByRole('button',{name:'Save',exact:true}).click();
  await expect.poll(()=>writes.length).toBe(1);
  assert.equal(writes[0].root_id,'b');assert.equal(writes[0].fixed_session_key,'main');assert.equal(writes[0].new_session_cron,'');
  await expect(dialog).toHaveCount(0);
  await page.evaluate(()=>window.fixture.generalSchedule());
  await expect(page.getByRole('dialog')).not.toContainText('Fixed session');
  await page.getByRole('dialog').getByRole('button',{name:'New',exact:true}).click();
  await page.getByRole('dialog').getByLabel('Task name',{exact:true}).fill('Ordinary task');
  await page.getByRole('dialog').locator('textarea').fill('Check on schedule');
  await page.getByRole('dialog').getByRole('button',{name:'Save',exact:true}).click();
  await expect.poll(()=>writes.length).toBe(2);
  assert.equal(writes[1].root_id,'a'); assert.equal(writes[1].fixed_session_key,undefined);
});

test('production sidebars use consistent typography in light/dark and mobile layouts', async t => {
  const page=await setup(t);
  mkdirSync(new URL('../../../output/playwright/remote-workspace-implemented/',import.meta.url),{recursive:true});
  for(const theme of ['light','dark']){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await expect(row(page,'main').locator('button').first()).toBeVisible();
    await expect(page.locator('.workspace-projects').getByRole('button',{name:'mindfs',exact:true})).toHaveCSS('color',theme === 'dark' ? 'rgb(248, 250, 252)' : 'rgb(15, 23, 42)');
    for (const name of await page.locator('.workspace-projects li > button, .workspace-project-name').all()) {
      await expect(name).toHaveCSS('font-size','14px');
      await expect(name).toHaveCSS('font-weight','600');
    }
    const sizes=await row(page,'main').evaluate(el=>({font:getComputedStyle(el.querySelector('button > span')).fontSize,bg:getComputedStyle(el).backgroundColor}));
    assert.equal(sizes.font,'13px');assert.notEqual(sizes.bg,'rgba(0, 0, 0, 0)');
    assert.equal(await row(page,'run-1').locator('button > span').first().evaluate(el=>getComputedStyle(el).fontSize),'12px');
    const projectName = await page.locator('.workspace-project-name').first().boundingBox();
    const mainName = await row(page,'main').locator('button > span').first().boundingBox();
    const childName = await row(page,'run-1').locator('button > span').first().boundingBox();
    assert.ok(mainName.x > projectName.x, 'Main sessions are indented under their project');
    assert.ok(childName.x > mainName.x, 'Subagents are indented under their parent session');
    await expect(row(page,'main').locator('button > span').first()).toHaveCSS('color',theme === 'dark' ? 'rgb(96, 165, 250)' : 'rgb(29, 78, 216)');
    const contrast=await page.evaluate(()=>{
      const parse=value=>value.match(/[\d.]+/g).map(Number);
      const luminosity=color=>color.slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((total,x,i)=>total+x*[.2126,.7152,.0722][i],0);
      const selectors=['.workspace-session-row[data-selected="true"] button > span','.workspace-child-session button > span','.workspace-child-session .idea-session-agent','.workspace-project-name','.workspace-project-count','.workspace-child-group','.workspace-projects li > button','.workspace-project-tabs button[aria-selected="true"]'];
      return selectors.map(selector=>{
        const el=document.querySelector(selector);
        const parents=[];for(let node=el;node;node=node.parentElement)parents.unshift(node);
        let background=[255,255,255];
        for(const node of parents){const color=parse(getComputedStyle(node).backgroundColor);const alpha=color[3]??1;background=background.map((v,i)=>color[i]*alpha+v*(1-alpha));}
        const [low,high]=[luminosity(parse(getComputedStyle(el).color)),luminosity(background)].sort((a,b)=>a-b);
        return {selector,ratio:(high+.05)/(low+.05)};
      });
    });
    for(const item of contrast)assert.ok(item.ratio>=4.5,`${theme} ${item.selector}: ${item.ratio}`);
    await page.screenshot({path:new URL(`../../../output/playwright/remote-workspace-implemented/project-names-${theme}.png`,import.meta.url).pathname});
  }
  await page.evaluate(()=>{window.fixture.setLeft(false);window.fixture.setRight(true);});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:new URL('../../../output/playwright/remote-workspace-implemented/mobile.png',import.meta.url).pathname});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const popup=await menu(page);
  await popup.getByRole('menuitem',{name:'Scheduled tasks',exact:true}).click();
  await page.getByRole('dialog').locator('textarea').fill('Mobile schedule');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('actual standalone App closes desktop drawers on mobile resize and opens only one sidebar', async t => {
  const page=await mount(t, `
    import { App } from './src/App';
    import { sessionService } from './src/services/session';
    sessionService.connect = () => {};
    window.bootstrap=bootstrapService;
    function Fixture(){return <App />;}
  `, request=>{
    const path=new URL(request.url()).pathname;
    if(path.endsWith('/api/dirs')) return [{id:'root',root_path:'/workspace/project',is_git_repo:false}];
    if(path.endsWith('/api/relay/status')) return {e2ee_required:false};
    if(path.endsWith('/api/tree')) return {entries:[{name:'README.md',path:'README.md',is_dir:false}]};
    return {agents:[],shells:[],items:[],entries:[],plugins:[]};
  },1440,'/n/node/','<meta name="local-ai-agent-mode" content="standalone">');
  page.setDefaultTimeout(5000);
  await page.addStyleTag({content: readFileSync(new URL('../src/index.css',import.meta.url),'utf8').replace(/^@(?:import|source)\s[^\n]*$/gm,'')});
  await expect.poll(()=>page.evaluate(()=>window.bootstrap.snapshot().phase)).toBe('ready');
  await expect(page.locator('[data-onboarding="shell"] > aside')).toHaveCount(2);
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('[data-onboarding="shell"] > aside')).toHaveCount(0);
  await page.getByRole('button',{name:'Open file sidebar',exact:true}).click();
  await expect(page.locator('[data-onboarding="shell"] > aside')).toHaveCount(1);
  await expect(page.locator('aside .workspace-projects')).toBeVisible();
  // The drawer overlay covers the composer; dispatch the same button event to test the state transition directly.
  await page.getByRole('button',{name:'Open session sidebar',exact:true}).dispatchEvent('click');
  await expect(page.locator('[data-onboarding="shell"] > aside')).toHaveCount(1);
  await expect(page.locator('aside .workspace-sessions')).toBeVisible();
  await expect(page.locator('aside .workspace-projects')).toHaveCount(0);
  await page.getByRole('button',{name:'Open file sidebar',exact:true}).dispatchEvent('click');
  await expect(page.locator('[data-onboarding="shell"] > aside')).toHaveCount(1);
  await expect(page.locator('aside .workspace-projects')).toBeVisible();
});

test('project paging retains selected nested sessions and active descendants', async t => {
  const page=await setup(t);
  await page.evaluate(()=>{
    const make=(key,parent)=>({key,session_key:key,root_id:'a',name:key,parent_session_key:parent,updated_at:'2026-11-12T10:00:00Z'});
    window.fixture.setGroups([{rootId:'a',rootName:'Project A',totalCount:8,sessions:[...Array.from({length:8},(_,i)=>make(`parent-${i}`)),make('child','parent-6'),{...make('grandchild','child'),pending:true}]}]);
    window.fixture.setSelected({key:'grandchild',root_id:'a'});
  });
  await expect(row(page,'parent-6')).toBeVisible();
  await expect(row(page,'grandchild')).toBeVisible();
  await expect(row(page,'parent-7')).toHaveCount(0);
  await page.getByRole('button',{name:/2 sessions left/}).click();
  await expect(row(page,'parent-7')).toBeVisible();
  await page.evaluate(()=>window.fixture.setSelected({key:'parent-0',root_id:'a'}));
  await expect(row(page,'grandchild')).toBeVisible();
  await page.getByRole('button',{name:'Running · 1',exact:true}).click();
  await expect(row(page,'grandchild')).toHaveCount(0);
});
