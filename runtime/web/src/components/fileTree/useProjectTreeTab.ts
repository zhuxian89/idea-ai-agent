import React from "react";
import { ProjectTreeTab, PROJECT_TREE_TAB_STORAGE_KEY, isProjectTreeTab } from "../fileTreeModel";
import { useRefreshSpin } from "../../hooks";
import type { FileTreeProps } from "../fileTreeModel";

type Deps = {
  props: Pick<FileTreeProps, "onProjectTreeTabChange" | "onRefresh">;
};

export function useProjectTreeTab({ props }: Deps) {
  const { onProjectTreeTabChange, onRefresh } = props;

  const [projectTreeTab, setProjectTreeTab] = React.useState<ProjectTreeTab>(() => {
    if (typeof window === "undefined") {
      return "files";
    }
    try {
      const saved = window.localStorage.getItem(PROJECT_TREE_TAB_STORAGE_KEY);
      return isProjectTreeTab(saved) ? saved : "files";
    } catch {
      return "files";
    }
  });
  const handleTabRefresh = React.useCallback(
    () => onRefresh?.(projectTreeTab),
    [onRefresh, projectTreeTab],
  );
  const {
    refreshing: treeRefreshing,
    pressed: treePressed,
    setPressed: setTreePressed,
    handleClick: handleRefreshClick,
  } = useRefreshSpin(handleTabRefresh);
  React.useEffect(() => {
    onProjectTreeTabChange?.(projectTreeTab);
  }, [onProjectTreeTabChange, projectTreeTab]);
  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(PROJECT_TREE_TAB_STORAGE_KEY, projectTreeTab);
    } catch {
    }
  }, [projectTreeTab]);

  return { handleRefreshClick, projectTreeTab, setProjectTreeTab, setTreePressed, treePressed, treeRefreshing };
}
