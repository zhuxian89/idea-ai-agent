import { appPath } from './base';
import { protectedFetch, protectedJSON } from './api';
import { e2eeService } from './e2ee';
import type { AgentModelInfo } from './agents';

export type ConnectionEvent = { type: 'starting' | 'chunk' | 'checking' | 'done' | 'error'; text?: string; elapsed_ms?: number };
export function discoverAgentModels(agent: string, signal: AbortSignal) {
  return protectedJSON<{ current_model_id?: string; models?: AgentModelInfo[] }>(
    appPath(`/api/agents/test-models?agent=${encodeURIComponent(agent)}`), { signal },
  );
}

export async function testAgentConnection(
  request: { agent: string; model: string; message: string },
  signal: AbortSignal,
  onEvent: (event: ConnectionEvent) => void,
) {
  const response = await protectedFetch(appPath('/api/agents/test-connection'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal,
  });
  await readAgentEvents(response, onEvent);
}

export async function readAgentEvents(response: Response, onEvent: (event: ConnectionEvent) => void) {
  if (!response.ok) {
    const payload = await e2eeService.parseProtectedJSONResponse<{ error?: string }>(response);
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  let completed = false;
  const receive = (event: ConnectionEvent) => {
    if (event.type === 'done' || event.type === 'error') completed = true;
    onEvent(event);
  };
  if (!response.headers.get('Content-Type')?.includes('application/x-ndjson')) {
    const events = await e2eeService.parseProtectedJSONResponse<ConnectionEvent[]>(response);
    events.forEach(receive);
  } else {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty response');
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) if (line.trim()) receive(JSON.parse(line));
        if (done) break;
      }
      if (buffer.trim()) receive(JSON.parse(buffer));
    } finally { reader.releaseLock(); }
  }
  if (!completed) throw new Error('Connection closed before test completed');
}
