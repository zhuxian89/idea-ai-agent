import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { protectedJSON } from '../services/api';
import { appPath } from '../services/base';
import { CC_SWITCH_URL } from '../services/agentSetup';
import { openExternalURL } from '../services/platformNavigation';

export function CCSwitchAction() {
  const { t } = useI18n();
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const detect = () => {
      protectedJSON<{ installed: boolean }>(appPath('/api/desktop/cc-switch'), { signal: controller.signal })
        .then(result => { if (!controller.signal.aborted) { setInstalled(result.installed); setChecking(false); } })
        .catch(() => { if (!controller.signal.aborted) { setInstalled(null); setChecking(false); } });
    };
    detect();
    window.addEventListener('focus', detect);
    return () => { controller.abort(); window.removeEventListener('focus', detect); };
  }, []);
  const open = async () => {
    setOpening(true); setError('');
    try {
      await protectedJSON(appPath('/api/desktop/cc-switch/open'), { method: 'POST' });
    } catch (error) {
      setError(t('agentSetup.switchOpenFailed') + ' ' + (error instanceof Error ? error.message : String(error)));
    } finally { setOpening(false); }
  };
  const download = <a href={CC_SWITCH_URL + '/releases/latest'} target="_blank" rel="noopener noreferrer" onClick={event => {
    event.preventDefault(); openExternalURL(CC_SWITCH_URL + '/releases/latest');
  }}>{t('agentSetup.downloadSwitch')}<span aria-hidden="true"> ↗</span></a>;
  return <div className="agent-setup-switch">
    <p className="agent-setup-secondary">{t('agentSetup.switchHint')}</p>
    {checking ? <p role="status">{t('agentSetup.checkingSwitch')}</p> : installed ? <button type="button" disabled={opening} onClick={() => void open()}>{t(opening ? 'agentSetup.openingSwitch' : 'agentSetup.openSwitch')}</button>
      : download}
    {error ? <><p role="alert">{error}</p>{installed ? download : null}</> : null}
  </div>;
}
