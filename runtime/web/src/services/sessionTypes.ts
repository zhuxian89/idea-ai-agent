// Session service for managing agent sessions

export type SessionType = "chat" | "plugin" | "command";

export type QueuedUserMessage = {
  id: string;
  agent?: string;
  model?: string;
  mode?: string;
  effort?: string;
  fast_service?: string;
  content: string;
  timestamp: string;
};

export type RelatedFile = {
  root_id?: string;
  repo_path?: string;
  repo_name?: string;
  repo_kind?: "git" | "plain" | string;
  path: string;
  head?: string;
  relation?: string;
  created_by_session?: boolean;
};

export type RelatedWorktree = {
  root_id: string;
  path: string;
  branch?: string;
  head?: string;
  current?: boolean;
  updated_at?: string;
};

export type ExchangeAux = {
  seq: number;
  line: number;
  toolcall?: ToolCall | null;
  thought?: string | null;
  thought_id?: string;
  todo?: TodoUpdate | null;
  plan?: PlanUpdate | null;
  compact?: CompactNotice | null;
  turn_diff?: TurnDiffUpdate | null;
};

export type TurnDiffUpdate = {
  turnId?: string;
  diff: string;
  snapshotId?: string;
  comparePaths?: string[];
  workspace?: boolean;
  partial?: boolean;
};

export type Session = {
  activity_history_version?: number;
  reply_metadata_version?: number;
  key: string;
  session_key?: string;
  root_id?: string;
  type: SessionType;
  parent_session_key?: string;
  parent_tool_call_id?: string;
  source?: string;
  task_id?: string;
  agent?: string;
  model?: string;
  shell?: string;
  mode?: string;
  effort?: string;
  fast_service?: string;
  plan_mode?: boolean;
  name: string;
  created_at: string;
  updated_at: string;
  closed_at?: string;
  context_window?: {
    totalTokens: number;
    modelContextWindow: number;
  };
  related_files?: RelatedFile[];
  related_worktree?: RelatedWorktree | null;
  pinned_at?: string | null;
  exchange_aux?: Record<string, ExchangeAux[]>;
  exchanges?: Array<{
    seq?: number;
    role?: string;
    agent?: string;
    model?: string;
    model_display_name?: string;
    mode?: string;
    effort?: string;
    fast_service?: string;
    content?: string;
    context_window?: {
      totalTokens: number;
      modelContextWindow: number;
    };
    timestamp?: string;
    toolCall?: ToolCall;
    todoUpdate?: TodoUpdate;
    planUpdate?: PlanUpdate;
    compactNotice?: CompactNotice;
    pending_ack?: boolean;
  }>;
};

export type SessionSearchHit = {
  root_id?: string;
  key: string;
  type: SessionType;
  parent_session_key?: string;
  parent_tool_call_id?: string;
  source?: string;
  agent?: string;
  model?: string;
  shell?: string;
  name: string;
  created_at: string;
  updated_at: string;
  closed_at?: string;
  match_type: "name" | "user" | "reply";
  match_score: number;
  seq: number;
  snippet?: string;
};

export type ToolCallLocation = {
  path: string;
  line?: number;
};

export type ToolCallContentItem =
  | {
      type: "text";
      text?: string;
      path?: string;
      changeKind?: string;
    }
  | {
      type: "diff";
      path?: string;
      oldText?: string;
      newText?: string;
      changeKind?: string;
    };

export type ToolCall = {
  callId: string;
  title?: string;
  status: string;
  kind: string;
  content?: ToolCallContentItem[];
  locations?: ToolCallLocation[];
  meta?: Record<string, unknown>;
  rawType?: string;
  activity?: import("./activityFacts").ActivityFactsV1;
};

export type TodoItem = {
  content: string;
  activeForm?: string;
  status: string;
};

export type TodoUpdate = {
  items: TodoItem[];
};

export type PlanUpdate = {
  id?: string;
  content: string;
  delta?: boolean;
};

export type CompactNotice = {
  id?: string;
  status?: string;
  summary?: string;
};

export type StreamEvent = { event_cursor?: string } & (
  | { type: "message_chunk"; data: { content: string } }
  | { type: "thought_chunk"; data: { id?: string; content: string } }
  | { type: "tool_call"; data: ToolCall }
  | { type: "tool_call_update"; data: ToolCall }
  | { type: "question_answered"; data: ToolCall }
  | { type: "todo_update"; data: TodoUpdate }
  | { type: "plan_update"; data: PlanUpdate }
  | { type: "compact_notice"; data: CompactNotice }
  | { type: "recovery"; data: { message: string } }
  | {
      type: "message_done";
      data?: {
        contextWindow?: {
          totalTokens: number;
          modelContextWindow: number;
        };
      };
    }
  | { type: "error"; data: { message: string } }
);

export type SyncSessionResult = {
  session: Session | null;
  hasDelta: boolean;
};

export type SessionEventHandler = {
  onStream?: (event: StreamEvent) => void;
  onUserMessage?: () => void;
  onDone?: () => void;
  onError?: (error: string) => void;
};

export type SessionActivityState = {
  lastEventAt: number;
  recoveryMessage: string | null;
  eventCursor?: string;
  userTimestamp?: string;
};

export type SessionServiceEvent = {
  type: string;
  sessionKey?: string;
  payload?: Record<string, unknown>;
};

export type FetchSessionsOptions = {
  beforeTime?: string;
  afterTime?: string;
  limit?: number;
  topLevel?: boolean;
  includeChildren?: boolean;
};

export type SessionListPayload = {
  items: Session[];
  pinnedItems: Session[];
  pinnedKeys: string[];
  totalCount: number;
};

export type MultiRootSessionGroup = {
  rootId: string;
  rootName: string;
  latestSessionTime: string;
  items: Session[];
  pinnedItems: Session[];
  pinnedKeys: string[];
  totalCount: number;
};

export type FetchExternalSessionsOptions = {
  beforeTime?: string;
  afterTime?: string;
  filterBound?: boolean;
  limit?: number;
};

export type PendingMessage = {
  id: string;
  message: Record<string, unknown>;
};
