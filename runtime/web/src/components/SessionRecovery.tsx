import { useState, useSyncExternalStore } from "react";
import { useI18n } from "../i18n";
import { useNetworkOnline } from "../hooks/useNetworkOnline";
import { sessionService } from "../services/session";

const subscribe = (notify: () => void) => sessionService.subscribeEvents(() => notify());
const serverSnapshot = () => undefined;

export function SessionRecovery({ session, rootId, connected, active }: {
  session: Parameters<typeof sessionService.continueFailedSession>[1]; rootId: string; connected: boolean; active: boolean;
}) {
  const { t } = useI18n();
  const online = useNetworkOnline();
  const key = session.key || session.session_key || "";
  const failure = useSyncExternalStore(subscribe, () => sessionService.getSessionFailure(rootId, key), serverSnapshot);
  const [dispatchFailed, setDispatchFailed] = useState(false);
  if (!failure || active || !session.agent || session.type === "command") return null;
  const disabled = !online || !connected || failure.sending;
  return <div className="session-recovery" data-session-recovery>
    <p role="status">{t(!online ? "session.continueOffline" : !connected ? "session.continueDisconnected" : "session.continueHint")}</p>
    <button type="button" className="session-recovery-button" disabled={disabled}
      onClick={async () => {
        setDispatchFailed(false);
        const sent = await sessionService.continueFailedSession(rootId, session, t("session.continuePrompt"));
        if (!sent) setDispatchFailed(true);
      }}>{t(failure.sending ? "session.activitySending" : "session.continueSession")}</button>
    {dispatchFailed ? <p role="alert">{t("session.messageSendFailedNotReady")}</p> : null}
  </div>;
}
