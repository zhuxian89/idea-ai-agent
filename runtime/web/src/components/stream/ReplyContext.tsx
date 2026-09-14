import React from "react";
import { useI18n } from "../../i18n";

export function ReplyContext({ value }: {
  value?: { totalTokens: number; modelContextWindow: number };
}) {
  const { t } = useI18n();
  if (!value || !Number.isFinite(value.totalTokens) || value.totalTokens < 0 ||
      !Number.isFinite(value.modelContextWindow) || value.modelContextWindow <= 0) {
    return <span className="idea-reply-context" title={t("session.contextUnavailableHint")}>{t("session.contextUnavailable")}</span>;
  }
  const percent = Math.round(value.totalTokens / value.modelContextWindow * 100);
  const compact = (count: number) => count >= 1_000_000 ? `${Math.round(count / 100_000) / 10}M`
    : count >= 1_000 ? `${Math.round(count / 1_000)}K` : String(count);
  return <span className="idea-reply-context" data-level={percent >= 90 ? "high" : percent >= 75 ? "medium" : "normal"}
    title={t("session.contextUsage", { percent, used: value.totalTokens, capacity: value.modelContextWindow })}>
    {`Context ${percent}% (${compact(value.totalTokens)}/${compact(value.modelContextWindow)})`}
  </span>;
}
