import React from 'react';
import { AgentIcon } from './AgentIcon';
import type { AgentStatus } from '../services/agents';
import { agentDisplayName, agentSetupState, agentSetupStatusKey } from '../services/agentSetup';
import { useI18n } from '../i18n';

export function AgentSelectorRow({ agent, active, expanded, hasOptions, onSelect, onExpand }: {
  agent: AgentStatus; active: boolean; expanded: boolean; hasOptions: boolean;
  onSelect: () => void; onExpand: () => void;
}) {
  const { t } = useI18n();
  const ready = agentSetupState(agent) === 'ready';
  const name = agentDisplayName(agent.name);
  return <div className="agent-selector-row" data-agent-row={agent.name} data-active={active}>
    <button type="button" onClick={onSelect} title={name} aria-expanded={!ready ? expanded : undefined}>
      <AgentIcon agentName={agent.name} style={{ width: 16, height: 16, flexShrink: 0 }} />
      <span className="agent-selector-row-text"><span className="agent-selector-row-name">{name}</span>
        {!ready ? <span className="agent-selector-row-status" role={agent.probe_pending ? 'status' : undefined} aria-label={agent.probe_pending ? t('agent.discovering', { name: agent.name }) : undefined}>{t(agentSetupStatusKey(agent))}</span> : null}
      </span>
    </button>
    {ready && hasOptions ? <button type="button" aria-expanded={expanded} aria-label={t(expanded ? 'agent.collapseModels' : 'agent.expandModels', { name: agent.name })} onClick={onExpand}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" style={{ transform: expanded ? 'rotate(90deg)' : undefined }}><path d="M4 2.5 8 6 4 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button> : null}
  </div>;
}
