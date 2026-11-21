import React from "react";
import "./bark.css";
import { useI18n } from "../../i18n";
import {
  getBarkStatus,
  sendBarkTest,
  syncBarkLink,
  updateBark,
  type BarkStatus,
  type BarkTypes,
  type BarkUpdate,
} from "../../services/barkSettings";

const TYPE_ORDER: Array<keyof BarkTypes> = ["approval", "ask_user", "failed", "done"];

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Lock-screen push through the Bark app. Settings live on the node, so the
 * same screen works from the iOS App, the phone web page and the desktop.
 */
export function BarkMenuItem({ phone = false }: { phone?: boolean }) {
  const { t } = useI18n();
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const [status, setStatus] = React.useState<BarkStatus | null>(null);
  const [open, setOpen] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      setStatus(await getBarkStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const meta = !status
    ? ""
    : status.enabled
      ? t("bark.menuOn")
      : status.configured
        ? t("bark.menuConfigured")
        : t("bark.menuUnset");

  return (
    <>
      <button
        type="button"
        className="bark-menu-item"
        data-phone={phone ? "true" : undefined}
        onClick={() => {
          setOpen(true);
          dialogRef.current?.showModal();
        }}
      >
        <span>{t("bark.menu")}</span>
        <span className="bark-meta">{meta}</span>
      </button>
      <dialog
        ref={dialogRef}
        className="remote-access-dialog remote-access-panel bark-dialog"
        aria-labelledby="bark-dialog-title"
        onClose={() => {
          setOpen(false);
          void refresh();
        }}
        onClick={(event) => {
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        {open ? <BarkSettingsBody status={status} onStatus={setStatus} onClose={() => dialogRef.current?.close()} /> : null}
      </dialog>
    </>
  );
}

function BarkSettingsBody({
  status,
  onStatus,
  onClose,
}: {
  status: BarkStatus | null;
  onStatus: (status: BarkStatus) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ text: string; tone: "info" | "error" }>({ text: "", tone: "info" });
  const [editing, setEditing] = React.useState(false);
  const [deviceInput, setDeviceInput] = React.useState("");
  const [loadError, setLoadError] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const fresh = await getBarkStatus();
        if (!cancelled) onStatus(fresh);
        // Opening the settings from this client tells the node where a tapped
        // notification should lead (the App link when opened from the App).
        const synced = syncBarkLink();
        if (synced) {
          const next = await synced;
          if (!cancelled) onStatus(next);
        }
      } catch (error) {
        if (!cancelled) setLoadError(errorMessage(error, t("bark.loadFailed")));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = async (update: BarkUpdate) => {
    if (busy) return false;
    setBusy(true);
    setMessage({ text: "", tone: "info" });
    try {
      onStatus(await updateBark(update));
      return true;
    } catch (error) {
      setMessage({ text: errorMessage(error, t("bark.saveFailed")), tone: "error" });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    if (busy) return;
    setBusy(true);
    setMessage({ text: "", tone: "info" });
    try {
      await sendBarkTest();
      setMessage({ text: t("bark.testSent"), tone: "info" });
    } catch (error) {
      setMessage({ text: errorMessage(error, t("bark.testFailed")), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const configured = Boolean(status?.configured);
  const showInput = !configured || editing;

  return (
    <>
      <header>
        <h2 id="bark-dialog-title">{t("bark.title")}</h2>
        <button type="button" className="remote-close" aria-label={t("common.close")} onClick={onClose}>
          ×
        </button>
      </header>

      <section className="bark-group" aria-label={t("bark.device")}>
        <h3>{t("bark.device")}</h3>
        <div className="bark-rows">
          {showInput ? (
            <form
              className="bark-device"
              onSubmit={async (event) => {
                event.preventDefault();
                const value = deviceInput.trim();
                if (!value) return;
                if (await apply({ device_key: value, enabled: true })) {
                  setDeviceInput("");
                  setEditing(false);
                }
              }}
            >
              <input
                type="text"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                value={deviceInput}
                placeholder={t("bark.devicePlaceholder")}
                aria-label={t("bark.devicePlaceholder")}
                onChange={(event) => setDeviceInput(event.target.value)}
              />
              <button type="submit" disabled={busy || !deviceInput.trim()}>
                {t("bark.save")}
              </button>
            </form>
          ) : (
            <div className="bark-row" role="group" aria-label={t("bark.device")}>
              <span>{t("bark.deviceSet", { hint: status?.key_hint || "" })}</span>
              <span className="bark-inline-actions">
                <button type="button" disabled={busy} onClick={() => setEditing(true)}>
                  {t("bark.change")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void apply({ device_key: "" });
                  }}
                >
                  {t("bark.remove")}
                </button>
              </span>
            </div>
          )}
          {configured ? (
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(status?.enabled)}
              className="bark-row"
              disabled={busy}
              onClick={() => void apply({ enabled: !status?.enabled })}
            >
              <span>{t("bark.enable")}</span>
              <i className="remote-switch" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {showInput ? <p className="bark-note">{t("bark.deviceHelp")}</p> : null}
      </section>

      <section className="bark-group" aria-label={t("bark.types")}>
        <h3>{t("bark.types")}</h3>
        <div className="bark-rows">
          {TYPE_ORDER.map((kind) => (
            <button
              key={kind}
              type="button"
              role="switch"
              aria-checked={Boolean(status?.types?.[kind])}
              className="bark-row"
              disabled={busy || !status}
              onClick={() => void apply({ types: { [kind]: !status?.types?.[kind] } })}
            >
              <span>{t(`bark.type.${kind}` as const)}</span>
              <i className="remote-switch" aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>

      <section className="bark-group">
        <div className="bark-rows">
          <button type="button" className="bark-row" disabled={busy || !configured} onClick={() => void runTest()}>
            <span>{t("bark.test")}</span>
          </button>
        </div>
      </section>

      <p className="bark-status" role="status" data-tone={loadError || message.tone === "error" ? "error" : undefined}>
        {loadError || message.text}
      </p>
    </>
  );
}
