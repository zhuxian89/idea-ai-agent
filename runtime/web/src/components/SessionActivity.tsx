import { useEffect, useState } from "react";
import type { TimelineItem } from "../hooks/useSessionStream";
import { useI18n } from "../i18n";

export function SessionActivity({ timeline, lastEventAt, connected, recoveryText }: {
  timeline: TimelineItem[];
  lastEventAt: number;
  connected: boolean;
  recoveryText: string;
}) {
  const { t } = useI18n();
  const [openedAt] = useState(Date.now);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  let userIndex = -1;
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i].type === "user_text") { userIndex = i; break; }
  }
  const user = timeline[userIndex];
  const startedAt = user?.type === "user_text" && user.timestamp ? Date.parse(user.timestamp) : openedAt;
  const since = Number.isFinite(startedAt) ? startedAt : openedAt;
  const idleSeconds = Math.max(0, Math.floor((now - Math.max(since, lastEventAt || openedAt)) / 1000));
  const elapsedSeconds = Math.max(0, Math.floor((now - since) / 1000));
  const currentTurn = timeline.slice(userIndex + 1);
  const runningTools = currentTurn.filter((item) => item.type === "tool" && ["running", "pending", "in_progress"].includes(item.toolCall.status || ""));
  const question = runningTools.find((item) => item.type === "tool" && item.toolCall.kind === "ask_user");
  const tool = runningTools[runningTools.length - 1];
  const last = currentTurn[currentTurn.length - 1];
  const sending = user?.type === "user_text" && user.pendingAck;
  const label = !connected ? t("session.activityDisconnected")
    : question ? t("session.activityAnswer")
    : sending ? t("session.activitySending")
    : recoveryText || (tool?.type === "tool" ? t("session.activityTool", { name: tool.toolCall.title || tool.toolCall.kind || "Agent" })
    : last?.type === "thought" ? t("session.activityThinking")
    : last?.type === "assistant_text" ? t("session.generating")
    : t("session.activityWaiting"));
  const quiet = connected && !question && idleSeconds >= 60;
  return <div data-session-activity className="session-activity">
    <div role="status" aria-live="polite" className="session-activity-label">
      <span aria-hidden="true" className="session-activity-dot" />
      <span>{label}</span>
    </div>
    <div className="session-activity-time">
      {t("session.activityElapsed", { seconds: elapsedSeconds })}
      {lastEventAt > 0 ? ` · ${t("session.activityLastUpdate", { seconds: idleSeconds })}` : ""}
    </div>
    {quiet ? <div className="session-activity-note">{t("session.activityQuiet", { seconds: idleSeconds })}</div> : null}
  </div>;
}
