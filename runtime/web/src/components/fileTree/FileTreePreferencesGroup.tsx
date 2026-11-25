import { PhoneMoreGroup } from "../remoteui/PhoneMoreHost";
import { DIRECTORY_SORT_OPTIONS, type DirectorySortMode } from "../../services/directorySort";
import { ChevronRight } from "../FileTreeIcons";
import { updateNewProjectMetaLocationPreference } from "../../services/preferences";
import type { useFileTreeMenuBehavior } from "./useFileTreeMenuBehavior";
import type { useFileTreeMenus } from "./useFileTreeMenus";
import type { useFileTreePreferenceState } from "./useFileTreePreferenceState";
import type { FileTreeProps } from "../fileTreeModel";

type Deps = {
  fileTreeMenuBehaviorApi: ReturnType<typeof useFileTreeMenuBehavior>;
  fileTreeMenusApi: ReturnType<typeof useFileTreeMenus>;
  fileTreePreferenceStateApi: ReturnType<typeof useFileTreePreferenceState>;
  props: Pick<FileTreeProps, "onGitDiffSideBySideChange" | "onMultiProjectSessionsChange" | "onShowHiddenFilesChange" | "onSidebarsSwappedChange" | "onSortModeChange" | "sortMode"> & Required<Pick<FileTreeProps, "gitDiffSideBySide" | "multiProjectSessionsEnabled" | "showHiddenFiles" | "sidebarsSwapped">>;
};

