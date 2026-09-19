import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../../src/i18n';
import { AgentSelector } from '../../src/components/AgentSelector';
import { IdeaAgentSettings } from '../../src/components/IdeaAgentSettings';
import { bootstrapService } from '../../src/services/bootstrap';
import type { AgentStatus } from '../../src/services/agents';

const w = window as any;
w.ideaAgent = { locale: 'zh-CN' };
w.selections = []; w.requests = []; w.links = [];
w.ccsInstalled = true;
w.open = (url: string) => { w.links.push(url); return null; };
bootstrapService.canUseProtectedAPI = () => true;
const originalFetch = window.fetch;
window.fetch = async (input, options) => {
  if (String(input).includes('/api/desktop/cc-switch/open')) {
    w.requests.push('open-ccswitch');
    return w.failOpen ? Response.json({ error: 'launch failed' }, { status: 500 }) : Response.json({ opened: true });
  }
  if (String(input).includes('/api/desktop/cc-switch')) return Response.json({ installed: w.ccsInstalled });
  if (String(input).includes('/api/agents/install')) {
    const { agent } = JSON.parse(String(options?.body));
    w.requests.push({ install: agent });
    return new Response(new ReadableStream({ start(controller) {
      const encoder = new TextEncoder();
      const send = (event: unknown) => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      send({type:'starting'}); send({type:'chunk',text:'Downloading native installer…\n'});
      w.finishInstall = (success: boolean) => {
        if (success) {
          send({type:'checking'});
          w.setAgents((items: AgentStatus[]) => items.map(item => item.name === agent ? { ...item, installed:true, available:true, models:[{id:'native-model',name:'Native model'}] } : item));
          send({type:'done'});
        } else send({type:'error',text:'Installer exited with code 7'});
        controller.close();
      };
    }}), { headers: { 'Content-Type': 'application/x-ndjson' } });
  }
  if (String(input).includes('/test-models')) {
    w.requests.push('models');
    return Response.json({ models: [{ id: 'native-model', name: 'Native model' }] });
  }
  if (String(input).includes('/test-connection')) {
    w.requests.push(JSON.parse(String(options?.body)));
    return new Response('{"type":"chunk","text":"Hi from fixture"}\n{"type":"done","elapsed_ms":100}\n');
  }
  return originalFetch(input, options);
};

function Fixture() {
  const [agent, setAgent] = useState('codex');
  const [agents, setAgents] = useState<AgentStatus[]>([
    { name: 'codex', installed: false, available: false, install_commands:['fixture-installer'] },
    { name: 'claude', installed: false, available: false, install_commands:['fixture-installer'] },
  ]);
  const [settings, setSettings] = useState(new URLSearchParams(location.search).has('settings'));
  w.setAgents = setAgents;
  const probe = async (name: string) => {
    w.requests.push({ probe: name });
    if (w.failProbe) throw new Error('Detection request failed');
    setAgents(items => items.map(item => item.name === name ? { ...item, probe_pending: true } : item));
    setTimeout(() => setAgents(items => items.map(item => item.name === name ? {
      ...item, installed: true, available: true, probe_pending: false,
      models: [{ id: 'native-model', name: 'Native model' }],
    } : item)), 700);
  };
  return <I18nProvider><main className="idea-workbench" style={{ minHeight: '100vh', padding: 12 }}>
    <button type="button" onClick={() => setSettings(value => !value)}>{settings ? '返回聊天' : '打开设置'}</button>
    {settings ? <IdeaAgentSettings agents={agents} busy={false} projectReady notice="" probingAgent="" error=""
      onProbe={probe} onRun={() => { throw new Error('Must not execute installation'); }} /> :
      <div style={{ position: 'absolute', bottom: 24, left: 16 }}>
        <AgentSelector agent={agent} agents={agents} showLabel showChevron stableLayout viewportMenu
          closeOnSelect={false} defaultExpandOptions allowDefaultModel
          onAgentChange={(name, model) => { w.selections.push({ name, model }); setAgent(name); }}
          onAgentRestart={probe} />
      </div>}
  </main></I18nProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
