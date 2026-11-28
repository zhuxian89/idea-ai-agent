/** 侧栏底部的「从公网访问」入口。单聊文件树与多 Agent 侧栏共用，样式见 workspaceSidebar.css。 */
export function RelayActionButton({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className="file-tree-relay-action" disabled={disabled} onClick={() => onClick?.()}>
      <svg className="rel-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.4" /><rect x="14" y="3" width="7" height="7" rx="1.4" /><rect x="3" y="14" width="7" height="7" rx="1.4" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h3M20 17v4" /></svg>
      <span>{label}</span>
      <svg className="rel-ico rel-go" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
    </button>
  );
}
