import { type TimelineItem } from "../hooks/useSessionStream";
import type { ExchangeAux, RelatedFile } from "../services/session";
import type { AgentStatus } from "../services/agents";
import { useI18n } from "../i18n";

export type SessionItem = {
  key?: string;
  session_key?: string;
  type?: string;
  name?: string;
  agent?: string;
  context_window?: {
    totalTokens: number;
    modelContextWindow: number;
  };
  search_seq?: number;
  scope?: string;
  purpose?: string;
  exchanges?: Array<{
    seq?: number;
    role?: string;
    agent?: string;
    model?: string;
    model_display_name?: string;
    effort?: string;
    fast_service?: string;
    content?: string;
    timestamp?: string;
    context_window?: {
      totalTokens: number;
      modelContextWindow: number;
    };
  }>;
  closed_at?: string;
  source?: string;
  related_files?: RelatedFile[];
  exchange_aux?: Record<string, ExchangeAux[]>;
};

export type SessionViewerProps = {
  phone?: boolean;
  session: SessionItem | null;
  connected?: boolean;
  loading?: boolean;
  slashCommandResult?: {
    sessionKey?: string;
    command: string;
    content: string;
    status: "running" | "complete" | "failed";
    error?: string;
    loginNotice?: {
      status?: string;
      loginId?: string;
      verificationUrl?: string;
      userCode?: string;
      error?: string;
      authMode?: string;
      planType?: string;
    };
  } | null;
  rootId?: string | null;
  rootPath?: string | null;
  interactionMode?: "main" | "drawer";
  targetSeq?: number;
  gitFileStatsByPath?: Record<
    string,
    { status: string; additions: number; deletions: number }
  >;
  onFileClick?: (file: RelatedFile & { name?: string }) => void;
  onRootClick?: (rootId: string) => void;
  onRemoveRelatedFile?: (path: string, head?: string, repoPath?: string, repoKind?: string) => void;
  onAskUserAnswer?: (input: {
    rootId: string;
    sessionKey: string;
    agent?: string;
    toolUseId: string;
    answers: Record<string, string>;
  }) => void | Promise<void>;
  onEditUserMessage?: (content: string) => void;
  onForkAgentMessage?: (seq: number) => void | Promise<void>;
  targetSeqRequestKey?: string | number;
  agents?: AgentStatus[];
};

export type AskUserQuestionOption = {
  label?: string;
  description?: string;
};

export type AskUserQuestionItem = {
  question?: string;
  header?: string;
  options?: AskUserQuestionOption[];
  multiSelect?: boolean;
};

export type UploadAttachment = {
  path: string;
  name: string;
  isImage: boolean;
};

export type MessageTimelineItem = Extract<TimelineItem, { type: "user_text" | "assistant_text" }>;

export type TranslateFn = ReturnType<typeof useI18n>["t"];
