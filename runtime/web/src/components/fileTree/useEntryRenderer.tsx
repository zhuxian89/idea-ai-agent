import { type FileEntry, sortDirectoryEntries } from "../../services/directorySort";
import React from "react";
import { PROJECT_TREE_ROOT_PADDING_LEFT, PROJECT_TREE_INDENT } from "../fileTreeModel";
import { DirectoryIconSlot } from "../FileTreeIcons";
import type { useFileTreeMenus } from "./useFileTreeMenus";
import type { useProjectTreeTab } from "./useProjectTreeTab";
import type { FileTreeProps } from "../fileTreeModel";

type Deps = {
  fileTreeMenusApi: ReturnType<typeof useFileTreeMenus>;
  projectTreeTabApi: ReturnType<typeof useProjectTreeTab>;
  props: Pick<FileTreeProps, "activeSessionKey" | "childrenByPath" | "expanded" | "onSelectFile" | "onSelectRoot" | "onToggleDir" | "renderRootExtraContent" | "renderRootWorktreeContent" | "rootId" | "selectedDirKey" | "selectedPath" | "sortMode"> & Required<Pick<FileTreeProps, "fileMetas" | "rootSessionIndicators" | "showHiddenFiles">>;
};

export function useEntryRenderer({ fileTreeMenusApi, projectTreeTabApi, props }: Deps) {
  const { t } = fileTreeMenusApi;
  const { projectTreeTab } = projectTreeTabApi;
  const { activeSessionKey, childrenByPath, expanded, fileMetas, onSelectFile, onSelectRoot, onToggleDir, renderRootExtraContent, renderRootWorktreeContent, rootId, rootSessionIndicators, selectedDirKey, selectedPath, showHiddenFiles, sortMode } = props;

  const expandedSet = new Set(expanded);
  const childKeyFor = (entry: FileEntry, entryRoot: string) => {
    if (entry.is_root) return `${entry.path}:.`;
    return `${entryRoot}:${entry.path}`;
  };
  const visibleEntries = React.useCallback((items: FileEntry[]) => {
    return showHiddenFiles
      ? items
      : items.filter((entry) => !entry.name.startsWith("."));
  }, [showHiddenFiles]);
  const renderEntries = (items: FileEntry[], depth: number, branchRoot: string) => (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>

      {sortDirectoryEntries(visibleEntries(items), sortMode).map((entry) => {
        const isManagedRootNode = entry.is_root === true;
        const entryRoot = isManagedRootNode ? entry.path : branchRoot;
        const expandedKey = isManagedRootNode ? entry.path : `${entryRoot}:${entry.path}`;
        const isOpen = expandedSet.has(expandedKey);

        const cKey = childKeyFor(entry, entryRoot);
        const children = childrenByPath[cKey] ?? [];

        const isCurrentRootNode = isManagedRootNode && entry.path === rootId;
        // 普通目录沿用 selectedDirKey；当前 managed root 永远跟随 current root 高亮。
        const isSelected =
          entry.is_dir
            ? isCurrentRootNode || selectedDirKey === expandedKey
            : entry.path === selectedPath && entryRoot === rootId;

        const meta = fileMetas[entry.path];
        const hasSessionLink = !entry.is_dir && meta?.source_session;
        const isFromActiveSession = hasSessionLink && meta.source_session === activeSessionKey;
        const rootIndicator = isManagedRootNode
          ? rootSessionIndicators[entry.path] || {}
          : null;
        const showRootIndicator = !!rootIndicator?.bound;
        const isRootPending = !!rootIndicator?.pending;
        const handleEntryClick = () => {
          if (entry.is_dir) {
            if (isManagedRootNode) {
              (onSelectRoot || onToggleDir)?.(entry, entryRoot);
              return;
            }
            onToggleDir?.(entry, entryRoot);
            return;
          }
          onSelectFile?.(entry, entryRoot);
        };
        const handleDirectoryIconClick = (event: React.MouseEvent<HTMLSpanElement>) => {
          if (!entry.is_dir) {
            return;
          }
          event.stopPropagation();
          onToggleDir?.(entry, entryRoot);
        };

        const rootExtraContent = isManagedRootNode
          ? projectTreeTab === "git"
            ? renderRootExtraContent?.(entry.path)
            : projectTreeTab === "worktrees"
              ? renderRootWorktreeContent?.(entry.path)
              : null
          : null;
        const shouldRenderChildren = projectTreeTab === "files" || !isManagedRootNode;

        return (
          <li key={expandedKey}>
            <button
              type="button"
              onClick={handleEntryClick}
              style={{
                border: "none",
                background: isSelected ? "var(--selection-bg)" : "transparent",
                cursor: "pointer",
                padding: "6px 8px",
                paddingLeft: PROJECT_TREE_ROOT_PADDING_LEFT + depth * PROJECT_TREE_INDENT,
                display: "flex",
                alignItems: "center",
                gap: "4px",
                width: "100%",
                textAlign: "left",
                color: isSelected ? "var(--accent-hover)" : "var(--text-primary)",
                fontSize: isManagedRootNode ? "14px" : "13px",
                borderRadius: "6px",
                transition: "all 0.1s",
                fontWeight: isSelected || isManagedRootNode ? 600 : 400,
                outline: "none",
              }}
              onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--menu-active-bg)"; }}
              onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
            >
              <span
                onClick={handleDirectoryIconClick}
                title={entry.is_dir ? (isOpen ? t("common.collapse") : t("common.expand")) : undefined}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "4px",
                  cursor: entry.is_dir ? "pointer" : "default",
                }}
              >
                <DirectoryIconSlot entry={entry} isOpen={isOpen} />
              </span>
              <span
                style={{
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  flex: 1,
                  marginLeft: "4px",
                }}
              >
                <span
                  style={{
                    ...(isManagedRootNode ? { fontWeight: isSelected ? 600 : 500 } : {}),
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {entry.name}
                </span>
              </span>
              {showRootIndicator ? (
                <span
                  aria-label={isRootPending ? t("fileTree.boundSessionReplying") : t("fileTree.boundSession")}
                  title={isRootPending ? t("fileTree.boundSessionReplying") : t("fileTree.boundSession")}
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "999px",
                    flexShrink: 0,
                    boxSizing: "border-box",
                    border: "1.5px solid #2563eb",
                    background: isRootPending ? "#2563eb" : "transparent",
                    animation: isRootPending ? "mindfs-bound-pulse 2.2s ease-in-out infinite" : "none",
                    boxShadow: isRootPending
                      ? "0 0 0 1.5px rgba(37,99,235,0.14)"
                      : "0 0 0 1px rgba(37,99,235,0.10)",
                  }}
                />
              ) : null}
              {hasSessionLink && (
                <span style={{ fontSize: "10px", color: isFromActiveSession ? "#3b82f6" : "#9ca3af" }}>
                  {isFromActiveSession ? "◆" : "◇"}
                </span>
              )}
            </button>
            {entry.is_dir && isOpen && shouldRenderChildren && children.length > 0 ? renderEntries(children, depth + 1, entryRoot) : null}
            {entry.is_dir && isOpen && rootExtraContent ? (
              <div style={{ padding: `2px 4px 8px ${PROJECT_TREE_INDENT}px` }}>
                {rootExtraContent}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );

  return { renderEntries };
}
