import React, { useState } from 'react';
import { useI18n } from '../i18n';
import type { AgentStatus } from '../services/agents';
import { agentDisplayName, agentHelpLinks, agentSetupState } from '../services/agentSetup';
import { installAgent, useAgentInstallation } from '../services/agentInstallation';
import { CCSwitchAction } from './CCSwitchAction';
import { openExternalURL } from '../services/platformNavigation';
import './AgentSetupGuide.css';

type Props = {
  agent: AgentStatus;
  probing?: boolean;
  disabled?: boolean;
  onProbe?: (name: string) => void | Promise<void>;
  onTest: () => void;
  onContinue?: () => void;
  showTitle?: boolean;
};

function HelpLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" onClick={event => {
    event.preventDefault(); openExternalURL(href);
  }}>{children}<span aria-hidden="true"> ↗</span></a>;
}

export function AgentSetupGuide({ agent, probing = false, disabled = false, onProbe, onTest, onContinue, showTitle = true }: Props) {
  const { t } = useI18n();
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState('');
  const installation = useAgentInstallation(agent.name);
  const installing = installation.phase === 'installing' || installation.phase === 'checking';
  const state = agentSetupState(agent);
  const pending = probing || requesting || state === 'pending';
  const links = agentHelpLinks(agent.name);
  const name = agentDisplayName(agent.name);
  const probe = async () => {
    if (!onProbe || pending) return;
    setRequesting(true); setRequestError('');
    try { await onProbe(agent.name); }
    catch (error) { setRequestError(error instanceof Error ? error.message : String(error)); }
    finally { setRequesting(false); }
  };
  return <section className="agent-setup-guide" data-agent-setup={agent.name} aria-label={t('agentSetup.title', { name })}>
    {showTitle ? <h3>{t('agentSetup.title', { name })}</h3> : null}
    {installing ? <p role="status">{t(installation.phase === 'checking' ? 'agentSetup.detecting' : 'agentSetup.installing')}</p> : pending ? <p role="status">{t('agentSetup.detecting')}</p> : state === 'missing' ? <>
      <p>{t('agentSetup.installHint', { name })}</p>
      {agent.install_commands?.length ? <div className="agent-setup-actions"><button type="button" className="agent-setup-primary" disabled={disabled} onClick={() => void installAgent(agent.name)}>{t('agentSetup.installNow')}</button></div> : null}
      {links ? <HelpLink href={links.install}>{t('agentSetup.installLink')}</HelpLink> : <>
        <p>{t('agentSetup.genericInstall')}</p>
        {agent.install_commands?.length ? <details><summary>{t('agentSetup.installCommands')}</summary><pre>{agent.install_commands.join('\n')}</pre></details> : null}
      </>}
      <p>{t('agentSetup.afterInstall')}</p>
    </> : state === 'ready' ? <p role="status">{t('agentSetup.detected')}</p> : <>
      <p role="status">{t(state === 'login' ? 'agentSetup.loginHint' : 'agentSetup.errorHint')}</p>
      {state === 'login' && links ? <HelpLink href={links.login}>{t('agentSetup.loginLink')}</HelpLink> : null}
    </>}
    {installation.phase === 'done' && !installing ? <p role="status">{t('agentSetup.installed')}</p> : null}
    {installation.error ? <p role="alert">{installation.error}</p> : null}
    {installation.output ? <details className="agent-setup-install-output" open={installing || installation.phase === 'error'}><summary>{t('agentSetup.installOutput')}</summary><pre tabIndex={0}>{installation.output}</pre></details> : null}
    {!installing && !pending && state !== 'ready' && links?.ccSwitch ? <CCSwitchAction /> : null}
    {!pending && state !== 'missing' && state !== 'ready' && agent.error ? <details data-agent-error-details={agent.name}>
      <summary>{t('agentSetup.errorDetails')}</summary>
      <pre>{agent.error}</pre>
    </details> : null}
    {requestError ? <p role="alert">{requestError}</p> : null}
    <div className="agent-setup-actions">
      {!installing && onProbe && state !== 'ready' ? <button type="button" disabled={disabled || pending} onClick={() => void probe()}>{t(pending ? 'agentSetup.detecting' : state === 'missing' ? 'agentSetup.detectAgain' : 'agentConfig.retryDetection')}</button> : null}
      {agent.installed && !pending && !installing ? <button type="button" disabled={disabled} onClick={onTest}>{t('agentTest.title')}</button> : null}
      {state === 'ready' && onContinue ? <button type="button" onClick={onContinue}>{t('agentSetup.chooseModel')}</button> : null}
    </div>
  </section>;
}
