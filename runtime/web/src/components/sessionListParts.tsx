import React from "react";
import { type SessionRow } from "./sessionHierarchy";
import { useI18n, type Locale } from "../i18n";
import { SessionItem } from "./sessionListTypes";

export const MULTI_PROJECT_VISIBLE_LIMIT = 6;

export const MAIN_SESSION_ICON_OFFSET = "2px";

export const PINNED_PROJECTS_STORAGE_KEY = "mindfs-pinned-session-projects";

export function ToggleRowButton({
  label,
  loading,
  marginLeft,
  showExpandIcon = false,
  showCollapseIcon = false,
  onClick,
  onCollapse,
}: {
  label: string;
  loading?: boolean;
  marginLeft: string;
  showExpandIcon?: boolean;
  showCollapseIcon?: boolean;
  onClick: () => void;
  onCollapse?: () => void;
}) {
  const { t } = useI18n();
  const icon = (rotate = false) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 16 16"
      aria-hidden="true"
      style={{
        width: "13px",
        height: "13px",
        flexShrink: 0,
        transform: rotate ? "rotate(180deg)" : "none",
      }}
    >
      <path d="M0 0h16v16H0z" fill="none" />
      <path fill="currentColor" d="M12.146 7.146a.5.5 0 0 1 .708.708l-4.5 4.5a.5.5 0 0 1-.708 0l-4.5-4.5a.5.5 0 1 1 .708-.708L8 11.293zm0-4a.5.5 0 0 1 .708.708l-4.5 4.5a.5.5 0 0 1-.708 0l-4.5-4.5a.5.5 0 1 1 .708-.708L8 7.293z" />
    </svg>
  );

  return (
    <button
      type="button"
      disabled={loading}
      onClick={onClick}
      style={{
        marginLeft,
        marginTop: "-2px",
        border: "none",
        background: "transparent",
        color: "var(--text-primary)",
        borderRadius: 0,
        padding: 0,
        minHeight: "13px",
        width: `calc(100% - ${marginLeft})`,
        boxSizing: "border-box",
        cursor: loading ? "default" : "pointer",
        fontSize: "11px",
        lineHeight: 1.1,
        textAlign: "center",
        opacity: loading ? 0.6 : 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px", minWidth: 0, flexShrink: 1 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        {showExpandIcon ? icon(false) : null}
        {showCollapseIcon ? (
          <span
            role="button"
            tabIndex={0}
            aria-label={t("common.collapse")}
            title={t("common.collapse")}
            onClick={(event) => {
              event.stopPropagation();
              onCollapse?.();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              onCollapse?.();
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: loading ? "default" : "pointer",
            }}
          >
            {icon(true)}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function Chevron({ expanded }: { expanded: boolean }) {
  return <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" style={{ transform: expanded ? "rotate(90deg)" : undefined }}><path d="m6 3 5 5-5 5" /></svg>;
}

export function ChildGroupRow({ row, loading, onClick }: { row: Exclude<SessionRow, { type: "session" }>; loading: boolean; onClick: () => void }) {
  const { t } = useI18n();
  const group = row.type === "child-group";
  return <button type="button" className="workspace-child-group" style={{ marginLeft: `${row.depth * 12 + 8}px` }}
    aria-expanded={group ? row.expanded : undefined} disabled={loading} onClick={onClick}>
    {group ? <Chevron expanded={row.expanded} /> : null}
    {loading ? t("sessionList.loading") : group ? t(row.group === "running" ? "sessionList.runningChildren" : "sessionList.endedChildren", { count: row.count }) : t("sessionList.loadMoreChildren")}
  </button>;
}

export function PinIcon({ pinned }: { pinned: boolean }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="m16.219 4.838l2.964 2.967c2.012 2.014 3.018 3.021 2.784 4.107c-.235 1.085-1.567 1.585-4.23 2.586l-1.845.693c-.713.268-1.07.402-1.345.64q-.181.158-.322.352c-.212.297-.313.664-.515 1.4c-.46 1.672-.69 2.508-1.239 2.821c-.23.132-.492.2-.758.2c-.63 0-1.243-.614-2.469-1.84l-1.466-1.468l-1.079-1.08L5.285 14.8c-1.218-1.219-1.827-1.828-1.83-2.455a1.53 1.53 0 0 1 .203-.773c.313-.543 1.143-.772 2.803-1.23c.737-.203 1.105-.304 1.402-.517q.199-.144.36-.332c.236-.278.368-.637.63-1.355l.669-1.823c.987-2.693 1.48-4.04 2.568-4.28s2.102.774 4.129 2.803"
        clipRule="evenodd"
        opacity={pinned ? 1 : 0.5}
      />
      <path fill="currentColor" d="m3.302 21.776l4.476-4.48l-1.079-1.08l-4.476 4.48a.764.764 0 0 0 1.08 1.08" />
    </svg>
  );
}

export function shellBadgeLabel(shell?: string): string {
  const normalized = String(shell || "").trim().replace(/\\/g, "/");
  const base = (normalized.split("/").filter(Boolean).pop() || normalized || "sh").toLowerCase();
  if (base === "powershell.exe") return "ps";
  if (base === "pwsh.exe") return "pwsh";
  if (base === "cmd.exe") return "cmd";
  if (base.endsWith(".exe")) return base.slice(0, -4);
  return base;
}

export type ForkSessionSource = {
  sessionKey: string;
  seq: number;
};

export function parseForkSessionSource(source?: string): ForkSessionSource | null {
  const value = String(source || "").trim();
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as {
      type?: unknown;
      session_key?: unknown;
      seq?: unknown;
    };
    if (parsed?.type !== "fork") return null;
    return {
      sessionKey: String(parsed.session_key || "").trim(),
      seq: Number(parsed.seq || 0),
    };
  } catch {
    if (!value.includes('"type":"fork"') && !value.includes('"type": "fork"')) {
      return null;
    }
    return { sessionKey: "", seq: 0 };
  }
}

export function forkSessionDisplayName(
  storedName: string,
  source: ForkSessionSource | null,
  sessionByKey: Map<string, SessionItem>,
  rootId?: string,
): string {
  if (!source) return storedName;
  const parentName = String(
    sessionByKey.get(rootId ? `${rootId}:${source.sessionKey}` : source.sessionKey)?.name ||
      sessionByKey.get(source.sessionKey)?.name ||
      "",
  ).trim();
  const fallbackName = storedName.replace(/\s+fork\s+@\d+\s*$/i, "").trim();
  const base = parentName || fallbackName || storedName;
  return source.seq > 0 ? `${base}#${source.seq}` : base;
}

export function isSessionSyncing(
  session: SessionItem,
  syncingSessionKeys?: Set<string>,
): boolean {
  if (!syncingSessionKeys || syncingSessionKeys.size === 0) {
    return false;
  }
  const key = session.key || session.session_key || "";
  if (!key) {
    return false;
  }
  const rootId = session.root_id || "";
  return (
    syncingSessionKeys.has(key) ||
    (!!rootId && syncingSessionKeys.has(`${rootId}::${key}`))
  );
}

export function formatTime(isoString: string, locale: Locale, justNow: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 60000) return justNow;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  if (now.getFullYear() === date.getFullYear()) {
    return new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" }).format(date);
  }
  return new Intl.DateTimeFormat(locale, { year: "2-digit", month: "numeric" }).format(date);
}

export function renderHighlightedText(
  text: string,
  query?: string,
  palette?: { color?: string },
): React.ReactNode {
  const source = String(text || "");
  const needle = String(query || "").trim();
  if (!source || !needle) {
    return source;
  }
  const lowerSource = source.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (;;) {
    const index = lowerSource.indexOf(lowerNeedle, cursor);
    if (index < 0) {
      break;
    }
    if (index > cursor) {
      parts.push(source.slice(cursor, index));
    }
    const match = source.slice(index, index + needle.length);
    parts.push(
      <mark
        key={`${index}:${match}`}
        style={{
          background: "transparent",
          color: "var(--accent-color)",
          padding: 0,
        }}
      >
        {match}
      </mark>,
    );
    cursor = index + needle.length;
  }

  if (cursor < source.length) {
    parts.push(source.slice(cursor));
  }
  return parts.length ? parts : source;
}

export function iconButtonStyle(withGap: boolean): React.CSSProperties {
  return {
    border: "none",
    background: "transparent",
    color: "var(--text-secondary)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: withGap ? "2px" : 0,
    height: "28px",
    minWidth: "28px",
    borderRadius: "8px",
    cursor: "pointer",
    padding: withGap ? "0 6px" : 0,
  };
}

export function ChevronLeftIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function SubSessionIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 32 32"
      aria-hidden="true"
      style={{ color: "var(--accent-color)", display: "block" }}
    >
      <path d="M0 0h32v32H0z" fill="none" />
      <path
        fill="currentColor"
        d="M23 20c-2.41 0-4.43 1.72-4.9 4H14c-2.21 0-4-1.79-4-4v-8.1A5 5 0 1 0 4 7c0 2.41 1.72 4.43 4 4.9V20c0 3.31 2.69 6 6 6h4.1a5 5 0 1 0 4.9-6M6 7c0-1.65 1.35-3 3-3s3 1.35 3 3s-1.35 3-3 3s-3-1.35-3-3"
      />
    </svg>
  );
}

export function ForkSessionIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{
        color: "var(--accent-color)",
        display: "block",
        transform: "rotate(180deg) scaleX(-1)",
      }}
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
        d="M17 7a2 2 0 1 0 0-4a2 2 0 0 0 0 4M7 7a2 2 0 1 0 0-4a2 2 0 0 0 0 4m0 14a2 2 0 1 0 0-4a2 2 0 0 0 0 4M7 7v10M17 7v1c0 2.5-2 3-2 3l-6 2s-2 .5-2 3v1"
      />
      <circle cx="17" cy="5" r="2" fill="currentColor" />
    </svg>
  );
}

export const inlineActionStyle: React.CSSProperties = {
  width: "24px",
  height: "24px",
  border: "none",
  borderRadius: "6px",
  background: "transparent",
  color: "var(--text-secondary)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
};
