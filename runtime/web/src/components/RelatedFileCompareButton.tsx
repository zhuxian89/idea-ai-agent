import React from "react";
import { useI18n } from "../i18n";

type IdeaIconButtonProps = {
  label: string;
  title?: string;
  icon: "compare" | "open";
  onClick: () => void;
};

export function IdeaIconButton({ label, onClick, title, icon }: IdeaIconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title || label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      style={{
        width: "20px",
        height: "20px",
        border: "none",
        borderRadius: "5px",
        background: "transparent",
        color: "var(--text-secondary)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
        {icon === "compare" ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v18" />
            <path d="m6 7-3 3 3 3" />
            <path d="m18 11 3 3-3 3" />
            <path d="M3 10h6" />
            <path d="M15 14h6" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 3v5h5" />
          </svg>
        )}
    </button>
  );
}

export function RelatedFileCompareButton({ label, onClick, title }: {
  label?: string;
  title?: string;
  onClick: () => void;
}) {
  const { t } = useI18n();
  return (
    <IdeaIconButton
      label={label || t("session.compareRelatedFileWithHead")}
      title={title}
      icon="compare"
      onClick={onClick}
    />
  );
}
