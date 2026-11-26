
import { ReplyContext } from "./stream/ReplyContext";
import React, { memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PhoneSheet } from "./remoteui/PhoneSheet";
import { PhoneActivityHostContext } from "./remoteui/phoneSessionFacts";
import { useSessionStream, type TimelineItem } from "../hooks/useSessionStream";

import { ThinkingBlock } from "./stream/ThinkingBlock";
import { ToolCallCard, renderToolIcon } from "./stream/ToolCallCard";
import { AgentIcon } from "./AgentIcon";
import { InlineTokenText } from "./InlineTokenText";
import { MarkdownViewer } from "./MarkdownViewer";

import { savePrompt } from "../services/prompts";
import { reportError } from "../services/error";
import { rootBadgeButtonStyle } from "./rootBadgeStyle";
import { copyText } from "../services/clipboard";

import { useI18n } from "../i18n";
import { formatSessionDuration } from "../services/sessionDuration";
import { SessionActivity } from "./SessionActivity";
import { settingsChanges } from "../services/sessionSettingsChange";
import { SessionRecovery } from "./SessionRecovery";
import { ActivityTimeline } from "./stream/ActivityTimeline";
import { TurnDiffSummary } from "./TurnDiffSummary";
import { SessionViewerProps, MessageTimelineItem } from "./sessionViewerTypes";
import {
  NEAR_BOTTOM_DISTANCE,
  distanceFromSessionBottom,
  extractUploadAttachments,
  stripImageAttachmentTokens,
  stripUploadAttachmentTokens,
  modelDisplayName,
  formatAssistantExchangeMeta,
  formatSettingsChange,
  previousUserTimestamp,
  formatTime,
  formatToolCallFallbackResult,
  timelineItemSpacing,
} from "./sessionViewerUtils";
import { getAskUserQuestions, ForkIcon, AskUserQuestionCard } from "./AskUserQuestionCard";
import { PlanUpdateCard, CompactNoticeCard, TodoUpdateCard } from "./TimelineNoticeCards";
import { AttachmentImage } from "./AttachmentImage";

