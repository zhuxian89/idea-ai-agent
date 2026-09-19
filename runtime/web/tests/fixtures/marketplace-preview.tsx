// Media-only fixture. Real production components; synthetic conversation/voice.
// This entry is not imported by the app and never calls a model or microphone.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../../src/i18n';
import { IdeaWorkbench } from '../../src/layout/IdeaWorkbench';
import { ActionBar } from '../../src/components/ActionBar';
import { SessionViewer } from '../../src/components/SessionViewer';
import { SessionTabs } from '../../src/components/SessionTabs';
import { bootstrapService } from '../../src/services/bootstrap';
import './marketplace-preview.css';
import pluginIcon from '../../../../src/main/resources/META-INF/pluginIcon.svg?raw';
import codexIcon from '../../public/assets/agents/codex.svg?raw';
import claudeIcon from '../../public/assets/agents/claude.svg?raw';

const w = window as any;
const zh = new URLSearchParams(location.search).get('lang') === 'zh';
localStorage.setItem('mindfs-locale', zh ? 'zh-CN' : 'en-US');
document.documentElement.lang = zh ? 'zh-CN' : 'en';
const prompt = zh ? '让邮箱校验忽略首尾空格，并补充回归测试。' : 'Trim whitespace before validating email, and add a regression test.';
const patch = 'diff --git a/EmailValidator.java b/EmailValidator.java\n--- a/EmailValidator.java\n+++ b/EmailValidator.java\n@@ -1,5 +1,5 @@\n public final class EmailValidator {\n     public boolean isValid(String email) {\n-        return EMAIL.matcher(email).matches();\n+        return EMAIL.matcher(email.trim()).matches();\n     }\n }\n' +
  'diff --git a/EmailValidatorTest.java b/EmailValidatorTest.java\n--- a/EmailValidatorTest.java\n+++ b/EmailValidatorTest.java\n@@ -1,2 +1,6 @@\n class EmailValidatorTest {\n+    @Test\n+    void acceptsSurroundingWhitespace() {\n+        assertTrue(isValid(" hello@example.com "));\n+    }\n }\n';
const update = { diff: patch, snapshotId: 'demo-fixed-turn', comparePaths: ['EmailValidator.java', 'EmailValidatorTest.java'] };
const sessionBase = { key: 'marketplace-demo', session_key: 'marketplace-demo', root_id: 'demo', name: zh ? '邮箱校验' : 'Email validation', agent: 'codex', type: 'chat' as const, pending: false };
const descriptions = zh ? [
  ['原生 Agent，\n就在 IDEA。', '用熟悉的 Agent 工作，用熟悉的 IDEA 审查。'],
  ['说出需求，\n发送由你。', '语音识别进入草稿。可以修改，确认后再发送。'],
  ['附上文件，\n讲清上下文。', '附件和项目代码随手加入，不必在窗口之间来回搬运。'],
  ['你的 Agent，\n原生的工作方式。', '沿用本机 CLI 的登录、模型、项目指令与 MCP。'],
  ['一轮修改，\n一份固定快照。', '按回合查看修改；后续编辑不改变已保存的对比。'],
  ['审查修改，\n仍用 IDEA Diff。', '点击文件旁的对比按钮，进入 IDEA 原生左右对比。'],
] : [
  ['Native agents.\nRight inside IDEA.', 'Work with your agent. Review with your IDE.'],
  ['Say it.\nKeep control.', 'Voice becomes an editable draft.\nYou decide when to send.'],
  ['Add files.\nGive context.', 'Attach a file or bring in project code.\nKeep the conversation in your IDE.'],
  ['Your agent.\nIts native workflow.', 'Use your CLI login, models, project\ninstructions and MCP configuration.'],
  ['Every turn.\nA fixed snapshot.', 'Review that turn’s changes. Later edits\ndo not rewrite the saved comparison.'],
  ['Review it.\nIn IDEA’s own Diff.', 'Use the compare action beside a file\nto open IDEA’s native side-by-side diff.'],
];
const steps = zh ? ['语音输入', '附件上下文', '原生 Agent', '固定快照', 'IDEA Diff'] : ['Voice input', 'Attachments', 'Native agent', 'Turn snapshots', 'IDEA Diff'];
const agents = [{ name: 'codex', installed: true, available: true, models: [], modes: [{ id: 'on-request', name: 'On request' }] }, { name: 'claude', installed: true, available: true, models: [] }];
bootstrapService.canUseProtectedAPI = () => true;
window.fetch = async (input) => {
  const url = String(input);
  if (url.includes('/assets/agents/')) return new Response(url.includes('codex') ? codexIcon : claudeIcon, {headers:{'Content-Type':'image/svg+xml'}});
  if (url.includes('/api/agents')) return Response.json({ agents, shells: [] });
  // Closed fixture: never forward API requests to a user's runtime/provider.
  return Response.json({});
};
let voiceId = '';
w.ideaAgent = { locale: zh ? 'zh-CN' : 'en-US', theme: 'dark', voiceProvider: 'custom', postMessage: (payload: any) => {
  if (payload.action === 'voiceStart') {
    voiceId = payload.id;
    w.marketVoice(1);
  }
  if (payload.action === 'voiceStop') w.ideaAgentVoiceEvent?.({ id: voiceId, state: 'done', text: prompt });
  if (payload.action === 'compareTurnDiff') { w.marketCompare = payload; w.marketScene(5); }
  if (payload.action === 'requestFileContext') w.ideaAgentReceiveContext?.('@EmailValidator.java');
} };
w.marketVoice = (frame: number) => {
  for (let i = 0; i < 21; i++) w.ideaAgentVoiceEvent?.({id: voiceId, state:'recording', provider:'custom', elapsedMs:frame * 250, level:0.2 + Math.abs(Math.sin(i * 1.7 + frame)) * 0.7});
};

