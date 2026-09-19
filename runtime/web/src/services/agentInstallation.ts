import { useSyncExternalStore } from 'react';
import { protectedFetch } from './api';
import { appPath } from './base';
import { readAgentEvents } from './agentConnectionTest';

export const AGENT_INSTALLATION_CHANGED = 'agent-installation-changed';
type Installation = { phase: 'idle' | 'installing' | 'checking' | 'done' | 'error'; output: string; error: string };
const idle: Installation = { phase: 'idle', output: '', error: '' };
const jobs = new Map<string, Installation>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function update(name: string, value: Installation) {
  jobs.set(name, value);
  listeners.forEach(listener => listener());
}
export function useAgentInstallation(name: string) {
  return useSyncExternalStore(subscribe, () => jobs.get(name) || idle, () => idle);
}

// Not tied to a popup's lifetime: changing Agent or opening settings keeps the
// same installation visible and cannot launch a second copy from another entry.
export async function installAgent(name: string) {
  const current = jobs.get(name);
  if (current?.phase === 'installing' || current?.phase === 'checking') return;
  let next: Installation = { phase: 'installing', output: '', error: '' };
  update(name, next);
  try {
    const response = await protectedFetch(appPath('/api/agents/install'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent: name }),
    });
    await readAgentEvents(response, event => {
      if (event.type === 'chunk') {
        const text = (event.text || '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');
        next = { ...next, output: (next.output + text).slice(-16000) };
      }
      if (event.type === 'checking') next = { ...next, phase: 'checking' };
      if (event.type === 'done') next = { ...next, phase: 'done' };
      if (event.type === 'error') next = { ...next, phase: 'error', error: event.text || 'Installation failed' };
      update(name, next);
    });
  } catch (error) {
    update(name, { ...next, phase: 'error', error: error instanceof Error ? error.message : String(error) });
  } finally {
    window.dispatchEvent(new Event(AGENT_INSTALLATION_CHANGED));
  }
}
