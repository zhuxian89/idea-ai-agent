import { useMemo, useEffect } from "react";
import { GitFileStat } from "../fileNavigation";
import type { useCurrentRoot } from "./useCurrentRoot";
import type { useSessionList } from "./useSessionList";
import type { useGit } from "./useGit";
import type { useExternalSessionImport } from "./useExternalSessionImport";

type Deps = {
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  sessionListApi: ReturnType<typeof useSessionList>;
  gitApi: ReturnType<typeof useGit>;
  externalSessionImportApi: ReturnType<typeof useExternalSessionImport>;
};

export function useGitFileStats({ currentRootApi, sessionListApi, gitApi, externalSessionImportApi }: Deps) {
  const { currentRootId } = currentRootApi;
  const { setSessionListMode } = sessionListApi;
  const { gitStatus, refreshGitHistory, refreshGitStatus, setGitDiff, setGitHistory, setGitStatus } = gitApi;
  const { setExternalSelectedKey, setExternalSessions } = externalSessionImportApi;

  const gitFileStatsByPath = useMemo<Record<string, GitFileStat>>(() => {
    const items = gitStatus?.items || [];
    return Object.fromEntries(
      items.map((item) => [
        item.path,
        {
          status: item.status,
          additions: item.additions,
          deletions: item.deletions,
        },
      ]),
    );
  }, [gitStatus]);
  useEffect(() => {
    if (!currentRootId) {
      setGitStatus(null);
      setGitHistory(null);
      setGitDiff(null);
      setSessionListMode("local");
      setExternalSessions([]);
      setExternalSelectedKey("");
      return;
    }
    void refreshGitStatus(currentRootId);
    void refreshGitHistory(currentRootId);
    setGitDiff(null);
  }, [currentRootId, refreshGitHistory, refreshGitStatus]);

  return { gitFileStatsByPath };
}
