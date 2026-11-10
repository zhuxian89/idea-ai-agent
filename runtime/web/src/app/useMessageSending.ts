import React, { useCallback } from "react";
import { type MessageKey, type MessageParams } from "../i18n";
import { PluginManager } from "../plugins/manager";
import { getViewModeSystemPrompt } from "../renderer/viewCatalog";
import { promoteComposerDraft } from "../services/composerDrafts";
import { buildClientContext } from "../services/context";
import { reportError } from "../services/error";
import { type FilePayload } from "../services/file";
import { sessionService, type Session } from "../services/session";
import { mergeSessionItems } from "../services/sessionListMerge";
import { AttachedFileContext, hasExplicitFileContext } from "./fileNavigation";
import { buildMessageWithViewContext, toPluginInput } from "./pluginInput";
import { URLState } from "./runtimeTypes";
import {
  Exchange,
  normalizeMode,
  PendingSend,
  SessionItem,
  SessionMode,
  SlashCommandResult,
  toSessionItem,
} from "./sessionModel";

type Options = {
  currentRootIdRef: React.RefObject<string | null>;
  selectedSessionRef: React.RefObject<SessionItem | null>;
  boundSessionByRootRef: React.RefObject<Record<string, string | null>>;
  interactionModeRef: React.RefObject<"main" | "drawer">;
  sessionCacheRef: React.RefObject<Record<string, Session>>;
  rootSessionKey: (rootId: string, sessionKey: string) => string;
  currentSessionRef: React.RefObject<SessionItem | null>;
  updateSessionAgentForKey: (
    rootID: string,
    sessionKey: string,
    agent: string,
    model?: string,
    agentMode?: string,
    effort?: string,
    fastService?: "" | "on" | "off",
    planMode?: boolean,
    shell?: string,
  ) => void;
  setBoundSessionForRoot: (
    rootID: string | null | undefined,
    key: string | null,
  ) => void;
  setSelectedPendingByKey: (sessionKey: string, pending: boolean) => void;
  setDrawerSessionForRoot: (
    rootID: string | null | undefined,
    session: Session | SessionItem | null,
  ) => void;
  pendingPlanMode: boolean;
  t: (key: MessageKey, params?: MessageParams) => string;
  slashCommandResults: Record<string, SlashCommandResult>;
  setMultiProjectSessionPending: (
    rootID: string | null | undefined,
    sessionKey: string | null | undefined,
    pending: boolean,
  ) => void;
  setSessions: React.Dispatch<React.SetStateAction<SessionItem[]>>;
  drawerSessionByRootRef: React.RefObject<Record<string, SessionItem | null>>;
  setSlashCommandResults: React.Dispatch<
    React.SetStateAction<Record<string, SlashCommandResult>>
  >;
  clearSlashCommandResultForSession: (
    rootID: string,
    sessionKey: string,
  ) => void;
  pendingRequestRef: React.RefObject<Record<string, PendingSend>>;
  bumpCacheVersion: () => void;
  pendingDraftRef: React.RefObject<PendingSend | null>;
  openSessionTab: (rootID: string, session: SessionItem) => void;
  selectedSessionByRootRef: React.RefObject<Record<string, string | null>>;
  setSelectedSession: React.Dispatch<React.SetStateAction<SessionItem | null>>;
  setSelectedSessionLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setMainViewPreferenceForRoot: (
    rootID: string | null | undefined,
    preference: "session" | "file" | "directory" | "git-diff",
  ) => void;
  setInteractionMode: React.Dispatch<React.SetStateAction<"main" | "drawer">>;
  setDrawerOpenForRoot: (
    rootID: string | null | undefined,
    open: boolean,
  ) => void;
  replaceURLState: (next: URLState) => void;
  attachedFileContext: AttachedFileContext | null;
  fileRef: React.RefObject<FilePayload | null>;
  pluginBypassRef: React.RefObject<boolean>;
  pluginQueryRef: React.RefObject<Record<string, string>>;
  pluginManagerRef: React.RefObject<PluginManager>;
  setPendingPlanMode: React.Dispatch<React.SetStateAction<boolean>>;
  removeSessionTabs: (rootID: string, keys: Set<string>) => void;
};