export function FileTreePreferencesGroup({ fileTreeMenuBehaviorApi, fileTreeMenusApi, fileTreePreferenceStateApi, props }: Deps) {
  const { inPhoneMore } = fileTreeMenuBehaviorApi;
  const { isSortMenuOpen, setIsAppearanceMenuOpen, setIsLocaleMenuOpen, setIsMenuOpen, setIsSortMenuOpen, sortLabel, t } = fileTreeMenusApi;
  const { newProjectMetaLocation, newProjectMetaLocationBusy, setNewProjectMetaLocation, setNewProjectMetaLocationBusy } = fileTreePreferenceStateApi;
  const { gitDiffSideBySide, multiProjectSessionsEnabled, onGitDiffSideBySideChange, onMultiProjectSessionsChange, onShowHiddenFilesChange, onSidebarsSwappedChange, onSortModeChange, showHiddenFiles, sidebarsSwapped, sortMode } = props;
  return (
    <PhoneMoreGroup phone={inPhoneMore} name="files" title={t("remote.phone.fileSettings")}>
      {inPhoneMore ? <div className="phone-more-choice phone-more-sort" role="group" aria-label={t("fileTree.globalSort")}>
        <span className="phone-more-choice-label">{t("fileTree.globalSort")}</span>
        {DIRECTORY_SORT_OPTIONS.map(option => <button type="button" key={option.value} aria-pressed={sortMode === option.value} onClick={() => onSortModeChange?.(option.value)}>{sortLabel(option.value)}</button>)}
      </div> : <>
      <button
        type="button"
        onClick={() => {
          setIsSortMenuOpen((open) => !open);
          setIsAppearanceMenuOpen(false);
          setIsLocaleMenuOpen(false);
        }}
        style={{
          width: "100%",
          border: "none",
          background: "transparent",
          color: "var(--text-primary)",
          borderRadius: "8px",
          padding: "8px 10px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          textAlign: "left",
          cursor: "pointer",
          fontSize: "12px",
        }}
        aria-expanded={isSortMenuOpen}
      >
        <span style={{ flex: 1 }}>{t("fileTree.globalSort")}</span>
        <span style={{ color: "var(--text-secondary)", fontSize: "11px" }}>
          {sortLabel(sortMode)}
        </span>
        <ChevronRight isOpen={isSortMenuOpen} />
      </button>
      {isSortMenuOpen ? DIRECTORY_SORT_OPTIONS.map((option) => {
      const active = option.value === sortMode;
      return (
        <button
          key={option.value}
          type="button"
          onClick={() => {
            onSortModeChange?.(option.value as DirectorySortMode);
            setIsMenuOpen(false);
            setIsAppearanceMenuOpen(false);
            setIsLocaleMenuOpen(false);
            setIsSortMenuOpen(false);
          }}
          style={{
            width: "100%",
            border: "none",
            background: active ? "var(--selection-bg)" : "transparent",
            color: active ? "var(--accent-color)" : "var(--text-primary)",
            borderRadius: "8px",
            padding: "8px 10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            textAlign: "left",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          <span>{sortLabel(option.value as DirectorySortMode)}</span>
          <span style={{ fontSize: "11px", opacity: active ? 1 : 0 }}>✓</span>
        </button>
      );
    }) : null}
    <div style={{ height: "1px", background: "var(--border-color)", margin: "6px 4px" }} />

      </>}
    <button
      type="button"
      role={inPhoneMore ? "switch" : undefined}
      aria-checked={inPhoneMore ? showHiddenFiles : undefined}
      onClick={() => {
        onShowHiddenFilesChange?.(!showHiddenFiles);
        setIsAppearanceMenuOpen(false);
        setIsSortMenuOpen(false);
      }}
      style={{
        width: "100%",
        border: "none",
        background: showHiddenFiles ? "var(--selection-bg)" : "transparent",
        color: showHiddenFiles ? "var(--accent-color)" : "var(--text-primary)",
        borderRadius: "8px",
        padding: "8px 10px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        textAlign: "left",
        cursor: "pointer",
        fontSize: "12px",
      }}
    >
      <span>{t("fileTree.showHiddenFiles")}</span>
      {inPhoneMore ? <span className="remote-switch" aria-hidden="true" /> : <span style={{ fontSize: "11px", opacity: showHiddenFiles ? 1 : 0 }}>✓</span>}
    </button>
    <button
      type="button"
      disabled={newProjectMetaLocationBusy}
      onClick={() => {
        if (newProjectMetaLocationBusy) return;
        const previous = newProjectMetaLocation;
        const next = previous === "home" ? "project" : "home";
        setNewProjectMetaLocation(next);
        setNewProjectMetaLocationBusy(true);
        updateNewProjectMetaLocationPreference(next)
          .then(setNewProjectMetaLocation)
          .catch(() => setNewProjectMetaLocation(previous))
          .finally(() => setNewProjectMetaLocationBusy(false));
      }}
      style={{
        width: "100%",
        border: "none",
        background: "transparent",
        color: "var(--text-primary)",
        borderRadius: "8px",
        padding: "8px 10px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        textAlign: "left",
        cursor: newProjectMetaLocationBusy ? "default" : "pointer",
        fontSize: "12px",
        opacity: newProjectMetaLocationBusy ? 0.65 : 1,
      }}
    >
      <span style={{ flex: 1 }}>{t("fileTree.newProjectMetaLocation")}</span>
      <span style={{ color: "var(--text-secondary)", fontSize: "11px" }}>
        {t(newProjectMetaLocation === "home" ? "fileTree.metaLocationHome" : "fileTree.metaLocationProject")}
      </span>
    </button>
    <button
      type="button"
      role={inPhoneMore ? "switch" : undefined}
      aria-checked={inPhoneMore ? multiProjectSessionsEnabled : undefined}
      onClick={() => {
        onMultiProjectSessionsChange?.(!multiProjectSessionsEnabled);
        setIsAppearanceMenuOpen(false);
        setIsSortMenuOpen(false);
      }}
      style={{
        width: "100%",
        border: "none",
        background: multiProjectSessionsEnabled ? "var(--selection-bg)" : "transparent",
        color: multiProjectSessionsEnabled ? "var(--accent-color)" : "var(--text-primary)",
        borderRadius: "8px",
        padding: "8px 10px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        textAlign: "left",
        cursor: "pointer",
        fontSize: "12px",
      }}
    >
      <span>{t("fileTree.multiProjectSessions")}</span>
      {inPhoneMore ? <span className="remote-switch" aria-hidden="true" /> : <span style={{ fontSize: "11px", opacity: multiProjectSessionsEnabled ? 1 : 0 }}>✓</span>}
    </button>
    <button
      type="button"
      role={inPhoneMore ? "switch" : undefined}
      aria-checked={inPhoneMore ? sidebarsSwapped : undefined}
      onClick={() => {
        onSidebarsSwappedChange?.(!sidebarsSwapped);
        setIsAppearanceMenuOpen(false);
        setIsSortMenuOpen(false);
      }}
      style={{
        width: "100%",
        border: "none",
        background: sidebarsSwapped ? "var(--selection-bg)" : "transparent",
        color: sidebarsSwapped ? "var(--accent-color)" : "var(--text-primary)",
        borderRadius: "8px",
        padding: "8px 10px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        textAlign: "left",
        cursor: "pointer",
        fontSize: "12px",
      }}
    >
      <span>{t("fileTree.swapSidebars")}</span>
      {inPhoneMore ? <span className="remote-switch" aria-hidden="true" /> : <span style={{ fontSize: "11px", opacity: sidebarsSwapped ? 1 : 0 }}>✓</span>}
    </button>
    <button
      type="button"
      role={inPhoneMore ? "switch" : undefined}
      aria-checked={inPhoneMore ? gitDiffSideBySide : undefined}
      onClick={() => {
        onGitDiffSideBySideChange?.(!gitDiffSideBySide);
        setIsAppearanceMenuOpen(false);
        setIsSortMenuOpen(false);
      }}
      style={{
        width: "100%",
        border: "none",
        background: gitDiffSideBySide ? "var(--selection-bg)" : "transparent",
        color: gitDiffSideBySide ? "var(--accent-color)" : "var(--text-primary)",
        borderRadius: "8px",
        padding: "8px 10px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        textAlign: "left",
        cursor: "pointer",
        fontSize: "12px",
      }}
    >
      <span>{t("fileTree.sideBySideDiff")}</span>
      {inPhoneMore ? <span className="remote-switch" aria-hidden="true" /> : <span style={{ fontSize: "11px", opacity: gitDiffSideBySide ? 1 : 0 }}>✓</span>}
    </button>
      </PhoneMoreGroup>
  );
}
