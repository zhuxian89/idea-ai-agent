import type { RemoteDevice } from "../services/remoteDevice";
import { type SessionMode } from "./ModeSelector";

export type SessionInfo = {
  key: string;
  session_key?: string;
  root_id?: string;
  name: string;
  type: "chat" | "plugin" | "command";
  agent: string;
  model?: string;
  shell?: string;
  mode?: string;
  effort?: string;
  fast_service?: string;
  plan_mode?: boolean;
  pending?: boolean;
};

export type PendingAttachment = {
  id: string;
  file: File;
  previewUrl?: string;
  isImage: boolean;
};

export type AttachedFileContext = {
  filePath: string;
  fileName: string;
  startLine?: number;
  endLine?: number;
  text?: string;
};

export type QueuedMessageInfo = {
  id: string;
  content: string;
  created_at?: string;
};

export type WSStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

export type ActionBarProps = {
  compactWorkbench?: boolean;
  status?: WSStatus;
  agentsVersion?: number;
  currentRootId?: string | null;
  currentSession?: SessionInfo | null;
  pendingPlanMode?: boolean;
  attachedFileContext?: AttachedFileContext | null;
  canOpenSessionDrawer?: boolean;
  sessionDrawerOpen?: boolean;
  detachedBoundSession?: boolean;
  editDraftRequest?: {
    id: number;
    content: string;
    mode?: "replace" | "append";
  } | null;
  queuedMessages?: QueuedMessageInfo[];
  inputHistory?: string[];
  onSendMessage?: (
    message: string,
    mode: SessionMode,
    agent: string,
    model?: string,
    agentMode?: string,
    effort?: string,
    fastService?: "" | "on" | "off",
    shell?: string,
  ) => void | Promise<void>;
  onSetPlanMode?: (
    enabled: boolean,
    sessionKey?: string,
    rootId?: string,
  ) => void | Promise<void>;
  onCancelCurrentTurn?: (sessionKey: string) => void;
  onRemoveQueuedMessage?: (queueId: string) => void | Promise<void>;
  onUpdateQueuedMessage?: (queueId: string, content: string) => void | Promise<void>;
  onSendQueuedMessageNow?: (queueId: string) => void | Promise<void>;
  onNewSession?: () => void;
  onRequestFileContext?: () => void;
  onClearFileContext?: () => void;
  onSessionClick?: () => void;
  onToggleLeftSidebar?: () => void;
  onToggleRightSidebar?: () => void;
  sidebarsSwapped?: boolean;
  remoteDevice?: RemoteDevice | null;
};
