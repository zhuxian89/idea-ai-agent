import React, { useState } from "react";
import "../components/remoteui/remoteDesign.css";
import { RemoteTopBar, type RemoteTopBarProps } from "../components/remoteui/RemoteTopBar";
import { PhoneActivityHostContext } from "../components/remoteui/phoneSessionFacts";

type Side = {
  content?: React.ReactNode;
  open: boolean;
  width: string;
  toggleLabel: string;
  onToggle?: () => void;
};

type RemoteShellProps = {
  left: Side;
  right: Side;
  main: React.ReactNode;
  drawer?: React.ReactNode;
  footer: React.ReactNode;
  topBar: Pick<RemoteTopBarProps, "multiProjectSessionsEnabled" | "onMultiProjectSessionsChange" | "onOpenCollab" | "collabWaitingCount">;
  fileMenuWidth: string;
};

/**
 * 远程网页（电脑、平板）的外壳：顶部栏 + 左栏 + 对话区 + 右栏。
 * 与手机一致：对话区底部输入框上方显示独立的状态栏并承载边框流光（默认开启、可在设置中配置），
 * 外层对话面板不再套大框流光。
 * 左右两栏始终保持挂载，收起时只是宽度变 0，里面的状态不丢。
 */
export function RemoteShell({ left, right, main, drawer, footer, topBar, fileMenuWidth }: RemoteShellProps) {
  const [activityHost, setActivityHost] = useState<HTMLDivElement | null>(null);
  const style = {
    "--rd-left": left.open && left.content ? left.width : "0px",
    "--rd-right": right.open && right.content ? right.width : "0px",
    "--mindfs-actionbar-bottom-padding": "calc(var(--mindfs-safe-area-bottom) + 12px)",
    "--mindfs-file-menu-width": fileMenuWidth,
  } as React.CSSProperties;

  return (
    <div
      className="remote-shell"
      style={style}
      data-onboarding="shell"
      data-left-open={left.open && !!left.content}
      data-right-open={right.open && !!right.content}
    >
      <RemoteTopBar
        {...topBar}
        leftToggle={left.content ? { open: left.open, label: left.toggleLabel, onClick: left.onToggle } : null}
        rightToggle={right.content ? { open: right.open, label: right.toggleLabel, onClick: right.onToggle } : null}
      />
      {left.content ? (
        <aside className="remote-side remote-side-left" data-open={left.open} aria-hidden={!left.open}>{left.content}</aside>
      ) : null}
      <div className="remote-center">
        <main className="remote-main">
          <PhoneActivityHostContext.Provider value={activityHost}>{main}</PhoneActivityHostContext.Provider>
          {drawer}
        </main>
        <footer className="remote-footer" data-has-status="1">
          <div className="remote-status-activity remote-glow-frame" ref={setActivityHost} />
          {footer}
        </footer>
      </div>
      {right.content ? (
        <aside className="remote-side remote-side-right" data-open={right.open} aria-hidden={!right.open}>{right.content}</aside>
      ) : null}
    </div>
  );
}
