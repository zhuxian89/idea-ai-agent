import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n, type MessageKey } from "../i18n";
import { sendVoice, subscribeVoice, type VoiceProvider } from "../services/voiceInput";

type Phase = "idle" | "starting" | "recording" | "stopping" | "transcribing" | "configuration" | "error";
type Props = { scope: string; disabled?: boolean; prepareInsertion: () => ((text: string) => void) | undefined; onBusyChange: (busy: boolean) => void };
const providers: Record<VoiceProvider, MessageKey> = { tencent: "voice.provider.tencent", siliconflow: "voice.provider.siliconflow", custom: "voice.provider.custom" };
const errors: Record<string, MessageKey> = {
  microphone: "voice.error.microphone", service: "voice.error.service", authentication: "voice.error.authentication",
  siliconAuthentication: "voice.error.siliconAuthentication", rateLimit: "voice.error.rateLimit", tencentAuthentication: "voice.error.tencentAuthentication", tencentActivation: "voice.error.tencentActivation", clock: "voice.error.clock", tooLong: "voice.error.tooLong", empty: "voice.error.empty", bridge: "voice.error.bridge",
};

export function VoiceRecordingPopover({ scope, disabled, prepareInsertion, onBusyChange }: Props) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("idle");
  const [provider, setProvider] = useState<VoiceProvider | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [limitSeconds, setLimitSeconds] = useState(120);
  const [levels, setLevels] = useState<number[]>(Array(21).fill(0));
  const [error, setError] = useState("service");
  const [position, setPosition] = useState({ left: 12, bottom: 48, width: 400 });
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const id = useRef<string | null>(null);
  const insert = useRef<((text: string) => void) | undefined>(undefined);
  const busyCallback = useRef(onBusyChange); busyCallback.current = onBusyChange;
  const phaseRef = useRef(phase); phaseRef.current = phase;
  const open = phase !== "idle";
  const busy = ["starting", "recording", "stopping", "transcribing"].includes(phase);
  const close = (restoreFocus = true) => {
    if (id.current) sendVoice("voiceCancel", id.current);
    id.current = null;
    insert.current = undefined;
    busyCallback.current(false);
    setPhase("idle");
    if (restoreFocus) button.current?.focus({ preventScroll: true });
  };
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => {
    return subscribeVoice((event) => {
      if (event.id !== id.current) return;
      if (event.provider && Object.prototype.hasOwnProperty.call(providers, event.provider)) setProvider(event.provider);
      if (event.limitSeconds === 60 || event.limitSeconds === 120) setLimitSeconds(event.limitSeconds);
      if (event.state === "recording") {
        if (phaseRef.current !== "stopping") setPhase("recording");
        setElapsed(Math.max(0, event.elapsedMs || 0));
        const level = Number.isFinite(event.level) ? Math.max(0, Math.min(1, event.level!)) : 0;
        setLevels((values) => [...values.slice(1), level]);
      } else if (event.state === "done") {
        const apply = insert.current;
        closeRef.current(false);
        if (event.text?.trim()) apply?.(event.text);
      } else if (event.state === "error" || event.state === "configuration") {
        setError(event.error || "service");
        setPhase(event.state);
        busyCallback.current(false);
      } else setPhase(event.state);
    });
  }, []);
  useEffect(() => { closeRef.current(false); return () => closeRef.current(false); }, [scope]);
  useEffect(() => {
    if (!open) return;
    const hide = () => { if (document.hidden) closeRef.current(false); };
    const unload = () => closeRef.current(false);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
    };
    document.addEventListener("keydown", escape, true);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", unload);
    window.addEventListener("ideaAgentVoiceSettingsOpening", unload);
    const chat = button.current?.closest(".idea-chat");
    const observer = new MutationObserver(() => { if (chat?.hasAttribute("hidden")) closeRef.current(false); });
    if (chat) observer.observe(chat, { attributes: true, attributeFilter: ["hidden"] });
    return () => { document.removeEventListener("keydown", escape, true); document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", unload); window.removeEventListener("ideaAgentVoiceSettingsOpening", unload); observer.disconnect(); };
  }, [open]);
  useEffect(() => {
    if (phase !== "starting") return;
    const timer = window.setTimeout(() => {
      if (id.current) sendVoice("voiceCancel", id.current);
      id.current = null;
      setError("microphone"); setPhase("error"); busyCallback.current(false);
    }, 30000);
    return () => window.clearTimeout(timer);
  }, [phase]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = button.current?.getBoundingClientRect(); if (!rect) return;
      const width = Math.min(400, window.innerWidth - 24);
      setPosition({ width, left: Math.max(12, Math.min(rect.right - width + 12, window.innerWidth - width - 12)), bottom: Math.max(12, Math.min(window.innerHeight - 132, window.innerHeight - (button.current?.closest(".idea-composer")?.getBoundingClientRect().top ?? rect.top) + 12)) });
    };
    place(); panel.current?.focus({ preventScroll: true });
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  const start = () => {
    const apply = prepareInsertion();
    if (!apply) return;
    insert.current = apply;
    id.current = crypto.randomUUID();
    setProvider(null);
    setElapsed(0); setLevels(Array(21).fill(0)); setPhase("starting"); busyCallback.current(true);
    if (!sendVoice("voiceStart", id.current)) { setError("bridge"); setPhase("error"); busyCallback.current(false); }
  };
  const configure = () => { close(false); sendVoice("voiceConfigure", "settings"); };
  const stop = () => { if (id.current) { setPhase("stopping"); sendVoice("voiceStop", id.current); } };
  const seconds = Math.floor(elapsed / 1000);
  const title = phase === "recording" ? t("voice.listening") : phase === "configuration" ? t("voice.configure") : phase === "error" ? t("voice.failed") : phase === "starting" ? t("voice.starting") : t("voice.transcribing");
  return <>
    <button ref={button} type="button" className="idea-voice-button" data-active={busy || undefined}
      disabled={disabled && !open} title={t("voice.input")} aria-label={t("voice.input")} aria-expanded={open} aria-haspopup="dialog"
      onMouseDown={(event) => event.preventDefault()} onClick={() => phase === "recording" ? stop() : open ? close() : start()}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>
    </button>
    {open ? createPortal(<section ref={panel} className="idea-voice-popover" role="dialog" aria-label={t("voice.input")} tabIndex={-1}
      style={{ ...position, maxHeight: `calc(100vh - ${position.bottom + 12}px)` }}>
      <header><span className="idea-voice-status" data-recording={phase === "recording" || undefined}/><div className="idea-voice-heading"><strong role="status">{title}</strong><span className="idea-voice-provider" role="status">{provider ? t(providers[provider]) : t(phase === "starting" ? "voice.provider.loading" : phase === "configuration" ? "voice.provider.unconfigured" : "voice.provider.unavailable")}</span></div><time>{`${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`}</time><button type="button" className="idea-voice-settings-button" title={t("voice.settingsTitle")} aria-label={t("voice.settingsTitle")} onClick={configure}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 3-.6 2.4-2 .9L4 5.6 2 9l1.8 1.7v2.6L2 15l2 3.4 2.4-.7 2 .9L9 21h6l.6-2.4 2-.9 2.4.7 2-3.4-1.8-1.7v-2.6L22 9l-2-3.4-2.4.7-2-.9L15 3z"/><circle cx="12" cy="12" r="3"/></svg></button></header>
      {busy ? <>
        <div className="idea-voice-wave" aria-hidden="true">{levels.map((level, index) => <i key={index} style={{ height: `${5 + level * 67}px`, background: `hsl(${185 + index * 4} 65% 65%)` }}/>)}</div>
        <div className="idea-voice-controls">
          <button type="button" className="idea-voice-text-button" onClick={() => close()}><kbd>Esc</kbd> {t("voice.cancel")}</button>
          <div className="idea-voice-stop-wrap"><button type="button" className="idea-voice-stop" disabled={phase !== "recording"} aria-label={t("voice.stop")} onClick={stop}><span/></button><span>{phase === "recording" ? t("voice.stop") : title}</span></div>
          <span className="idea-voice-limit">{t("voice.limit", { seconds: limitSeconds })}</span>
        </div>
      </> : <div className="idea-voice-message">
        <p role={phase === "error" ? "alert" : undefined}>{phase === "configuration" ? t("voice.configureHint") : t(errors[error] || errors.service)}</p>
        <div><button type="button" className="idea-voice-text-button" onClick={() => close()}>{t("voice.cancel")}</button>
          {phase === "error" ? <button type="button" className="idea-voice-text-button" onClick={start}>{t("voice.retry")}</button> : null}
          <button type="button" className="idea-voice-text-button" onClick={configure}>{t("voice.settingsAction")}</button></div>
      </div>}
      {busy ? <p className="idea-voice-footnote">{t("voice.draftOnly")}</p> : null}
    </section>, document.body) : null}
  </>;
}
