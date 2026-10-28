import { useEffect, useMemo, useState } from "react";
import type { TimelineItem } from "../hooks/useSessionStream";
import { useI18n } from "../i18n";
import { buildToolActivityView } from "../services/toolActivity";
import { toolReaction } from "../services/activityReaction";
import { sessionActivityDetail } from "../services/sessionActivityDetail";
import { readActivityFacts, toolActivityState } from "../services/activityFacts";
import { useActivityTerminal } from "../hooks/useActivityTerminal";
import { useNetworkOnline } from "../hooks/useNetworkOnline";

export function SessionActivity({ timeline, lastEventAt, connected, recoveryText, rootId = "", sessionKey = "", rootPath, active = true }: {
  timeline: TimelineItem[];
  lastEventAt: number;
  connected: boolean;
  recoveryText: string;
  rootId?: string;
  sessionKey?: string;
  rootPath?: string;
  active?: boolean;
}) {
  const { t, locale } = useI18n();
  const networkOnline = useNetworkOnline();
  const [openedAt] = useState(Date.now);
  const [now, setNow] = useState(Date.now);
  let userIndex = -1;
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i].type === "user_text") { userIndex = i; break; }
  }
  const user = timeline[userIndex];
  const terminal = useActivityTerminal({ sessionKey, rootId, turnKey: user?.id || "", active });
  useEffect(() => {
    if (!active || terminal) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, terminal, user?.id]);
  const startedAt = user?.type === "user_text" && user.timestamp ? Date.parse(user.timestamp) : openedAt;
  const since = Number.isFinite(startedAt) ? startedAt : openedAt;
  const clock = terminal?.at ?? now;
  const idleSeconds = Math.max(0, Math.floor((clock - Math.max(since, terminal?.at ?? lastEventAt)) / 1000));
  const elapsedSeconds = Math.max(0, Math.floor((clock - since) / 1000));
  const currentTurn = timeline.slice(userIndex + 1);
  const runningTools = currentTurn.filter((item) => item.type === "tool" &&
    (readActivityFacts(item.toolCall.activity)?.outcome || toolActivityState(item.toolCall.status || "")) === "running");
  const question = runningTools.find((item) => item.type === "tool" && item.toolCall.kind === "ask_user");
  const tool = runningTools[runningTools.length - 1];
  const toolView = useMemo(() => tool?.type === "tool" ? buildToolActivityView(tool.toolCall, {
    rootId, sessionKey, rootPath, locale, agent: tool.agent, sourceTurnKey: tool.sourceTurnKey, requiresInteraction: false,
  }) : null, [tool, rootId, sessionKey, rootPath, locale]);
  const last = currentTurn[currentTurn.length - 1];
  const sending = user?.type === "user_text" && user.pendingAck;
  const compacting = last?.type === "compact" && last.compactNotice.status === "running";
  // Silence changes the last-update clock, not the last known activity.
  // Commands and compaction can legitimately run without emitting progress.
  const working = compacting ? { emoji: "✍️", key: "session.activityCompacting" } as const
    : toolView ? toolReaction(toolView.operation)
    : last?.type === "thought" ? { emoji: "🤔", key: "session.activityThinking" } as const
    : last?.type === "assistant_text" ? { emoji: "✏️", key: "session.generating" } as const
    : { emoji: "👀", key: currentTurn.length === 0 ? "session.activityQueued" : "session.activityWaiting" } as const;
  const reaction = terminal ? { emoji: terminal.kind === "error" ? "😱" : "👍", label: t(terminal.kind === "error" ? "session.activityError" : "session.activityDone") }
    : !networkOnline ? { emoji: "🔌", label: t("session.activityOffline") }
    : !connected ? { emoji: "🔌", label: t("session.activityDisconnected") }
    : question ? { emoji: "💬", label: t("session.activityAnswer") }
    : sending ? { emoji: "👀", label: t("session.activitySending") }
    : recoveryText ? { emoji: "🔄", label: recoveryText }
    : { emoji: working.emoji, label: t(working.key) };
  const detail = useMemo(() => sessionActivityDetail({ timeline, tool: toolView, locale }), [timeline, toolView, locale]);
  const showDetail = !terminal && networkOnline && connected && !question && !sending && !recoveryText && !compacting && !!detail;
  const formatDuration = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds / 60) % 60;
    const seconds = totalSeconds % 60;
    if (hours > 0) return t("session.activityDurationHours", { hours, minutes, seconds });
    if (minutes > 0) return t("session.activityDurationMinutes", { minutes, seconds });
    return t("session.activityDurationSeconds", { seconds });
  };
  const idleDuration = formatDuration(idleSeconds);
  const activityLabel = showDetail ? detail : reaction.label;
  const timeLabel = `${t("session.activityElapsed", { duration: formatDuration(elapsedSeconds) })} · ${lastEventAt > 0 || terminal ? t("session.activityLastUpdate", { duration: idleDuration }) : t("session.activityNoUpdate")}`;
  if (!active && !terminal) return null;
  return <div data-session-activity className="session-activity">
    <div className="session-activity-label" role="status" aria-live="polite" aria-atomic="true">
      <span aria-hidden="true" className="session-activity-emoji">{reaction.emoji}</span>
      <span className={`session-activity-text${showDetail ? " session-activity-tool-summary" : ""}`} title={activityLabel} tabIndex={0}>{activityLabel}</span>
    </div>
    <div className="session-activity-time" title={timeLabel}>{timeLabel}</div>
  </div>;
}
