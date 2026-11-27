import { useContext, useEffect, useRef, useState } from "react";
import { PhoneSessionFactsContext } from "./remoteui/phoneSessionFacts";
import { ActivityEmoji } from "./ActivityEmoji";
import { SessionMenu, type SessionMenuActions } from "./SessionMenu";
import { AgentIcon } from "./AgentIcon";
import { ModeIcon } from "./ModeIcon";
import { useI18n } from "../i18n";
import { remoteUiActive } from "../services/remoteUiFlag";
import { agentDisplayName } from "../services/agentSetup";
import { SessionItem } from "./sessionListTypes";
import {
  shellBadgeLabel,
  parseForkSessionSource,
  forkSessionDisplayName,
  formatTime,
  renderHighlightedText,
  SubSessionIcon,
  ForkSessionIcon,
  inlineActionStyle,
} from "./sessionListParts";

export function SessionCard({
  session,
  sessionByKey,
  selected,
  parentHighlighted,
  highlightQuery,
  syncing = false,
  depth = 0,
  onSelect,
  onSync,
  onPin,
  onRename,
  onDelete,
  onScheduledTask,
  onHandoffPack,
}: SessionMenuActions & {
  session: SessionItem;
  sessionByKey: Map<string, SessionItem>;
  selected: boolean;
  parentHighlighted?: boolean;
  highlightQuery?: string;
  syncing?: boolean;
  depth?: number;
  onSelect?: (session: SessionItem) => void;
  onSync?: (session: SessionItem) => Promise<void> | void;
  onPin?: (session: SessionItem, pinned: boolean) => Promise<boolean> | boolean;
  onRename?: (session: SessionItem, nextName: string) => Promise<boolean> | boolean;
  onDelete?: (session: SessionItem) => void;
}) {
  const { locale, t } = useI18n();
  const isClosed = !!session.closed_at;
  const isPinned = !!session.pinned_at;
  const isSubagent = !!session.parent_session_key;
  const factsForCard = useContext(PhoneSessionFactsContext);
  const phoneFacts = isSubagent ? undefined : factsForCard?.(session);
  const forkSource = parseForkSessionSource(session.source);
  const isForkSession = !!forkSource;
  const storedName = session.name || `Session ${session.key.slice(0, 8)}`;
  const displayName = isForkSession
    ? forkSessionDisplayName(storedName, forkSource, sessionByKey, session.root_id)
    : storedName;
  const snippet = (session.search_snippet || "").trim();
  const isSearchResult = !!session.search_match_type;
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(storedName);
  const [saving, setSaving] = useState(false);
  const rowBackground = selected
    ? "var(--workspace-selected)"
    : parentHighlighted
      ? "var(--workspace-hover)"
      : "transparent";
  const inputRef = useRef<HTMLInputElement | null>(null);
  const composingRef = useRef(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!editing) {
      setDraftName(storedName);
    }
  }, [storedName, editing]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    if (!input) return;
    const atEnd = input.selectionStart === input.value.length;
    if (atEnd) {
      input.scrollLeft = input.scrollWidth;
    }
  }, [draftName, editing]);

  const cancelEditing = () => {
    setEditing(false);
    setSaving(false);
    setDraftName(storedName);
  };

  const submitRename = async () => {
    if (submittingRef.current) return;
    const trimmed = draftName.trim();
    if (!trimmed) {
      cancelEditing();
      return;
    }
    if (trimmed === storedName.trim()) {
      cancelEditing();
      return;
    }
    if (!onRename) {
      cancelEditing();
      return;
    }
    submittingRef.current = true;
    setSaving(true);
    try {
      const ok = await onRename(session, trimmed);
      if (ok === false) {
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      setEditing(false);
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div
      className={`workspace-session-row${isSubagent ? " workspace-child-session" : ""}`}
      data-session-key={session.key} data-selected={selected} data-root-id={session.root_id}
      style={{
        background: rowBackground,
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 0,
        padding: "2px 0",
        borderRadius: "8px",
        position: "relative",
        paddingLeft: `${Math.max(depth, isSubagent ? 1 : 0) * 12 + 4}px`,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          textAlign: "left" as const,
          padding: editing ? "7px 0 7px 2px" : isSubagent ? "3px 4px 3px 2px" : "7px 4px 7px 2px",
          borderRadius: "8px",
          border: "1px solid transparent",
          background: "transparent",
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: isSubagent ? "3px" : "6px",
          transition: "all 0.15s ease",
        }}
      >
        {!isSearchResult ? (
          <span
            style={{
              position: "relative",
              width: "18px",
              height: "18px",
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {isSubagent ? (
              isForkSession ? (
                <ForkSessionIcon />
              ) : (
                session.pending ? <ActivityEmoji emoji="👀" /> : <SubSessionIcon />
              )
            ) : (
              isForkSession ? (
                <ForkSessionIcon />
              ) : (
                <ModeIcon type={session.task_id ? "task" : session.type || "chat"} size={16} />
              )
            )}
            {!isSubagent && session.type === "command" ? (
              <span
                title={session.shell || "shell"}
                style={{
                  position: "absolute",
                  right: "-8px",
                  bottom: "-4px",
                  minWidth: 0,
                  maxWidth: "26px",
                  height: "auto",
                  padding: "1px 3px",
                  borderRadius: "5px",
                  background: "#1d4ed8",
                  border: "none",
                  color: "#fff",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: "7px",
                  fontWeight: 700,
                  lineHeight: 1.1,
                  letterSpacing: 0,
                }}
              >
                {shellBadgeLabel(session.shell)}
              </span>
            ) : !isSubagent ? (
              <span
                style={{
                  position: "absolute",
                  right: "-2px",
                  bottom: "-2px",
                  width: "10px",
                  height: "10px",
                  borderRadius: "999px",
                  background: "var(--content-bg, #fff)",
                  border: "1px solid rgba(255,255,255,0.9)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                <AgentIcon
                  agentName={session.agent || ""}
                  style={{ width: "10px", height: "10px", display: "block" }}
                />
              </span>
            ) : null}

          </span>
        ) : null}

        {editing ? (
          <input
            ref={inputRef}
            value={draftName}
            disabled={saving}
            onChange={(e) => {
              setDraftName(e.target.value);
              e.currentTarget.scrollLeft = e.currentTarget.scrollWidth;
            }}
            onClick={(e) => e.stopPropagation()}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.preventDefault();
                cancelEditing();
                return;
              }
              if (e.key !== "Enter") {
                return;
              }
              const nativeEvent = e.nativeEvent as KeyboardEvent;
              const isComposing =
                composingRef.current ||
                nativeEvent.isComposing ||
                nativeEvent.keyCode === 229;
              if (isComposing) {
                return;
              }
              e.preventDefault();
              void submitRename();
            }}
            style={{
              minWidth: 0,
              flex: 1,
              height: "28px",
              borderRadius: "6px",
              border: "1px solid var(--accent-color)",
              background: "var(--content-bg, #fff)",
              color: "var(--text-primary)",
              fontSize: "13px",
              fontWeight: 600,
              padding: "0 10px 0 8px",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => onSelect?.(session)}
            style={{
              minWidth: 0,
              flex: 1,
              border: "none",
              background: "transparent",
              padding: 0,
              cursor: "pointer",
              textAlign: "left",
              color: selected ? "var(--accent-hover)" : "var(--text-primary)",
            }}

          >
            <span
              style={{
                display: "block",
                fontSize: isSubagent ? "12px" : "13px",
                lineHeight: isSubagent ? 1.3 : 1.45,
                fontWeight: selected ? 600 : 500,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {renderHighlightedText(displayName, highlightQuery, {
                color: selected ? "var(--accent-hover)" : "var(--text-primary)",
              })}
            </span>
            <span className="idea-session-agent" style={{ display: isSubagent ? "block" : "none", fontSize: "11px", lineHeight: 1.3, color: "var(--text-secondary)", marginTop: "2px" }}>{session.agent ? agentDisplayName(session.agent) : session.type}</span>
            {snippet ? (
              <span
                style={{
                  marginTop: "2px",
                  display: "block",
                  fontSize: "11px",
                  lineHeight: 1.45,
                  color: "var(--text-secondary)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {renderHighlightedText(snippet, highlightQuery, {
                  color: "var(--text-secondary)",
                })}
              </span>
            ) : null}
            {phoneFacts && !snippet && phoneFacts.preview ? <span className="remote-phone-card-preview">{phoneFacts.preview}</span> : null}
            {phoneFacts ? <span className="remote-phone-card-meta">
              <span>{phoneFacts.project}</span>
              {phoneFacts.project ? <span aria-hidden="true">·</span> : null}
              <span>{t(`remote.phone.${phoneFacts.state}`)}</span>
            </span> : null}
          </button>
        )}

        {editing ? (
          <div
            style={{
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              gap: 0,
            }}
          >
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                void submitRename();
              }}
              disabled={saving}
              aria-label={t("sessionList.confirmRename")}
              style={{
                ...inlineActionStyle,
                width: "18px",
                color: "var(--accent-color)",
                opacity: saving ? 0.6 : 1,
                cursor: saving ? "default" : "pointer",
              }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                cancelEditing();
              }}
              disabled={saving}
              aria-label={t("sessionList.cancelRename")}
              style={{
                ...inlineActionStyle,
                width: "18px",
                opacity: saving ? 0.6 : 1,
                cursor: saving ? "default" : "pointer",
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ) : null}

      </div>

      {!editing ? (
        <div
          style={{
            flexShrink: 0,
            minWidth: "24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            paddingLeft: "2px",
          }}
        >
          {syncing ? (
            <span
              aria-label={t("sessionList.syncing")}
              title={t("sessionList.syncing")}
              style={{
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                border: "1.5px solid rgba(100,116,139,0.35)",
                borderTopColor: "var(--accent-color)",
                display: "inline-block",
                flexShrink: 0,
                animation: "spin 0.8s linear infinite",
              }}
            />
          ) : session.pending && !isSubagent ? (
            <>
            {remoteUiActive() && !phoneFacts ? <span className="session-replying-label">{t("sessionList.replying")}</span> : null}
            <span
              className="session-replying-dot"
              aria-label={t("sessionList.replying")}
              title={t("sessionList.replying")}
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "999px",
                flexShrink: 0,
                boxSizing: "border-box",
                border: "1.5px solid #2563eb",
                background: "#2563eb",
                animation: "mindfs-bound-pulse 2.2s ease-in-out infinite",
                boxShadow: "0 0 0 1.5px rgba(37,99,235,0.14)",
              }}
            />
            </>
          ) : (
            <span
              style={{
                fontSize: "11px",
                color: "var(--text-secondary)",
                whiteSpace: "nowrap",
                textAlign: "right",
              }}
            >
              {formatTime(
                isClosed && session.closed_at
                  ? session.closed_at
                  : session.updated_at || "",
                locale,
                t("time.justNow"),
              )}
            </span>
          )}
        </div>
      ) : null}

      <SessionMenu session={session} syncing={syncing} onPin={onPin} onSync={onSync} onDelete={onDelete}
        onScheduledTask={onScheduledTask} onHandoffPack={onHandoffPack}
        onRename={() => { setDraftName(storedName); setEditing(true); }} />
    </div>
  );
}
