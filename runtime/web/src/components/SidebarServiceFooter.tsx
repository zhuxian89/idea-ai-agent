import { SystemMonitor } from "./SystemMonitor";
import { RelayActionButton } from "./fileTree/RelayActionButton";
import { RemotePublishedUpdate } from "./remote/RemoteBrowserUpdate";

type Props = {
  showMonitor: boolean;
  relayActionLabel: string | null;
  relayActionDisabled?: boolean;
  onRelayAction?: () => void;
  versionNote?: string | null;
  publicStandaloneVersion?: string | null;
};

/** 多 Agent 侧栏底部：与单聊文件树页脚同一组件（电脑状态、公网访问入口、版本号），不重复实现。 */
export function SidebarServiceFooter({ showMonitor, relayActionLabel, relayActionDisabled, onRelayAction, versionNote, publicStandaloneVersion }: Props) {
  if (!showMonitor && !relayActionLabel && !versionNote && !publicStandaloneVersion) return null;
  return (
    <div className="sidebar-service-footer">
      {showMonitor ? <SystemMonitor /> : null}
      {relayActionLabel ? <RelayActionButton label={relayActionLabel} disabled={relayActionDisabled} onClick={onRelayAction} /> : null}
      {versionNote ? <div className="file-tree-footer-note">{versionNote}</div> : null}
      {publicStandaloneVersion ? <RemotePublishedUpdate version={publicStandaloneVersion} /> : null}
    </div>
  );
}
