import React, { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { AgentIcon } from './AgentIcon';
import type { AgentModelInfo, AgentStatus } from '../services/agents';
import { discoverAgentModels, testAgentConnection } from '../services/agentConnectionTest';
import './AgentConnectionTest.css';

export function AgentConnectionTest({ agent, onClose }: { agent: AgentStatus; onClose: () => void }) {
  const { t } = useI18n();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLPreElement>(null);
  const [models, setModels] = useState<AgentModelInfo[]>([]);
  const [model, setModel] = useState('');
  const [message, setMessage] = useState('Hi');
  const [loading, setLoading] = useState(true);
  const [modelsError, setModelsError] = useState('');
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'error' | 'stopped'>('idle');
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const displayName = agent.name === 'claude' ? 'Claude Code' : agent.name === 'codex' ? 'Codex' : agent.name;

  useEffect(() => {
    dialog.current?.showModal();
    return () => { request.current?.abort(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setModelsError(''); setModels([]); setModel('');
    discoverAgentModels(agent.name, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      const visible = (result.models || []).filter(item => !item.hidden);
      if (result.current_model_id && !visible.some(item => item.id === result.current_model_id)) {
        visible.unshift({ id: result.current_model_id, name: result.current_model_id });
      }
      setModels(visible);
      setModel(result.current_model_id || '');
    }).catch(err => { if (!controller.signal.aborted) setModelsError(String(err.message || err)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [agent.name, refresh]);

  const close = () => { request.current?.abort(); dialog.current?.close(); onClose(); };
  const run = async () => {
    if (phase === 'running' || !message.trim()) return;
    const controller = new AbortController();
    request.current = controller;
    setPhase('running'); setOutput(''); setError(''); setElapsed(0);
    try {
      await testAgentConnection({ agent: agent.name, model, message }, controller.signal, event => {
        if (controller.signal.aborted) return;
        setElapsed(event.elapsed_ms || 0);
        if (event.type === 'chunk') setOutput(previous => previous + (event.text || ''));
        if (event.type === 'done') setPhase('done');
        if (event.type === 'error') { setPhase('error'); setError(event.text || t('agentTest.failed')); }
      });
    } catch (err) {
      if (!controller.signal.aborted) { setPhase('error'); setError(err instanceof Error ? err.message : String(err)); }
    } finally { if (request.current === controller) request.current = null; }
  };
  useEffect(() => {
    const el = outputRef.current;
    if (el && el.scrollHeight - el.clientHeight - el.scrollTop < 120) el.scrollTop = el.scrollHeight;
  }, [output]);

  return <dialog ref={dialog} className="idea-agent-test" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close(); }}>
    <header><h2 id={titleId}>{t('agentTest.title')}</h2><button type="button" aria-label={t('agentTest.close')} onClick={close}>×</button></header>
    <div className="idea-agent-test-body">
      <div className="idea-agent-test-identity"><AgentIcon agentName={agent.name} style={{ width: 24, height: 24 }} /><strong>{displayName}</strong><span>{agent.version}</span></div>
      <p className="idea-agent-test-hint">{t('agentTest.hint')}</p>
      <label>{t('agentTest.model')}<select value={model} disabled={loading || phase === 'running'} onChange={event => setModel(event.target.value)}>
        <option value="">{loading ? t('agentTest.discovering') : t('agentTest.defaultModel')}</option>
        {models.map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
      </select></label>
      <div className="idea-agent-test-model-feedback">
        <span role="status">{loading ? t('agentTest.discovering') : models.length ? t('agentTest.modelCount', { count: models.length }) : t('agentTest.noModels')}</span>
        <button type="button" disabled={loading || phase === 'running'} onClick={() => setRefresh(value => value + 1)}>{t('agentTest.refresh')}</button>
      </div>
      {modelsError ? <p className="idea-agent-test-error" role="alert">{modelsError}</p> : null}
      <label>{t('agentTest.message')}<textarea rows={2} maxLength={2000} value={message} disabled={phase === 'running'} onChange={event => setMessage(event.target.value)} /></label>
      <div className="idea-agent-test-result-heading"><strong>{t('agentTest.response')}</strong><span role="status">{t(`agentTest.${phase}`)}{elapsed > 0 ? ` · ${(elapsed / 1000).toFixed(1)}s` : ''}</span></div>
      <pre ref={outputRef} className="idea-agent-test-output" tabIndex={0} aria-label={t('agentTest.response')}>{output || (phase === 'running' ? t('agentTest.waiting') : t('agentTest.empty'))}</pre>
      {error ? <p className="idea-agent-test-error" role="alert">{error}</p> : null}
    </div>
    <footer><button type="button" onClick={close}>{t('agentTest.close')}</button>{phase === 'running'
      ? <button type="button" onClick={() => { request.current?.abort(); setPhase('stopped'); }}>{t('agentTest.stop')}</button>
      : <button className="idea-agent-test-primary" type="button" disabled={loading || !message.trim()} onClick={() => void run()}>{t(phase === 'idle' ? 'agentTest.start' : 'agentTest.retry')}</button>}
    </footer>
  </dialog>;
}