export function useMessageSending({
  currentRootIdRef,
  selectedSessionRef,
  boundSessionByRootRef,
  interactionModeRef,
  sessionCacheRef,
  rootSessionKey,
  currentSessionRef,
  updateSessionAgentForKey,
  setBoundSessionForRoot,
  setSelectedPendingByKey,
  setDrawerSessionForRoot,
  pendingPlanMode,
  t,
  slashCommandResults,
  setMultiProjectSessionPending,
  setSessions,
  drawerSessionByRootRef,
  setSlashCommandResults,
  clearSlashCommandResultForSession,
  pendingRequestRef,
  bumpCacheVersion,
  pendingDraftRef,
  openSessionTab,
  selectedSessionByRootRef,
  setSelectedSession,
  setSelectedSessionLoading,
  setMainViewPreferenceForRoot,
  setInteractionMode,
  setDrawerOpenForRoot,
  replaceURLState,
  attachedFileContext,
  fileRef,
  pluginBypassRef,
  pluginQueryRef,
  pluginManagerRef,
  setPendingPlanMode,
  removeSessionTabs,
}: Options) {
  const handleSendMessage = useCallback(
    async (
      message: string,
      mode: SessionMode,
      agent: string,
      model?: string,
      agentMode?: string,
      effort?: string,
      fastService?: "" | "on" | "off",
      shell?: string,
    ) => {
      const activeRoot = currentRootIdRef.current;
      if (!activeRoot) return;
      const selected = selectedSessionRef.current;
      const selectedKey = selected?.key || selected?.session_key;
      const selectedRoot =
        (selected?.root_id as string | undefined) || activeRoot;
      const currentBoundSessionKey =
        boundSessionByRootRef.current[activeRoot] || null;
      const isMainSessionView =
        interactionModeRef.current !== "drawer" &&
        !!selectedKey &&
        selectedRoot === activeRoot;
      let sendSessionKey: string | null | undefined =
        isMainSessionView && selectedKey && !selectedKey.startsWith("pending-")
          ? selectedKey
          : currentBoundSessionKey;
      let session: Session | null = null;
      let createdDraftItem: SessionItem | null = null;
      if (sendSessionKey) {
        session =
          sessionCacheRef.current[rootSessionKey(activeRoot, sendSessionKey)];
        if (!session) {
          const current = currentSessionRef.current;
          if (current?.key === sendSessionKey) {
            session = current as Session;
          }
        }
        if (!session && selectedKey === sendSessionKey) {
          session = { ...(selected as any), key: sendSessionKey } as Session;
        }
      } else {
        if (
          selectedRoot === activeRoot &&
          selectedKey &&
          !selectedKey.startsWith("pending-")
        ) {
          sendSessionKey = selectedKey;
          session =
            sessionCacheRef.current[
              rootSessionKey(activeRoot, sendSessionKey)
            ] || ({ ...selected, key: selectedKey } as Session);
        }
      }
      let effectiveMode = mode,
        effectiveAgent = agent,
        effectiveModel = model || "",
        effectiveAgentMode = agentMode || "",
        effectiveEffort = effort || "",
        effectiveFastService = (fastService || "") as "" | "on" | "off",
        effectiveShell = shell || "";
      const messageRequestsPlanMode =
        message.trim().toLowerCase() === "/plan" ||
        message.trim().toLowerCase().startsWith("/plan ");
      const normalizedMessage = message.trim().toLowerCase();
      const messageRequestsStatus = normalizedMessage === "/status";
      const messageRequestsLogin = normalizedMessage === "/login";
      const transientSlashCommand = messageRequestsStatus
        ? "status"
        : messageRequestsLogin
          ? "login"
          : "";
      const isQueueSend =
        !!sendSessionKey &&
        !!session &&
        ((session as any).pending === true ||
          (currentSessionRef.current?.key === sendSessionKey &&
            currentSessionRef.current?.pending === true));
      if (sendSessionKey && session) {
        const targetSessionKey = sendSessionKey;
        const previousAgent = session.agent || "";
        effectiveMode = normalizeMode(session.type as any);
        // The composer displays this target's settings. A different previously
        // bound session must not override choices made in the visible composer.
        effectiveAgent = agent || previousAgent || "";
        effectiveModel =
          model ||
          (effectiveAgent === previousAgent ? session.model || "" : "");
        effectiveAgentMode =
          agentMode ||
          (effectiveAgent === previousAgent ? (session as any).mode || "" : "");
        effectiveEffort =
          effort ||
          (effectiveAgent === previousAgent
            ? (session as any).effort || ""
            : "");
        effectiveFastService =
          fastService ||
          (effectiveAgent === previousAgent
            ? (((session as any).fast_service || "") as "" | "on" | "off")
            : "");
        effectiveShell =
          effectiveMode === "command"
            ? shell || (session as any).shell || ""
            : "";
        updateSessionAgentForKey(
          activeRoot,
          targetSessionKey,
          effectiveAgent,
          effectiveModel,
          effectiveAgentMode,
          effectiveEffort,
          effectiveFastService,
        );
        session = {
          ...(session as any),
          agent: effectiveAgent,
          model: effectiveModel,
          mode: effectiveAgentMode,
          effort: effectiveEffort,
          fast_service: effectiveFastService,
          shell: effectiveShell,
        } as Session;
        setBoundSessionForRoot(activeRoot, targetSessionKey);
        if (!isQueueSend) {
          setSelectedPendingByKey(targetSessionKey, true);
        }
        // Queue sends also rebind the drawer; its metadata must follow that key.
        setDrawerSessionForRoot(activeRoot, {
          ...(session as any),
          pending: true,
        } as Session);
      } else {
        if (transientSlashCommand) {
          sendSessionKey = `transient-${Date.now()}`;
          session = null;
        } else {
          sendSessionKey = undefined;
          const tempKey = `pending-${Date.now()}`;
          promoteComposerDraft(activeRoot, "", tempKey);
          session = {
            key: tempKey,
            type: mode,
            agent,
            model: effectiveModel,
            mode: effectiveAgentMode,
            effort: effectiveEffort,
            fast_service: effectiveFastService,
            shell: effectiveShell,
            plan_mode: pendingPlanMode || messageRequestsPlanMode,
            name: t("session.new"),
            pending: true,
          } as any;
          setBoundSessionForRoot(activeRoot, tempKey);
        }
      }
      if (transientSlashCommand) {
        if (!sendSessionKey) return;
        if (effectiveAgent !== "codex") {
          reportError(
            "session.slash_command_failed",
            t("session.slashCommandCodexOnly", {
              command: transientSlashCommand,
            }),
          );
          return;
        }
        const requestId = sessionService.createRequestId("slash");
        const targetSessionKey = sendSessionKey;
        const resultKey = rootSessionKey(activeRoot, targetSessionKey);
        const runningTransientLoginKeys = Array.from(
          new Set(
            Object.values(slashCommandResults)
              .filter(
                (value) =>
                  value.rootId === activeRoot &&
                  value.command === "login" &&
                  value.status === "running",
              )
              .map((value) => value.sessionKey),
          ),
        );
        if (runningTransientLoginKeys.length > 0) {
          await Promise.all(
            runningTransientLoginKeys.map((sessionKey) =>
              sessionService.cancelMessage(activeRoot, sessionKey),
            ),
          );
        }
        if (session) {
          setSelectedPendingByKey(targetSessionKey, false);
          setMultiProjectSessionPending(activeRoot, targetSessionKey, false);
        }
        setSessions((prev) =>
          prev.map((item) => {
            const itemKey = item.key || item.session_key;
            if (itemKey !== targetSessionKey) {
              return item;
            }
            return { ...(item as any), pending: false } as SessionItem;
          }),
        );
        const drawerSession = drawerSessionByRootRef.current[activeRoot];
        if (drawerSession && drawerSession.key === targetSessionKey) {
          setDrawerSessionForRoot(activeRoot, {
            ...(drawerSession as any),
            pending: false,
          } as Session);
        }
        setSlashCommandResults((prev) => {
          const next = { ...prev };
          for (const [key, value] of Object.entries(prev)) {
            if (
              value.rootId === activeRoot &&
              value.sessionKey.startsWith("transient-")
            ) {
              delete next[key];
            }
          }
          next[resultKey] = {
            rootId: activeRoot,
            sessionKey: targetSessionKey,
            requestId,
            command: transientSlashCommand,
            content: "",
            status: "running",
            createdAt: Date.now(),
          };
          return next;
        });
        const sent = await sessionService.runSlashCommand(
          activeRoot,
          targetSessionKey,
          transientSlashCommand,
          effectiveAgent,
          effectiveModel || undefined,
          effectiveAgentMode || undefined,
          effectiveEffort || undefined,
          effectiveFastService,
          requestId,
        );
        if (!sent) {
          setSlashCommandResults((prev) => ({
            ...prev,
            [resultKey]: {
              rootId: activeRoot,
              sessionKey: targetSessionKey,
              requestId,
              command: transientSlashCommand,
              content: "",
              status: "failed",
              error: t("session.connectionNotReady"),
              createdAt: Date.now(),
            },
          }));
          reportError(
            "network.disconnected",
            t("session.commandSendFailedNotReady"),
          );
        }
        return;
      }
      if (sendSessionKey) {
        clearSlashCommandResultForSession(activeRoot, sendSessionKey);
      }
      const runningTransientLoginKeys = Array.from(
        new Set(
          Object.values(slashCommandResults)
            .filter(
              (value) =>
                value.rootId === activeRoot &&
                value.command === "login" &&
                value.status === "running",
            )
            .map((value) => value.sessionKey),
        ),
      );
      if (runningTransientLoginKeys.length > 0) {
        await Promise.all(
          runningTransientLoginKeys.map((sessionKey) =>
            sessionService.cancelMessage(activeRoot, sessionKey),
          ),
        );
      }
      setSlashCommandResults((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [key, value] of Object.entries(prev)) {
          if (
            value.rootId === activeRoot &&
            value.sessionKey.startsWith("transient-")
          ) {
            delete next[key];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      const now = new Date().toISOString();
      const requestId = sessionService.createRequestId("msg");
      const tempKey = sendSessionKey ? "" : session?.key || "";
      const userEx: Exchange = {
        role: "user",
        agent: effectiveAgent,
        model: effectiveModel,
        mode: effectiveAgentMode,
        effort: effectiveEffort,
        fast_service: effectiveFastService,
        content: message,
        timestamp: now,
        pending_ack: true,
      };
      if (sendSessionKey) {
        const targetSessionKey = sendSessionKey;
        setMultiProjectSessionPending(activeRoot, targetSessionKey, true);
        setSessions((prev) =>
          prev.map((item) => {
            const itemKey = item.key || item.session_key;
            if (itemKey !== targetSessionKey) {
              return item;
            }
            return {
              ...(item as any),
              pending: true,
              updated_at: now,
              agent: effectiveAgent,
              model: effectiveModel,
              mode: effectiveAgentMode,
              effort: effectiveEffort,
              fast_service: effectiveFastService,
              shell: effectiveShell,
            } as SessionItem;
          }),
        );
      }
      pendingRequestRef.current[requestId] = {
        rootId: activeRoot,
        mode: effectiveMode,
        agent: effectiveAgent,
        model: effectiveModel,
        agentMode: effectiveAgentMode,
        effort: effectiveEffort,
        fastService: effectiveFastService,
        shell: effectiveShell,
        message,
        timestamp: now,
        requestId,
        sessionKey: sendSessionKey || undefined,
        tempKey,
      };
      if (sendSessionKey && !isQueueSend) {
        const ck = rootSessionKey(activeRoot, sendSessionKey);
        const cached =
          sessionCacheRef.current[ck] || ({ ...(session as any) } as Session);
        const prevExchanges = Array.isArray((cached as any).exchanges)
          ? ((cached as any).exchanges as Exchange[])
          : [];
        sessionCacheRef.current[ck] = {
          ...(cached as any),
          exchanges: [...prevExchanges, userEx],
          mode: effectiveAgentMode,
          effort: effectiveEffort,
          fast_service: effectiveFastService,
          shell: effectiveShell,
          updated_at: now,
        } as Session;
        session = sessionCacheRef.current[ck];
        bumpCacheVersion();
      } else if (!sendSessionKey) {
        const tempSessionKey = session?.key || "";
        pendingDraftRef.current = {
          rootId: activeRoot,
          mode: effectiveMode,
          agent: effectiveAgent,
          model: effectiveModel,
          agentMode: effectiveAgentMode,
          effort: effectiveEffort,
          fastService: effectiveFastService,
          shell: effectiveShell,
          message,
          timestamp: now,
          requestId,
          tempKey,
        };
        const draftSession = {
          ...(session as any),
          exchanges: [userEx],
          updated_at: now,
        } as Session;
        if (tempSessionKey) {
          setMultiProjectSessionPending(activeRoot, tempSessionKey, true);
          sessionCacheRef.current[rootSessionKey(activeRoot, tempSessionKey)] =
            draftSession;
          const draftItem = toSessionItem(activeRoot, {
            ...(draftSession as any),
            key: tempSessionKey,
            session_key: tempSessionKey,
            root_id: activeRoot,
            created_at: now,
            updated_at: now,
            pending: true,
          });
          if (draftItem) {
            setSessions((prev) => mergeSessionItems(prev, [draftItem]));
            createdDraftItem = draftItem;
            openSessionTab(activeRoot, draftItem);
            selectedSessionByRootRef.current[activeRoot] = tempSessionKey;
            setSelectedSession(draftItem);
            setSelectedSessionLoading(false);
            setMainViewPreferenceForRoot(activeRoot, "session");
            setInteractionMode("main");
            setDrawerOpenForRoot(activeRoot, false);
            replaceURLState({
              root: activeRoot,
              file: "",
              session: tempSessionKey,
              cursor: 0,
              pluginQuery: {},
            });
          }
          bumpCacheVersion();
        }
        session = draftSession;
      }
      const isBoundInMain =
        !!createdDraftItem ||
        (!!selectedSessionRef.current &&
          selectedSessionRef.current.key === sendSessionKey &&
          interactionModeRef.current !== "drawer");
      if (!isBoundInMain) {
        setInteractionMode("drawer");
        setDrawerOpenForRoot(activeRoot, true);
      }
      if (!isQueueSend) {
        setDrawerSessionForRoot(activeRoot, {
          ...(session as any),
          pending: true,
        } as Session);
      }
      const explicitFileContext = hasExplicitFileContext(message);
      const selection =
        explicitFileContext || !attachedFileContext?.filePath
          ? undefined
          : {
              filePath: attachedFileContext.filePath,
              startLine: attachedFileContext.startLine,
              endLine: attachedFileContext.endLine,
              text: attachedFileContext.text,
            };
      const context = buildClientContext({
        currentRoot: activeRoot,
        selection,
        pluginCatalog:
          effectiveMode === "plugin" ? getViewModeSystemPrompt() : undefined,
      });
      let outgoingMessage = message;
      const applyPendingPlanPrefix = pendingPlanMode && !sendSessionKey;
      const currentFile = fileRef.current;
      if (currentFile && !pluginBypassRef.current) {
        try {
          const pluginInput = toPluginInput(
            currentFile,
            pluginQueryRef.current,
          );
          const plugin = pluginManagerRef.current.match(
            activeRoot,
            pluginInput,
          );
          if (plugin?.viewContext) {
            outgoingMessage = buildMessageWithViewContext(
              message,
              pluginManagerRef.current.viewContext(plugin, pluginInput),
            );
          }
        } catch (err) {
          console.warn("[plugin/view-context] failed", err);
        }
      }
      if (applyPendingPlanPrefix) {
        outgoingMessage = `/plan ${outgoingMessage}`;
      }
      const sent = await sessionService.sendMessage(
        activeRoot,
        sendSessionKey || undefined,
        outgoingMessage,
        effectiveMode,
        effectiveAgent,
        effectiveModel || undefined,
        effectiveAgentMode || undefined,
        effectiveEffort || undefined,
        effectiveFastService,
        context,
        effectiveShell || undefined,
        requestId,
      );
      if (sent && applyPendingPlanPrefix) {
        setPendingPlanMode(false);
      }
      console.info("[session/send] dispatched", {
        requestId,
        rootId: activeRoot,
        sessionKey: sendSessionKey || null,
        tempKey: tempKey || null,
        sent,
      });
      if (!sent) {
        console.warn("[session/send] dispatch_failed", {
          requestId,
          rootId: activeRoot,
          sessionKey: sendSessionKey || null,
        });
        reportError(
          "network.disconnected",
          t("session.messageSendFailedNotReady"),
          {
            details: {
              requestId,
              rootId: activeRoot,
              sessionKey: sendSessionKey || null,
            },
          },
        );
        delete pendingRequestRef.current[requestId];
      }
      if (!sent && sendSessionKey) {
        const failedSessionKey = sendSessionKey;
        setSelectedPendingByKey(failedSessionKey, false);
        setSessions((prev) =>
          prev.map((item) => {
            const itemKey = item.key || item.session_key;
            if (itemKey !== failedSessionKey) {
              return item;
            }
            return { ...(item as any), pending: false } as SessionItem;
          }),
        );
        const latest = drawerSessionByRootRef.current[activeRoot];
        if (latest && latest.key === failedSessionKey) {
          setDrawerSessionForRoot(activeRoot, {
            ...(latest as any),
            pending: false,
          } as Session);
        }
      }
      if (!sent && !sendSessionKey && tempKey) {
        setMultiProjectSessionPending(activeRoot, tempKey, false);
        removeSessionTabs(activeRoot, new Set([tempKey]));
        setSessions((prev) =>
          prev.filter((item) => (item.key || item.session_key) !== tempKey),
        );
        delete sessionCacheRef.current[rootSessionKey(activeRoot, tempKey)];
        if (boundSessionByRootRef.current[activeRoot] === tempKey) {
          setBoundSessionForRoot(activeRoot, null);
        }
        const latest = drawerSessionByRootRef.current[activeRoot];
        if (latest && latest.key === tempKey) {
          setDrawerSessionForRoot(activeRoot, {
            ...(latest as any),
            pending: false,
          } as Session);
        }
        if (createdDraftItem) {
          selectedSessionByRootRef.current[activeRoot] = null;
          setSelectedSession(null);
          replaceURLState({
            root: activeRoot,
            file: "",
            session: "",
            cursor: 0,
            pluginQuery: {},
          });
        }
      }
    },
    [
      attachedFileContext,
      rootSessionKey,
      mergeSessionItems,
      openSessionTab,
      removeSessionTabs,
      setSelectedPendingByKey,
      bumpCacheVersion,
      clearSlashCommandResultForSession,
      slashCommandResults,
      setBoundSessionForRoot,
      setDrawerOpenForRoot,
      setDrawerSessionForRoot,
      setMultiProjectSessionPending,
      updateSessionAgentForKey,
      pendingPlanMode,
      replaceURLState,
      setMainViewPreferenceForRoot,
    ],
  );
  return { handleSendMessage };
}

export type MessageSending = ReturnType<typeof useMessageSending>;
