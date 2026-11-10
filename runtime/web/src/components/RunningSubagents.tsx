import { useI18n } from "../i18n";
import type { RunningSubagent } from "../services/runningSubagents";

export function RunningSubagents({ items, onOpen, onStop }: {
  items: RunningSubagent[];
  // Opens the child session of this subagent, when it has been created.
  onOpen?: (item: RunningSubagent) => void;
  onStop?: (item: RunningSubagent) => void;
}) {
  const { t } = useI18n();
  if (!items.length) return null;
  return <section className="running-subagents" aria-label={t("session.subagentsRunning", { count: items.length })}>
    <h3 className="running-subagents-title">{t("session.subagentsRunning", { count: items.length })}</h3>
    <ul className="running-subagents-list">
      {items.map((item) => <li key={item.callId} className="running-subagent">
        <button type="button" className="running-subagent-open" onClick={() => onOpen?.(item)} disabled={!onOpen}
          title={item.progress || item.title}>
          <span className="running-subagent-title">{item.title}</span>
          {item.subagentType ? <span className="running-subagent-type">{item.subagentType}</span> : null}
        </button>
        {onStop ? <button type="button" className="running-subagent-stop" onClick={() => onStop(item)}
          aria-label={t("session.subagentStop", { name: item.title })}>{t("session.subagentStopShort")}</button> : null}
      </li>)}
    </ul>
  </section>;
}
