import type { useFileTreeMenus } from "./useFileTreeMenus";
import type { FileTreeProps } from "../fileTreeModel";

type Deps = {
  fileTreeMenusApi: ReturnType<typeof useFileTreeMenus>;
  props: Pick<FileTreeProps, "onUpdateAction"> & Required<Pick<FileTreeProps, "updateActionBusy" | "updateActionDisabled" | "updateActionHelp" | "updateActionLabel" | "updateActionSummary">>;
};

export function FileTreeUpdateNotes({ fileTreeMenusApi, props }: Deps) {
  const { isUpdateNotesOpen, setIsUpdateNotesOpen, t, updateNotesRef } = fileTreeMenusApi;
  const { onUpdateAction, updateActionBusy, updateActionDisabled, updateActionHelp, updateActionLabel, updateActionSummary } = props;
  return (
    updateActionLabel ? (
        <div ref={updateNotesRef} style={{ position: "relative" }}>
          {isUpdateNotesOpen && updateActionSummary ? (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "calc(100% + 8px)",
                border: "1px solid var(--border-color)",
                background: "var(--panel-bg)",
                borderRadius: "12px",
                padding: "12px",
                boxShadow: "0 18px 36px rgba(15, 23, 42, 0.18)",
                fontSize: "11px",
                color: "var(--text-secondary)",
                lineHeight: 1.55,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: "220px",
                overflow: "auto",
                zIndex: 10,
              }}
            >
              {updateActionSummary}
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              alignItems: "stretch",
              width: "100%",
              border: "1px solid var(--border-color)",
              background: updateActionDisabled ? "rgba(148, 163, 184, 0.2)" : "var(--accent-color)",
              color: updateActionDisabled ? "var(--text-secondary)" : "#fff",
              borderRadius: "10px",
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              disabled={updateActionDisabled}
              onClick={() => onUpdateAction?.()}
              title={updateActionHelp || undefined}
              style={{
                flex: 1,
                border: "none",
                background: "transparent",
                color: "inherit",
                padding: "10px 12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                cursor: updateActionDisabled ? "not-allowed" : "pointer",
                fontSize: "12px",
                fontWeight: 600,
              }}
            >
              {updateActionBusy ? (
                <span
                  style={{
                    width: "12px",
                    height: "12px",
                    borderRadius: "50%",
                    border: "2px solid currentColor",
                    borderRightColor: "transparent",
                    display: "inline-block",
                    animation: "mindfs-update-spin 0.9s linear infinite",
                  }}
                />
              ) : null}
              <span>{updateActionLabel}</span>
            </button>
            {updateActionSummary ? (
              <button
                type="button"
                aria-label={isUpdateNotesOpen ? t("fileTree.hideUpdateNotes") : t("fileTree.showUpdateNotes")}
                aria-expanded={isUpdateNotesOpen}
                onClick={() => setIsUpdateNotesOpen((open) => !open)}
                style={{
                  width: "34px",
                  border: "none",
                  background: "transparent",
                  color: "inherit",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    transform: isUpdateNotesOpen ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.15s ease",
                  }}
                >
                  <polyline points="6 15 12 9 18 15" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>
      ) : null
  );
}
