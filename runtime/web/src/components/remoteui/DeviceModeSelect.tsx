import { useI18n } from "../../i18n";
import { remoteDeviceModes, setRemoteDeviceMode, useRemoteDeviceMode, type RemoteDeviceMode } from "../../services/remoteDevice";

export function DeviceModeSelect({ className, segmented = false }: { className?: string; segmented?: boolean }) {
  const { t } = useI18n();
  const mode = useRemoteDeviceMode();
  if (segmented) return <div className={className} role="group" aria-label={t("remote.device.title")}>
    {remoteDeviceModes.map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setRemoteDeviceMode(value)}>{t(`remote.device.${value}`)}</button>)}
  </div>;
  return (
    <label className={className}>
      <span>{t("remote.device.title")}</span>
      <select value={mode} onChange={event => setRemoteDeviceMode(event.target.value as RemoteDeviceMode)}>
        {remoteDeviceModes.map(value => <option key={value} value={value}>{t(`remote.device.${value}`)}</option>)}
      </select>
    </label>
  );
}
