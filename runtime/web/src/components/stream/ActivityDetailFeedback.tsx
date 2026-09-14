import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { copyText } from "../../services/clipboard";
import type { ActivityDetailResult } from "../../services/activityDetails";
import "./ActivityDetailFeedback.css";

function CopyDetailButton({ text, label }: { text: string; label: string }) {
  const { t } = useI18n();
  const [feedback, setFeedback] = useState<"" | "session.copied" | "session.copyFailed">("");
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(timer.current); };
  }, []);
  return <span className="activity-detail-copy">
    <button type="button" onClick={async event => {
      const button = event.currentTarget;
      // Restore focus only if the clipboard fallback displaced it. A user who
      // moved elsewhere while the bridge was pending keeps their new focus.
      let message: "session.copied" | "session.copyFailed" = "session.copied";
      try { await copyText(text); } catch { message = "session.copyFailed"; }
      if (!mounted.current) return;
      if (document.activeElement === document.body) button.focus({ preventScroll: true });
      setFeedback(message);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setFeedback(""), 2500);
    }}>{label}</button>
    <span role="status">{feedback ? t(feedback) : ""}</span>
  </span>;
}

export function ActivityDetailFeedback({ result, loading, onRetry, command, output }: {
  result?: ActivityDetailResult; loading: boolean; onRetry: () => void; command?: string; output?: string;
}) {
  const { t } = useI18n();
  const error = result?.kind === "missing" ? "toolActivity.detailsMissing"
    : result?.kind === "unavailable" ? (result.retryable ? "toolActivity.detailsUnavailable" : "toolActivity.detailsRestricted") : "";
  const canRetry = result?.kind === "missing" || (result?.kind === "unavailable" && result.retryable);
  return <div className="activity-detail-feedback">
    {(loading || error) && <div className="activity-detail-notice">
      <span role="status">{t(loading ? "common.loading" : error || "common.loading")}</span>
      {canRetry && <button type="button" aria-disabled={loading} onClick={() => { if (!loading) onRetry(); }}>{t("common.retry")}</button>}
    </div>}
    {(command || output) && <div className="activity-detail-actions">
      {command && <CopyDetailButton text={command} label={t("toolActivity.copyCommand")} />}
      {output && <CopyDetailButton text={output} label={t("toolActivity.copyOutput")} />}
    </div>}
  </div>;
}