function SessionViewerInner({
  session,
  phone = false,
  connected = true,
  loading = false,
  slashCommandResult = null,
  rootId,
  rootPath,
  interactionMode = "main",
  targetSeq = 0,
  targetSeqRequestKey = "",
  onFileClick,
  onRootClick,
  onAskUserAnswer,
  onEditUserMessage,
  onForkAgentMessage,
  agents,
}: SessionViewerProps) {
  const { locale, t } = useI18n();
  const activityHost = useContext(PhoneActivityHostContext);
  const [openPhoneAsk, setOpenPhoneAsk] = useState("");
  const [savedPromptKeys, setSavedPromptKeys] = useState<Record<string, true>>(
    {},
  );
  const [copiedMessageKeys, setCopiedMessageKeys] = useState<
    Record<string, true>
  >({});
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const onFileClickRef = useRef(onFileClick);
  const copyResetTimersRef = useRef<Record<string, number>>({});
  const sessionKey = session?.key || session?.session_key || null;
  const exchanges = Array.isArray(session?.exchanges) ? session.exchanges : [];
  const isAwaiting = !!(session as any)?.pending;
  const { timeline, isStreaming, streamVersion, streamStatusText, lastEventAt } = useSessionStream(
    sessionKey,
    exchanges,
    session?.exchange_aux || {},
    session?.context_window,
    isAwaiting,
  );
  const userMessageIndexByTimelineIndex = useMemo(() => {
    const indexes = new Map<number, number>();
    timeline.forEach((item, index) => {
      if (item.type === "user_text") indexes.set(index, indexes.size + 1);
    });
    return indexes;
  }, [timeline]);
  // Comparing settings across agents is meaningless (fast mode only exists for
  // some), so a notice only appears between two messages of the same agent.
  const settingsNoticeByTimelineIndex = useMemo(() => {
    const notices = new Map<number, string>();
    let previous: MessageTimelineItem | undefined;
    const settingsOf = (item: MessageTimelineItem) => ({
      model: `${item.model || ""}`.trim(),
      modelName: `${item.modelDisplayName || ""}`.trim() || modelDisplayName(agents, item.agent, item.model),
      effort: `${item.effort || ""}`.trim(),
      fastService: `${item.fastService || ""}`.trim(),
    });
    timeline.forEach((item, index) => {
      if (item.type !== "user_text") return;
      if (previous && previous.agent === item.agent) {
        const changes = settingsChanges(settingsOf(previous), settingsOf(item));
        if (changes.length) {
          notices.set(index, t("session.settingsChanged", {
            changes: changes.map((change) => formatSettingsChange(change, t)).join(" · "),
          }));
        }
      }
      previous = item;
    });
    return notices;
  }, [timeline, agents, t]);
  const shouldStickToBottomRef = useRef(true);
  const lastSessionKeyRef = useRef<string | null>(null);
  const targetSeqScrollKeyRef = useRef("");
  const targetSeqFrameRef = useRef<number | null>(null);
  const targetSeqTimerRefs = useRef<number[]>([]);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const readingActivityRef = useRef(false);
  const pauseForActivityReading = (event: React.SyntheticEvent) => {
    if (!(event.target instanceof Element) || !event.target.closest("[data-activity-reading]")) return;
    readingActivityRef.current = true;
    shouldStickToBottomRef.current = false;
    if (scrollRef.current) {
      setShowJumpToLatest(distanceFromSessionBottom(scrollRef.current) > NEAR_BOTTOM_DISTANCE);
    }
  };
  const viewportStickFrameRef = useRef<number | null>(null);

  const cancelTargetSeqScroll = () => {
    if (targetSeqFrameRef.current !== null) {
      window.cancelAnimationFrame(targetSeqFrameRef.current);
      targetSeqFrameRef.current = null;
    }
    targetSeqTimerRefs.current.forEach((timer) => window.clearTimeout(timer));
    targetSeqTimerRefs.current = [];
  };

  const stickSessionToBottom = (behavior: ScrollBehavior = "auto") => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTo({ top: maxTop, behavior });
  };

  useEffect(() => {
    onFileClickRef.current = onFileClick;
  }, [onFileClick]);

  useEffect(() => {
    setSavedPromptKeys({});
    setCopiedMessageKeys({});
    Object.values(copyResetTimersRef.current).forEach((timer) =>
      window.clearTimeout(timer),
    );
    copyResetTimersRef.current = {};
  }, [sessionKey]);

  useEffect(() => {
    return () => {
      Object.values(copyResetTimersRef.current).forEach((timer) =>
        window.clearTimeout(timer),
      );
      copyResetTimersRef.current = {};
      if (targetSeqFrameRef.current !== null) {
        window.cancelAnimationFrame(targetSeqFrameRef.current);
        targetSeqFrameRef.current = null;
      }
      if (viewportStickFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportStickFrameRef.current);
        viewportStickFrameRef.current = null;
      }
      targetSeqTimerRefs.current.forEach((timer) => window.clearTimeout(timer));
      targetSeqTimerRefs.current = [];
    };
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    if (!scrollEndRef.current) {
      return;
    }
    const nextKey = sessionKey;
    const isSessionChanged = lastSessionKeyRef.current !== nextKey;
    if (isSessionChanged) {
      lastSessionKeyRef.current = nextKey;
      readingActivityRef.current = false;
      shouldStickToBottomRef.current = true;
    }
    if (shouldStickToBottomRef.current) {
      stickSessionToBottom("auto");
    }
    setShowJumpToLatest(distanceFromSessionBottom(container) > NEAR_BOTTOM_DISTANCE);
  }, [sessionKey, timeline, isStreaming, streamVersion, slashCommandResult]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || typeof window === "undefined") {
      return;
    }
    const queueStickToBottom = () => {
      if (!shouldStickToBottomRef.current) {
        return;
      }
      if (viewportStickFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportStickFrameRef.current);
      }
      viewportStickFrameRef.current = window.requestAnimationFrame(() => {
        viewportStickFrameRef.current = null;
        if (!shouldStickToBottomRef.current) {
          return;
        }
        stickSessionToBottom("auto");
      });
    };
    window.visualViewport?.addEventListener("resize", queueStickToBottom);
    window.visualViewport?.addEventListener("scroll", queueStickToBottom);
    window.addEventListener("mindfs:safe-area-updated", queueStickToBottom as EventListener);
    return () => {
      window.visualViewport?.removeEventListener("resize", queueStickToBottom);
      window.visualViewport?.removeEventListener("scroll", queueStickToBottom);
      window.removeEventListener("mindfs:safe-area-updated", queueStickToBottom as EventListener);
      if (viewportStickFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportStickFrameRef.current);
        viewportStickFrameRef.current = null;
      }
    };
  }, [sessionKey]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      shouldStickToBottomRef.current = true;
      setShowJumpToLatest(false);
      return;
    }
    let lastScrollTop = el.scrollTop;
    const updateStickiness = () => {
      const distanceFromBottom = distanceFromSessionBottom(el);
      const isNearBottom = distanceFromBottom <= NEAR_BOTTOM_DISTANCE;
      const movedUp = el.scrollTop < lastScrollTop;
      const movedDown = el.scrollTop > lastScrollTop;
      if (isNearBottom) {
        readingActivityRef.current = false;
        shouldStickToBottomRef.current = true;
      } else if (readingActivityRef.current) {
        shouldStickToBottomRef.current = false;
      } else if (movedUp) {
        shouldStickToBottomRef.current = false;
      } else if (movedDown && distanceFromBottom < 200) {
        shouldStickToBottomRef.current = true;
      }
      setShowJumpToLatest(!isNearBottom);
      lastScrollTop = el.scrollTop;
    };
    updateStickiness();
    el.addEventListener("scroll", updateStickiness, { passive: true });
    // The distance to the bottom also changes with no scroll at all: a reader expands a running
    // detail, or its log grows. Measuring only when the reader taps (before the content grows) or
    // scrolls left the button hidden while the latest message was out of sight. Re-measure when the
    // content's height changes. A viewer that is following is scrolled by the stick logic instead, so
    // only a paused one is touched here (otherwise the button would flash while streaming).
    const content = el.firstElementChild;
    const observer = content && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          if (!shouldStickToBottomRef.current) {
            setShowJumpToLatest(distanceFromSessionBottom(el) > NEAR_BOTTOM_DISTANCE);
          }
        })
      : null;
    if (content) observer?.observe(content);
    return () => {
      el.removeEventListener("scroll", updateStickiness);
      observer?.disconnect();
    };
  }, [sessionKey]);

  useEffect(() => {
    if (!targetSeq) {
      targetSeqScrollKeyRef.current = "";
      return;
    }
    const scrollKey = `${sessionKey || ""}:${targetSeq}:${targetSeqRequestKey}`;
    if (targetSeqScrollKeyRef.current === scrollKey) {
      return;
    }
    const container = scrollRef.current;
    if (!container || !timeline.length) {
      return;
    }
    const node = container.querySelector<HTMLElement>(
      `[data-session-seq="${targetSeq}"]`,
    );
    if (!node) {
      return;
    }
    targetSeqScrollKeyRef.current = scrollKey;
    shouldStickToBottomRef.current = false;
    cancelTargetSeqScroll();
    const scrollToNode = () => {
      const latestContainer = scrollRef.current;
      const latestNode = latestContainer?.querySelector<HTMLElement>(
        `[data-session-seq="${targetSeq}"]`,
      );
      if (!latestContainer || !latestNode) {
        return;
      }
      shouldStickToBottomRef.current = false;
      const nextTop = Math.max(
        0,
        latestNode.offsetTop -
          latestContainer.clientHeight / 2 +
          latestNode.offsetHeight / 2,
      );
      latestContainer.scrollTo({ top: nextTop, behavior: "auto" });
    };
    targetSeqFrameRef.current = window.requestAnimationFrame(() => {
      targetSeqFrameRef.current = window.requestAnimationFrame(() => {
        targetSeqFrameRef.current = null;
        scrollToNode();
      });
    });
    [80, 220, 480].forEach((delay) => {
      const timer = window.setTimeout(() => {
        targetSeqTimerRefs.current = targetSeqTimerRefs.current.filter(
          (item) => item !== timer,
        );
        if (targetSeqScrollKeyRef.current !== scrollKey) {
          return;
        }
        scrollToNode();
      }, delay);
      targetSeqTimerRefs.current.push(timer);
    });
  }, [sessionKey, targetSeq, targetSeqRequestKey, timeline]);

  const activeAskUserCallId = (() => {
    if (!isAwaiting) {
      return "";
    }
    for (let i = timeline.length - 1; i >= 0; i -= 1) {
      const item = timeline[i];
      if (item.type === "user_text" || item.type === "assistant_text") {
        return "";
      }
      if (item.type !== "tool") continue;
      const toolCall = item.toolCall || {};
      const kind = `${toolCall.kind || ""}`.toLowerCase();
      const status = `${toolCall.status || ""}`.toLowerCase();
      if (kind !== "ask_user") continue;
      if (
        status !== "running" &&
        status !== "pending" &&
        status !== "in_progress"
      ) {
        continue;
      }
      if (getAskUserQuestions(toolCall).length === 0) continue;
      return (
        toolCall.callId ||
        (typeof toolCall.meta?.toolUseId === "string"
          ? toolCall.meta.toolUseId
          : "")
      );
    }
    return "";
  })();
  const activePhoneAsk = phone && activityHost && activeAskUserCallId ? timeline.find(item =>
    item.type === "tool" && (item.toolCall.callId || item.toolCall.meta?.toolUseId) === activeAskUserCallId,
  ) : null;
  const phoneAskKey = activePhoneAsk ? `${rootId}::${sessionKey}::${activeAskUserCallId}` : "";

  if (!session) {
    return (
      <div
        style={{
          padding: "40px",
          textAlign: "center",
          color: "var(--text-secondary)",
        }}
      >
        {t("session.empty")}
      </div>
    );
  }

  const displayName =
    session.name ||
    session.purpose ||
    session.key ||
    session.session_key ||
    "Session";
  const hasVisibleTimeline = timeline.length > 0;
  const userMetaButtonStyle: React.CSSProperties = {
    width: "18px",
    height: "18px",
    border: "none",
    background: "transparent",
    padding: 0,
    margin: 0,
    color: "#2563eb",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 800,
    lineHeight: 1,
    opacity: 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "6px",
    flexShrink: 0,
  };

  const makePromptKey = (
    item: Extract<TimelineItem, { type: "user_text" | "assistant_text" }>,
  ): string =>
    `${item.id}\n${item.timestamp || ""}\n${item.content || ""}`;

  const renderTimelineItem = (
    item: TimelineItem,
    idx: number,
    spacing: string = "0",
  ) => {
    const timelineItemKey = item.id || `${item.type}-${idx}`;
    if (item.type === "thought") {
      return (
        <div key={timelineItemKey} style={{ marginTop: spacing }}>
          <ThinkingBlock content={item.content || ""} defaultExpanded={false} />
        </div>
      );
    }
    if (item.type === "tool") {
      const tc = item.toolCall || {};
      const isAskUser =
        `${tc.kind || ""}`.toLowerCase() === "ask_user" &&
        getAskUserQuestions(tc).length > 0;
      const isUserShell =
        `${tc.kind || ""}`.toLowerCase() === "execute" &&
        tc.meta?.source === "userShell";
      const toolUseId =
        tc.callId ||
        (typeof tc.meta?.toolUseId === "string" ? tc.meta.toolUseId : "");
      if (isAskUser && activePhoneAsk && toolUseId === activeAskUserCallId) return null;
      return (
        <div key={timelineItemKey} style={{ marginTop: spacing }}>
          {isAskUser ? (
            <AskUserQuestionCard
              toolCall={tc}
              rootId={rootId}
              sessionKey={sessionKey}
              agent={session?.agent}
              active={!!toolUseId && toolUseId === activeAskUserCallId}
              onAnswer={onAskUserAnswer}
            />
          ) : (
            <ToolCallCard
              kind={tc.kind}
              title={
                (tc as any).title ||
                (tc.meta && typeof tc.meta.title === "string"
                  ? (tc.meta.title as string)
                  : "")
              }
              localKey={item.id}
              callId={tc.callId || ""}
              status={tc.status || "running"}
              content={tc.content}
              result={formatToolCallFallbackResult(tc)}
              locations={tc.locations}
              meta={tc.meta}
              activity={tc.activity}
              agent={item.agent}
              sourceTurnKey={item.sourceTurnKey}
              rootPath={rootPath || undefined}
              rootId={rootId}
              sessionKey={sessionKey}
              defaultExpanded={isUserShell}
            />
          )}
        </div>
      );
    }
    if (item.type === "todo") {
      return (
        <div key={timelineItemKey} style={{ marginTop: spacing }}>
          <TodoUpdateCard todoUpdate={item.todoUpdate} />
        </div>
      );
    }
    if (item.type === "plan") {
      return (
        <div key={timelineItemKey} style={{ marginTop: spacing }}>
          <PlanUpdateCard content={item.planUpdate?.content || ""} rootId={rootId} />
        </div>
      );
    }
    if (item.type === "compact") {
      return (
        <div key={timelineItemKey} style={{ marginTop: spacing }}>
          <CompactNoticeCard
            status={item.compactNotice?.status}
            summary={item.compactNotice?.summary}
          />
        </div>
      );
    }
    if (item.type === "turn_diff") {
      return (
        <div key={timelineItemKey} style={{ marginTop: spacing, width: "100%", minWidth: 0 }}>
          <TurnDiffSummary update={item.turnDiff} rootId={rootId} sessionKey={sessionKey} />
        </div>
      );
    }
    const isUser = item.type === "user_text";
    const userMessageIndex = isUser ? userMessageIndexByTimelineIndex.get(idx) : undefined;
    const settingsNotice = isUser ? settingsNoticeByTimelineIndex.get(idx) : undefined;
    const next = idx + 1 < timeline.length ? timeline[idx + 1] : null;
    const hasFollowingAssistantFlow =
      !isUser && !!next && next.type !== "user_text" && next.type !== "turn_diff";
    const hideAssistantMeta =
      !isUser &&
      (hasFollowingAssistantFlow ||
        (isStreaming && idx === timeline.length - 1));
    const time = formatTime(item.timestamp, locale);
    const uploadAttachments = isUser
      ? extractUploadAttachments(item.content || "")
      : [];
    const imageAttachments = uploadAttachments.filter(
      (attachment) => attachment.isImage,
    );
    const displayContent = isUser
      ? stripImageAttachmentTokens(item.content || "")
      : item.content || "";
    const promptSaveContent = isUser
      ? stripUploadAttachmentTokens(item.content || "")
      : "";
    const promptKey = makePromptKey(item);
    const promptSaved = !!savedPromptKeys[promptKey];
    const copySucceeded = !!copiedMessageKeys[promptKey];
    const userMessageWidth =
      imageAttachments.length > 0 ? "min(320px, 100%)" : "auto";
    const hasRichUserAttachments = imageAttachments.length > 0;
    const assistantMarkdownContent = !isUser ? (item.content || "").trim() : "";
    const assistantExchangeMeta = !isUser
      ? formatAssistantExchangeMeta(item, agents, t("session.effortUnavailable"))
      : "";
    const assistantDurationLabel = !isUser
      ? formatSessionDuration(previousUserTimestamp(timeline, idx), item.timestamp)
      : "";
    const canForkAgentMessage = !isUser && Number(item.seq || 0) > 0 && !!onForkAgentMessage;
    return (
      <div
        key={timelineItemKey}
        data-session-seq={item.seq || undefined}
        data-user-message-index={userMessageIndex}
        style={{
          marginTop: spacing,
          alignSelf: isUser ? "flex-end" : "flex-start",
          width: isUser ? userMessageWidth : "100%",
          maxWidth: isUser ? "80%" : "100%",
          minWidth: 0,
          position: "relative",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {isUser ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              gap: "6px",
              width: userMessageWidth,
              maxWidth: "100%",
              minWidth: 0,
            }}
          >
            {settingsNotice ? (
              <div
                data-session-settings-change
                style={{
                  alignSelf: "flex-end",
                  maxWidth: "100%",
                  fontSize: "11px",
                  color: "var(--text-secondary)",
                  textAlign: "right",
                  overflowWrap: "anywhere",
                }}
              >
                {settingsNotice}
              </div>
            ) : null}
            {hasRichUserAttachments ? (
              <div
                style={{
                  width: "100%",
                  maxWidth: "100%",
                  minWidth: 0,
                  padding: "8px",
                  borderRadius: "18px 18px 4px 18px",
                  background: "rgba(148,163,184,0.14)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  boxSizing: "border-box",
                }}
              >
                {imageAttachments.length > 0 ? (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        imageAttachments.length > 1
                          ? "repeat(2, minmax(0, 1fr))"
                          : "minmax(0, 1fr)",
                      gap: "8px",
                      width: "100%",
                    }}
                  >
                    {imageAttachments.map((attachment) => (
                      <button
                        key={attachment.path}
                        type="button"
                        onClick={() =>
                          onFileClickRef.current?.({ path: attachment.path })
                        }
                        style={{
                          border: "none",
                          padding: 0,
                          background: "transparent",
                          cursor: "pointer",
                          borderRadius: "12px",
                          overflow: "hidden",
                        }}
                        title={attachment.name}
                      >
                        <AttachmentImage
                          rootId={rootId || ""}
                          path={attachment.path}
                          name={attachment.name}
                        />
                      </button>
                    ))}
                  </div>
                ) : null}
                {displayContent ? (
                  <div
                    style={{
                      padding:
                        imageAttachments.length > 0 ? "2px 6px 0" : "6px 8px",
                      color: "var(--text-primary)",
                      fontSize: "14px",
                      lineHeight: "1.5",
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                      wordBreak: "break-word",
                    }}
                  >
                    <InlineTokenText
                      content={displayContent}
                      isDark={false}
                      variant="inverse"
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
            {!hasRichUserAttachments && displayContent ? (
              <div
                style={{
                  padding: "10px 16px",
                  borderRadius: "18px 18px 4px 18px",
                  background: "rgba(148,163,184,0.14)",
                  color: "var(--text-primary)",
                  fontSize: "14px",
                  lineHeight: "1.5",
                  boxShadow: "none",
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                  alignSelf: "flex-end",
                  maxWidth: "100%",
                  minWidth: 0,
                }}
              >
                <InlineTokenText
                  content={displayContent}
                  isDark={false}
                  variant="inverse"
                />
              </div>
            ) : null}
            <span
              style={{
                fontSize: "10px",
                color: "var(--text-secondary)",
                opacity: 0.5,
                alignSelf: "flex-end",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              {item.pendingAck ? (
                <span
                  aria-label={t("session.sending")}
                  style={{
                    width: "8px",
                    height: "8px",
                    border: "1px solid var(--text-secondary)",
                    borderTopColor: "transparent",
                    borderRadius: "50%",
                    display: "inline-block",
                    animation: "spin 0.8s linear infinite",
                  }}
                />
              ) : null}
              <span>{time}</span>
              <button
                type="button"
                onClick={() => {
                  onEditUserMessage?.(item.content || "");
                }}
                style={userMetaButtonStyle}
                aria-label={t("session.editMessage")}
                title={t("session.editMessage")}
              >
                {renderToolIcon("edit")}
              </button>
              {promptSaved ? (
                <span
                  aria-label={t("session.promptSaved")}
                  title={t("session.promptSaved")}
                  style={{
                    ...userMetaButtonStyle,
                    color: "#2563eb",
                    fontSize: "13px",
                  }}
                >
                  ✓
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (!promptSaveContent) {
                      reportError(
                        "file.write_failed",
                        t("session.emptyPromptCannotSave"),
                      );
                      return;
                    }
                    void savePrompt(promptSaveContent)
                      .then(() => {
                        setSavedPromptKeys((prev) => ({
                          ...prev,
                          [promptKey]: true,
                        }));
                      })
                      .catch((err) => {
                        reportError(
                          "file.write_failed",
                          String((err as Error)?.message || t("session.savePromptFailed")),
                        );
                      });
                  }}
                  style={userMetaButtonStyle}
                  aria-label={t("session.addPrompt")}
                  title={t("session.addPrompt")}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                  >
                    <path
                      fill="currentColor"
                      stroke="currentColor"
                      strokeWidth="0.45"
                      strokeLinejoin="round"
                      d="M1.086 5.183A2.5 2.5 0 0 1 2.854 2.12l3.863-1.035A2.5 2.5 0 0 1 9.78 2.854L10.354 5H9.32l-.506-1.888a1.5 1.5 0 0 0-1.837-1.06L3.112 3.087a1.5 1.5 0 0 0-1.06 1.837l1.035 3.864a1.5 1.5 0 0 0 1.837 1.06L5 9.828v1.028a2.5 2.5 0 0 1-2.879-1.81zM8 6a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h5a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zM7 8a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1zm4 .5a.5.5 0 0 0-1 0V10H8.5a.5.5 0 0 0 0 1H10v1.5a.5.5 0 0 0 1 0V11h1.5a.5.5 0 0 0 0-1H11z"
                    />
                  </svg>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (!promptSaveContent) {
                    reportError("clipboard.write_failed", t("session.emptyMessageCannotCopy"));
                    return;
                  }
                  const markCopied = () => {
                    setCopiedMessageKeys((prev) => ({
                      ...prev,
                      [promptKey]: true,
                    }));
                    if (copyResetTimersRef.current[promptKey]) {
                      window.clearTimeout(copyResetTimersRef.current[promptKey]);
                    }
                    copyResetTimersRef.current[promptKey] = window.setTimeout(() => {
                      setCopiedMessageKeys((prev) => {
                        const next = { ...prev };
                        delete next[promptKey];
                        return next;
                      });
                      delete copyResetTimersRef.current[promptKey];
                    }, 1000);
                  };
                  void copyText(promptSaveContent)
                    .then(markCopied)
                    .catch((err) => {
                      reportError(
                        "clipboard.write_failed",
                        String((err as Error)?.message || t("session.copyFailed")),
                      );
                    });
                }}
                style={userMetaButtonStyle}
                aria-label={t("session.copyMessage")}
                title={t("session.copyMessage")}
              >
                {copySucceeded ? (
                  <span
                    aria-hidden="true"
                    style={{ fontSize: "13px", fontWeight: 800, lineHeight: 1 }}
                  >
                    ✓
                  </span>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      fill="currentColor"
                      d="M20 2H10c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2m0 12H10V4h10z"
                    />
                    <path
                      fill="currentColor"
                      d="M14 20H4V10h2V8H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-2h-2z"
                    />
                  </svg>
                )}
              </button>
            </span>
          </div>
        ) : (
          <div
            style={{
              width: "100%",
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
            }}
          >
            <div
              style={{
                color: "var(--text-primary)",
                fontSize: "15px",
                lineHeight: "1.7",
                width: "100%",
                minWidth: 0,
              }}
            >
              <MarkdownViewer
                content={item.content || ""}
                root={rootId || undefined}
                onFileClick={(path) => onFileClickRef.current?.({ path })}
              />
            </div>
            {!hideAssistantMeta && (
              <span
                className="mindfs-assistant-meta"
                style={{
                  alignSelf: "flex-start",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "10px",
                  color: "var(--text-secondary)",
                  opacity: 0.5,
                  marginTop: "-10px",
                  marginBottom: "4px",
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (!assistantMarkdownContent) {
                      reportError(
                        "clipboard.write_failed",
                        t("session.emptyMessageCannotCopy"),
                      );
                      return;
                    }
                    void copyText(assistantMarkdownContent)
                      .then(() => {
                        setCopiedMessageKeys((prev) => ({
                          ...prev,
                          [promptKey]: true,
                        }));
                        if (copyResetTimersRef.current[promptKey]) {
                          window.clearTimeout(
                            copyResetTimersRef.current[promptKey],
                          );
                        }
                        copyResetTimersRef.current[promptKey] =
                          window.setTimeout(() => {
                            setCopiedMessageKeys((prev) => {
                              const next = { ...prev };
                              delete next[promptKey];
                              return next;
                            });
                            delete copyResetTimersRef.current[promptKey];
                          }, 1000);
                      })
                      .catch((err) => {
                        reportError(
                          "clipboard.write_failed",
                          String((err as Error)?.message || t("session.copyFailed")),
                        );
                      });
                  }}
                  style={userMetaButtonStyle}
                  aria-label={t("session.copyMarkdown")}
                  title={t("session.copyMarkdown")}
                >
                  {copySucceeded ? (
                    <span
                      aria-hidden="true"
                      style={{
                        fontSize: "13px",
                        fontWeight: 800,
                        lineHeight: 1,
                      }}
                    >
                      ✓
                    </span>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        fill="currentColor"
                        d="M20 2H10c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2m0 12H10V4h10z"
                      />
                      <path
                        fill="currentColor"
                        d="M14 20H4V10h2V8H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-2h-2z"
                      />
                    </svg>
                  )}
                </button>
                {canForkAgentMessage ? (
                  <button
                    type="button"
                    onClick={() => {
                      const seq = Number(item.seq || 0);
                      if (seq > 0) {
                        void onForkAgentMessage?.(seq);
                      }
                    }}
                    style={userMetaButtonStyle}
                    aria-label={t("session.forkFromMessage")}
                    title={t("session.forkFromMessage")}
                  >
                    <ForkIcon />
                  </button>
                ) : null}
                <AgentIcon
                  agentName={item.agent || ""}
                  style={{ width: "12px", height: "12px" }}
                />
                {assistantExchangeMeta ? (
                  <span>{assistantExchangeMeta}</span>
                ) : null}
                <span>{time}{assistantDurationLabel ? ` ${assistantDurationLabel}` : ""}</span>
                {item.showContextWindow !== false ? <ReplyContext value={item.contextWindow} /> : null}
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderSlashCommandResult = () => {
    if (!slashCommandResult) {
      return null;
    }
    const commandLabel = `/${slashCommandResult.command || "status"}`;
    const loginNotice = slashCommandResult.loginNotice;
    const isLogin = (slashCommandResult.command || "") === "login";
    const content =
      slashCommandResult.error ||
      loginNotice?.error ||
      slashCommandResult.content ||
      (slashCommandResult.status === "running"
        ? isLogin
          ? t("session.loginWaiting")
          : t("session.statusFetching")
        : "");
    const loginCodeCopyKey = loginNotice?.loginId
      ? `login-code:${loginNotice.loginId}`
      : `login-code:${slashCommandResult.sessionKey}`;
    const loginCodeCopied = !!copiedMessageKeys[loginCodeCopyKey];
    return (
      <div
        style={{
          marginTop: hasVisibleTimeline ? "18px" : "0",
          width: "100%",
          boxSizing: "border-box",
          border: "1px solid rgba(148,163,184,0.36)",
          background: "rgba(148,163,184,0.10)",
          borderRadius: "8px",
          padding: "10px 12px",
          color: "var(--text-primary)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
            marginBottom: content ? "6px" : 0,
            fontSize: "11px",
            lineHeight: 1.4,
            color: "var(--text-secondary)",
          }}
        >
          <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }}>
            {commandLabel}
          </span>
          <span>
            {slashCommandResult.status === "running"
              ? t("session.statusRunning")
              : slashCommandResult.status === "failed"
                ? t("session.statusFailed")
                : t("session.statusComplete")}
          </span>
        </div>
        {isLogin && loginNotice?.userCode ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              fontSize: "13px",
              lineHeight: 1.5,
            }}
          >
            {loginNotice.verificationUrl ? (
              <a
                href={loginNotice.verificationUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--accent)", overflowWrap: "anywhere" }}
              >
                {loginNotice.verificationUrl}
              </a>
            ) : null}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                  fontSize: "20px",
                  letterSpacing: "0",
                  color: "var(--text-primary)",
                }}
              >
                {loginNotice.userCode}
              </span>
              <button
                type="button"
                onClick={() => {
                  const userCode = loginNotice.userCode || "";
                  if (!userCode) {
                    reportError("clipboard.write_failed", t("session.emptyCodeCannotCopy"));
                    return;
                  }
                  void copyText(userCode)
                    .then(() => {
                      setCopiedMessageKeys((prev) => ({
                        ...prev,
                        [loginCodeCopyKey]: true,
                      }));
                      if (copyResetTimersRef.current[loginCodeCopyKey]) {
                        window.clearTimeout(
                          copyResetTimersRef.current[loginCodeCopyKey],
                        );
                      }
                      copyResetTimersRef.current[loginCodeCopyKey] =
                        window.setTimeout(() => {
                          setCopiedMessageKeys((prev) => {
                            const next = { ...prev };
                            delete next[loginCodeCopyKey];
                            return next;
                          });
                          delete copyResetTimersRef.current[loginCodeCopyKey];
                        }, 1000);
                    })
                    .catch((err) => {
                      reportError(
                        "clipboard.write_failed",
                        String((err as Error)?.message || t("session.copyFailed")),
                      );
                    });
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "22px",
                  height: "22px",
                  border: "none",
                  background: "transparent",
                  color: "var(--text-secondary)",
                  borderRadius: "6px",
                  padding: 0,
                  cursor: "pointer",
                }}
                aria-label={loginCodeCopied ? t("session.codeCopied") : t("session.copyCode")}
                title={loginCodeCopied ? t("session.copied") : t("session.copyCode")}
              >
                {loginCodeCopied ? (
                  <span
                    aria-hidden="true"
                    style={{ fontSize: "13px", fontWeight: 800, lineHeight: 1 }}
                  >
                    ✓
                  </span>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      fill="currentColor"
                      d="M20 2H10c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2m0 12H10V4h10z"
                    />
                    <path
                      fill="currentColor"
                      d="M14 20H4V10h2V8H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-2h-2z"
                    />
                  </svg>
                )}
              </button>
            </div>
            {slashCommandResult.status === "complete" ? (
              <div style={{ color: "var(--text-secondary)" }}>
                {t("session.loginComplete")}
                {loginNotice.planType ? ` · ${loginNotice.planType}` : ""}
              </div>
            ) : null}
          </div>
        ) : content ? (
          <div
            style={{
              fontSize: "13px",
              lineHeight: "1.6",
              minWidth: 0,
              overflowWrap: "anywhere",
            }}
          >
            <MarkdownViewer
              content={content}
              root={rootId || undefined}
              onFileClick={(path) => onFileClickRef.current?.({ path })}
            />
          </div>
        ) : null}
      </div>
    );
  };

  const activity = <SessionActivity key={sessionKey} timeline={timeline} lastEventAt={lastEventAt} connected={connected} recoveryText={streamStatusText}
    active={isAwaiting || isStreaming || !!activePhoneAsk} rootId={rootId || undefined} sessionKey={sessionKey || undefined} rootPath={rootPath || undefined}
    onResolveQuestion={phoneAskKey ? () => setOpenPhoneAsk(phoneAskKey) : undefined} />;

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        background: "transparent",
      }}
    >
      {activePhoneAsk && activePhoneAsk.type === "tool" ? (
        <PhoneSheet key={phoneAskKey} title={t("remote.phone.wait")} open={openPhoneAsk === phoneAskKey} onClose={() => setOpenPhoneAsk("")}>
          <AskUserQuestionCard toolCall={activePhoneAsk.toolCall} rootId={rootId} sessionKey={sessionKey} agent={session?.agent}
            active phoneSheet onAnswer={onAskUserAnswer} onResolved={() => setOpenPhoneAsk("")} />
        </PhoneSheet>
      ) : null}
      {interactionMode === "drawer" || phone ? null : (
        <header
          data-idea-session-heading
          style={{
            height: "36px",
            padding: "0 16px",
            borderBottom: "1px solid var(--border-color)",
            display: "flex",
            alignItems: "center",
            background: "var(--mindfs-topbar-bg, transparent)",
            boxSizing: "border-box",
            zIndex: 10,
            flexShrink: 0,
            position: "relative",
          }}
        >
          <h1
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "14px",
              fontWeight: 600,
              margin: 0,
              minWidth: 0,
            }}
          >
            {rootId ? (
              <button
                type="button"
                onClick={() => onRootClick?.(rootId)}
                style={{
                  ...rootBadgeButtonStyle,
                  flexShrink: 0,
                  cursor: onRootClick ? "pointer" : "default",
                }}
              >
                {rootId}
              </button>
            ) : null}
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {displayName}
            </span>
          </h1>
        </header>
      )}

      {/* 滚动容器 */}
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, position: "relative" }}>
        <div ref={scrollRef} onPointerDownCapture={pauseForActivityReading} onFocusCapture={pauseForActivityReading} onWheelCapture={pauseForActivityReading} onTouchStartCapture={pauseForActivityReading} style={{ flex: 1, minHeight: 0, minWidth: 0, height: "100%", overflowY: "auto", overflowX: "hidden", position: "relative", WebkitOverflowScrolling: "touch" }}>
          <div style={{
            width: "100%",
            minWidth: 0,
            display: "block",
            padding: "24px 16px",
            boxSizing: "border-box",
            overflowX: "hidden",
          }} data-mindfs-session-content-width="1">
          <div style={{ width: "100%", minWidth: 0, margin: "0", display: "flex", flexDirection: "column" }}>
            {loading && !hasVisibleTimeline ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  padding: "6px 0 8px",
                }}
              >
                {[0, 1, 2].map((index) => (
                  <div
                    key={index}
                    style={{
                      width: index === 1 ? "78%" : index === 2 ? "64%" : "52%",
                      height: index === 0 ? "18px" : "72px",
                      alignSelf:
                        index === 0
                          ? "flex-start"
                          : index === 1
                            ? "flex-end"
                            : "flex-start",
                      borderRadius: index === 0 ? "8px" : "18px",
                      background:
                        "linear-gradient(90deg, rgba(148,163,184,0.12) 0%, rgba(148,163,184,0.24) 50%, rgba(148,163,184,0.12) 100%)",
                      backgroundSize: "200% 100%",
                      animation:
                        "sessionLoadingPulse 1.1s ease-in-out infinite",
                    }}
                  />
                ))}
              </div>
            ) : null}
            <ActivityTimeline timeline={timeline} rootId={rootId || ""} sessionKey={sessionKey || ""}
              rootPath={rootPath || undefined} tailClosed={Boolean(slashCommandResult) || (!loading && !isAwaiting && !isStreaming)}
              renderItem={renderTimelineItem} itemSpacing={timelineItemSpacing} />
            {renderSlashCommandResult()}
            {phone && activityHost ? createPortal(activity, activityHost) : activity}
            {session && rootId ? <SessionRecovery key={`${rootId}:${sessionKey}`} session={session} rootId={rootId}
              connected={connected} active={loading || isAwaiting || isStreaming} /> : null}
            <div ref={scrollEndRef} style={{ height: "1px" }} />
          </div>
          </div>
        </div>
        {showJumpToLatest ? (
          <div
            style={{
              position: "absolute",
              right: "16px",
              bottom: "16px",
              zIndex: 4,
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <button
                type="button"
                onClick={() => {
                  cancelTargetSeqScroll();
                  if (targetSeq) {
                    targetSeqScrollKeyRef.current = `${sessionKey || ""}:${targetSeq}:${targetSeqRequestKey}`;
                  }
                  readingActivityRef.current = false;
                  shouldStickToBottomRef.current = true;
                  setShowJumpToLatest(false);
                  stickSessionToBottom("smooth");
                }}
                aria-label={t("session.jumpLatest")}
                title={t("session.jumpLatest")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  height: "34px",
                  border: "1px solid rgba(37,99,235,0.35)",
                  background: "#2563eb",
                  color: "#ffffff",
                  borderRadius: "999px",
                  padding: "0 12px",
                  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.14)",
                  cursor: "pointer",
                  fontSize: "12px",
                  whiteSpace: "nowrap",
                }}
              >
                <span>{t("session.jumpBottom")}</span>
            </button>
          </div>
        ) : null}
      </div>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes sessionLoadingPulse {
          0% { background-position: 100% 0; opacity: 0.7; }
          50% { opacity: 1; }
          100% { background-position: -100% 0; opacity: 0.7; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export const SessionViewer = memo(
  SessionViewerInner,
  (prev, next) =>
    prev.phone === next.phone &&
    prev.session === next.session &&
    prev.connected === next.connected &&
    prev.loading === next.loading &&
    prev.rootId === next.rootId &&
    prev.rootPath === next.rootPath &&
    prev.interactionMode === next.interactionMode &&
    prev.targetSeq === next.targetSeq &&
    prev.targetSeqRequestKey === next.targetSeqRequestKey &&
    prev.onRootClick === next.onRootClick,
);
