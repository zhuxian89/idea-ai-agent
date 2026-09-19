import type { AgentStatus } from './agents';

// Only known official entry points; never infer a URL from a CLI command/error.
const helpLinks: Record<string, { install: string; login: string; ccSwitch?: boolean }> = {
  codex: { install: 'https://github.com/openai/codex#installation', login: 'https://developers.openai.com/codex/auth', ccSwitch: true },
  claude: { install: 'https://code.claude.com/docs/en/setup', login: 'https://code.claude.com/docs/en/authentication', ccSwitch: true },
  cursor: { install: 'https://cursor.com/docs/cli/installation', login: 'https://cursor.com/docs/cli/reference/authentication' },
  gemini: { install: 'https://geminicli.com/docs/get-started/installation/', login: 'https://geminicli.com/docs/get-started/authentication/', ccSwitch: true },
};

export const CC_SWITCH_URL = 'https://github.com/farion1231/cc-switch';
export const agentHelpLinks = (name: string) => helpLinks[name];
export const agentDisplayName = (name: string) => name === 'claude' ? 'Claude Code' : name === 'codex' ? 'Codex' : name;

export function agentErrorMessage(error?: string): string {
  const raw = (error || '').trim();
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed?.message === 'string' && parsed.message.trim() ? parsed.message.trim() : raw;
  } catch { return raw; }
}

export function agentSetupState(agent?: AgentStatus) {
  if (agent?.probe_pending) return 'pending';
  if (!agent) return 'unknown';
  if (agent.available) return 'ready';
  if (!agent.installed) return 'missing';
  return /^(?:sign in required|login required|not logged in|authentication required)\b|^(?:需要登录|未登录|请先登录)/i.test(agentErrorMessage(agent.error)) ? 'login' : 'error';
}

export function agentSetupStatusKey(agent?: AgentStatus) {
  const state = agentSetupState(agent);
  if (state === 'pending') return 'agent.discoveringShort';
  if (state === 'missing') return 'agentSetup.notInstalled';
  if (state === 'login') return 'agent.loginRequired';
  return 'agent.unavailable';
}

// The first-use picker needs the two primary agents even before installation.
export function agentsForPicker(agents: AgentStatus[]) {
  return agents.filter(agent => agent.installed || agent.name === 'codex' || agent.name === 'claude');
}
