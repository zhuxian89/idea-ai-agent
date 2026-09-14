import type { ReactNode } from "react";
import "./ToolActivityHeader.css";

type ToolActivityHeaderProps = {
  summary: string;
  statusLabel?: string;
  durationLabel?: string;
  kind: string;
  expanded: boolean;
  detailsId: string;
  onToggle?: () => void;
};

function ActivityIcon({ kind }: { kind: string }) {
  let shape: ReactNode;
  switch (kind) {
    case "execute":
      shape = <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m7 9 3 3-3 3m6 0h4" /></>;
      break;
    case "read":
      shape = <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8m-8 4h6" /></>;
      break;
    case "search":
    case "web_search":
      shape = <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>;
      break;
    case "fetch":
      shape = <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>;
      break;
    default:
      shape = <><rect x="3" y="3" width="6" height="6" rx="2" /><rect x="15" y="3" width="6" height="6" rx="2" /><rect x="3" y="15" width="6" height="6" rx="2" /><rect x="15" y="15" width="6" height="6" rx="2" /></>;
  }
  return <svg className="tool-activity-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shape}</svg>;
}

export function ToolActivityHeader({ summary, statusLabel, durationLabel, kind, expanded, detailsId, onToggle }: ToolActivityHeaderProps) {
  const content = <>
    <ActivityIcon kind={kind} />
    <span className="tool-activity-summary">{summary}</span>
    {statusLabel ? <span className="tool-activity-status">{statusLabel}</span> : null}
    {durationLabel ? <span className="tool-activity-duration">{durationLabel}</span> : null}
    {onToggle ? <svg className="tool-activity-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: expanded ? "rotate(90deg)" : undefined }}><path d="m9 6 6 6-6 6" /></svg> : null}
  </>;
  return onToggle ? (
    <button type="button" className="tool-activity-header" aria-expanded={expanded} aria-controls={expanded ? detailsId : undefined} onClick={onToggle}>
      {content}
    </button>
  ) : <div className="tool-activity-header">{content}</div>;
}