function Preview() {
  const [scene, setScene] = useState(0);
  w.marketScene = setScene;
  const [draft, setDraft] = useState<{ id: number; content: string } | null>(null);
  w.marketDraft = (text = prompt) => setDraft({ id: Date.now(), content: text });
  const hasReply = scene === 0 || scene >= 3;
  const session = { ...sessionBase, exchanges: hasReply ? [
    { seq:1, role:'user', content:prompt },
    { seq:2, role:'agent', agent:'codex', content: zh ? '已更新邮箱校验逻辑，并补充回归测试。\n\n- 校验前去除首尾空格。\n- 覆盖带空格的邮箱输入。\n\n修改集中在 `EmailValidator.java` 和对应测试文件。' : 'Updated email validation and added a regression test.\n\n- Trim surrounding whitespace before validation.\n- Cover email input with leading and trailing spaces.\n\nChanges are limited to `EmailValidator.java` and its test.' },
  ] : [], exchange_aux: (scene === 0 || scene >= 4) ? {2:[{seq:2,line:1,turn_diff:update}]} : {} };
  return <I18nProvider><div id="artboard" data-scene={scene}>
    <header className="media-brand"><span className="media-mark" aria-hidden="true" dangerouslySetInnerHTML={{__html:pluginIcon}}/><strong>Local AI Agent</strong><span>IntelliJ IDEA</span></header>
    <section className="media-copy">
      <h1>{descriptions[scene][0]}</h1>
      <p className="media-deck">{descriptions[scene][1]}</p>
      {scene === 0 ? <div className="media-features">
        <p><b>Codex CLI · Claude Code</b><span>{zh ? '沿用本机配置，不再配一遍' : 'Your existing CLI configuration'}</span></p>
        <p><b>{zh ? '语音与附件' : 'Voice & attachments'}</b><span>{zh ? '更自然地表达需求与上下文' : 'From an idea to a clear request'}</span></p>
        <p><b>{zh ? '固定快照 · 原生 Diff' : 'Fixed snapshots · Native Diff'}</b><span>{zh ? '每一轮，都能认真审查' : 'Review the changes from each turn'}</span></p>
      </div> : <ol className="media-steps">{steps.map((step, i) => <li key={step} data-current={scene === i + 1}><span>{i + 1}</span>{step}</li>)}</ol>}
      {scene === 5 ? <p className="media-capture-note">{zh ? '此预览展示对比入口。\nIDEA 原生弹窗将在最终实录中补入。' : 'Compare action shown in this preview.\nNative IDEA window capture follows in the final recording.'}</p> : null}
    </section>
    <section className="media-product" aria-label="Product preview">
      <header className="media-window"><strong>AI Agent</strong><span>{zh ? '演示项目 · email-validation' : 'Demo project · email-validation'}</span></header>
      <IdeaWorkbench projectName="email-validation" onNewSession={() => {}} settingsOpen={false} historyOpen={false} history={null} settings={null} drawer={null}
        chat={<div className="media-chat">
          <SessionTabs tabs={[{key:sessionBase.key,label:sessionBase.name}]} activeKey={sessionBase.key} ariaLabel="Sessions" previousLabel="Previous" nextLabel="Next" closeLabel={name => `Close ${name}`} runningLabel="Running" onSelect={() => {}} onClose={() => {}}/>
          {hasReply ? <SessionViewer rootId="demo" session={session as any} connected={false} loading={false}/> : <div className="media-empty"><p>{zh ? '从一个想法开始。' : 'Start with an idea.'}</p><span>{zh ? '说出需求，补上上下文。' : 'Describe the change. Bring the context.'}</span></div>}
        </div>}
        footer={<ActionBar key={hasReply ? 'reply' : 'draft'} compactWorkbench status="connected" currentRootId="demo" currentSession={sessionBase as any} editDraftRequest={hasReply ? null : draft} onSendMessage={async () => setScene(3)}/>}/>
    </section>
    <footer className="media-footer"><span>Codex CLI + Claude Code</span><span>{zh ? '演示预览 · 真实组件 / 预设语音与会话数据' : 'DEMO PREVIEW · Real components / scripted voice & conversation'}</span></footer>
  </div></I18nProvider>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
