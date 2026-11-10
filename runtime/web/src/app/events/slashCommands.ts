import React from "react";
import { type MessageKey, type MessageParams } from "../../i18n";
import { reportError } from "../../services/error";
import { SlashCommandResult } from "../sessionModel";

type Options = {
  resolveRootForSessionKey: (sessionKey: string) => string | null;
  currentRootIdRef: React.RefObject<string | null>;
  rootSessionKey: (rootId: string, sessionKey: string) => string;
  setSlashCommandResults: React.Dispatch<
    React.SetStateAction<Record<string, SlashCommandResult>>
  >;
  t: (key: MessageKey, params?: MessageParams) => string;
};

export function createSlashCommandHandlers({
  resolveRootForSessionKey,
  currentRootIdRef,
  rootSessionKey,
  setSlashCommandResults,
  t,
}: Options) {
  const handleSlashCommandStream = (payload: any) => {
    const sessionKey =
      typeof payload?.session_key === "string" ? payload.session_key : "";
    const rootID =
      typeof payload?.root_id === "string" && payload.root_id
        ? payload.root_id
        : resolveRootForSessionKey(sessionKey) || currentRootIdRef.current;
    const command =
      typeof payload?.command === "string" ? payload.command : "status";
    const requestId =
      typeof payload?.request_id === "string"
        ? payload.request_id
        : typeof payload?.id === "string"
          ? payload.id
          : "";
    const event = payload?.event;
    if (!rootID || !sessionKey || !event?.type) {
      return;
    }
    const resultKey = rootSessionKey(rootID, sessionKey);
    if (event.type === "message_chunk") {
      const chunk =
        typeof event.data?.content === "string" ? event.data.content : "";
      if (!chunk) {
        return;
      }
      setSlashCommandResults((prev) => {
        const current = prev[resultKey];
        if (!current && sessionKey.startsWith("transient-")) {
          return prev;
        }
        if (
          current?.requestId &&
          requestId &&
          current.requestId !== requestId
        ) {
          return prev;
        }
        return {
          ...prev,
          [resultKey]: {
            rootId: rootID,
            sessionKey,
            requestId: current?.requestId || requestId,
            command: current?.command || command,
            content: `${current?.content || ""}${chunk}`,
            status: "running",
          },
        };
      });
      return;
    }
    if (event.type === "login_notice") {
      const notice = event.data || {};
      const noticeStatus =
        typeof notice.status === "string" ? notice.status : "";
      const failed = noticeStatus === "error";
      const complete = noticeStatus === "success";
      setSlashCommandResults((prev) => {
        const current = prev[resultKey];
        if (!current && sessionKey.startsWith("transient-")) {
          return prev;
        }
        if (
          current?.requestId &&
          requestId &&
          current.requestId !== requestId
        ) {
          return prev;
        }
        return {
          ...prev,
          [resultKey]: {
            rootId: rootID,
            sessionKey,
            requestId: current?.requestId || requestId,
            command: current?.command || command || "login",
            content: current?.content || "",
            status: failed ? "failed" : complete ? "complete" : "running",
            error:
              failed && typeof notice.error === "string"
                ? notice.error
                : current?.error,
            createdAt: current?.createdAt || Date.now(),
            loginNotice: {
              ...current?.loginNotice,
              status: noticeStatus,
              loginId:
                typeof notice.loginId === "string"
                  ? notice.loginId
                  : current?.loginNotice?.loginId,
              verificationUrl:
                typeof notice.verificationUrl === "string"
                  ? notice.verificationUrl
                  : current?.loginNotice?.verificationUrl,
              userCode:
                typeof notice.userCode === "string"
                  ? notice.userCode
                  : current?.loginNotice?.userCode,
              error:
                typeof notice.error === "string"
                  ? notice.error
                  : current?.loginNotice?.error,
              authMode:
                typeof notice.authMode === "string"
                  ? notice.authMode
                  : current?.loginNotice?.authMode,
              planType:
                typeof notice.planType === "string"
                  ? notice.planType
                  : current?.loginNotice?.planType,
            },
          },
        };
      });
      if (failed) {
        reportError(
          "session.slash_command_failed",
          notice.error || t("session.loginFailed"),
          {
            details: { rootId: rootID, sessionKey, command },
          },
        );
      }
      return;
    }
    if (event.type === "error") {
      const message =
        typeof event.data?.message === "string"
          ? event.data.message
          : t("session.commandFailed");
      setSlashCommandResults((prev) => {
        const current = prev[resultKey];
        if (!current && sessionKey.startsWith("transient-")) {
          return prev;
        }
        if (
          current?.requestId &&
          requestId &&
          current.requestId !== requestId
        ) {
          return prev;
        }
        return {
          ...prev,
          [resultKey]: {
            rootId: rootID,
            sessionKey,
            requestId: current?.requestId || requestId,
            command: current?.command || command,
            content: current?.content || "",
            status: "failed",
            error: message,
          },
        };
      });
      reportError("session.slash_command_failed", message, {
        details: { rootId: rootID, sessionKey, command },
      });
    }
  };

  const handleSlashCommandDone = (payload: any) => {
    const sessionKey =
      typeof payload?.session_key === "string" ? payload.session_key : "";
    const rootID =
      typeof payload?.root_id === "string" && payload.root_id
        ? payload.root_id
        : resolveRootForSessionKey(sessionKey) || currentRootIdRef.current;
    if (!rootID || !sessionKey) {
      return;
    }
    const resultKey = rootSessionKey(rootID, sessionKey);
    setSlashCommandResults((prev) => {
      const current = prev[resultKey];
      if (!current || current.status === "failed") {
        return prev;
      }
      const requestId =
        typeof payload?.request_id === "string"
          ? payload.request_id
          : typeof payload?.id === "string"
            ? payload.id
            : "";
      if (current.requestId && requestId && current.requestId !== requestId) {
        return prev;
      }
      return {
        ...prev,
        [resultKey]: {
          ...current,
          status: "complete",
        },
      };
    });
  };
  return { handleSlashCommandStream, handleSlashCommandDone };
}
