export type ManagedRootPayload = {
  id: string;
  display_name?: string;
  root_path?: string;
  is_git_repo?: boolean;
  is_git_worktree?: boolean;
  size?: number;
  mtime?: string;
};
