import React, { useState, useEffect } from "react";
import { useI18n } from "../i18n";
import { IdeaWorkbench, type IdeaWorkbenchOptions } from "./IdeaWorkbench";
import { RemoteShell } from "./RemoteShell";
import { isRemoteWebUi } from "../services/remoteUi";
import { useRemoteDevice } from "../services/remoteDevice";
import { RemotePhoneShell, type RemotePhoneProps } from "./RemotePhoneShell";

type AppShellProps = {
  ideaWorkbench?: IdeaWorkbenchOptions;
  sidebar: React.ReactNode;
  main: React.ReactNode;
  rightSidebar?: React.ReactNode;
  footer: React.ReactNode;
  drawer?: React.ReactNode;
  leftOpen?: boolean;
  rightOpen?: boolean;
  onCloseLeft?: () => void;
  onCloseRight?: () => void;
  onOpenLeft?: () => void;
  onOpenRight?: () => void;
  sidebarsSwapped?: boolean;
  /** 远程网页新界面的顶部栏设置，仅在浏览器里的远程页面使用。 */
  remotePhoneProps?: RemotePhoneProps;
  remoteTopBar?: {
    multiProjectSessionsEnabled?: boolean;
    onMultiProjectSessionsChange?: (enabled: boolean) => void;
  };
};

const MOBILE_BREAKPOINT = 768;
const TABLET_BREAKPOINT = 1024;

function useResponsive() {
  const [isMobile, setIsMobile] = useState(false);
  const [isTablet, setIsTablet] = useState(false);
  useEffect(() => {
    const checkSize = () => {
      const width = window.innerWidth;
      setIsMobile(width < MOBILE_BREAKPOINT);
      setIsTablet(width >= MOBILE_BREAKPOINT && width < TABLET_BREAKPOINT);
    };
    checkSize();
    window.addEventListener("resize", checkSize);
    return () => window.removeEventListener("resize", checkSize);
  }, []);
  return { isMobile, isTablet };
}

const sidebarStyle: React.CSSProperties = {
  gridArea: "sidebar",
  borderRight: "1px solid var(--border-color)",
  overflow: "auto",
  background: "var(--mindfs-topbar-bg, var(--sidebar-bg))",
  display: "flex",
  flexDirection: "column",
  position: "relative",
  zIndex: 10,
  minWidth: 0,
};

const mainStyle: React.CSSProperties = {
  gridArea: "main",
  overflow: "hidden",
  padding: "0",
  background: "var(--mindfs-topbar-bg, var(--mobile-overlay-bg, var(--content-bg)))",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  position: "relative",
  zIndex: 1,
  contain: "paint",
};

const rightStyle: React.CSSProperties = {
  gridArea: "right",
  borderLeft: "1px solid var(--border-color)",
  overflow: "auto",
  background: "var(--mindfs-topbar-bg, var(--sidebar-bg))",
  display: "flex",
  flexDirection: "column",
  position: "relative",
  zIndex: 10,
  minWidth: 0,
};

const footerStyle: React.CSSProperties = {
  gridArea: "footer",
  borderTop: "none",
  padding: "0",
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  background: "var(--mindfs-topbar-bg, var(--mobile-overlay-bg, var(--content-bg)))",
  zIndex: 100,
  minWidth: 0,
};

export function AppShell({
  ideaWorkbench,
  sidebar,
  main,
  rightSidebar,
  footer,
  drawer,
  leftOpen = true,
  rightOpen = true,
  onCloseLeft,
  onCloseRight,
  onOpenLeft,
  onOpenRight,
  sidebarsSwapped = false,
  remoteTopBar,
  remotePhoneProps,
}: AppShellProps) {
  const { t } = useI18n();
  const viewport = useResponsive();
  const device = useRemoteDevice();
  const isMobile = device ? device === "phone" : viewport.isMobile;
  const isTablet = device ? device === "tablet" || viewport.isTablet : viewport.isTablet;

  const sidebarWidth = isMobile ? "0px" : (isTablet ? "200px" : "260px");
  const rightWidth = isMobile ? "0px" : (rightSidebar ? (isTablet ? "240px" : "280px") : "0px");
  const mobileHeight = "calc(var(--mindfs-viewport-height, 100dvh) - var(--remote-host-toolbar-height, 0px))";
  const physicalLeftOpen = sidebarsSwapped ? rightOpen : leftOpen;
  const physicalRightOpen = sidebarsSwapped ? leftOpen : rightOpen;
  const physicalLeftWidth = sidebarsSwapped ? rightWidth : sidebarWidth;
  const physicalRightWidth = sidebarsSwapped ? sidebarWidth : rightWidth;
  const physicalLeftContent = sidebarsSwapped ? rightSidebar : sidebar;
  const physicalRightContent = sidebarsSwapped ? sidebar : rightSidebar;
  const physicalLeftClose = sidebarsSwapped ? onCloseRight : onCloseLeft;
  const physicalLeftOpenHandler = sidebarsSwapped ? onOpenRight : onOpenLeft;
  const physicalRightClose = sidebarsSwapped ? onCloseLeft : onCloseRight;
  const physicalRightOpenHandler = sidebarsSwapped ? onOpenLeft : onOpenRight;
  const physicalLeftLabel = sidebarsSwapped ? t("sidebar.session") : t("sidebar.file");
  const physicalRightLabel = sidebarsSwapped ? t("sidebar.file") : t("sidebar.session");

  const shellStyle: React.CSSProperties & {
    "--mindfs-actionbar-bottom-padding"?: string;
    "--mindfs-file-menu-width"?: string;
  } = {
    display: isMobile ? "flex" : "grid",
    flexDirection: isMobile ? "column" : undefined,
    gridTemplateColumns: isMobile ? undefined : `${physicalLeftOpen ? physicalLeftWidth : "0px"} 1fr ${physicalRightOpen ? physicalRightWidth : "0px"}`,
    gridTemplateRows: isMobile ? undefined : "1fr auto",
    gridTemplateAreas: isMobile ? undefined : `"sidebar main right" "sidebar footer right"`,
    minHeight: isMobile ? mobileHeight : "calc(100vh - var(--remote-host-toolbar-height, 0px))",
    height: isMobile ? mobileHeight : "calc(100dvh - var(--remote-host-toolbar-height, 0px))",
    background: isMobile
      ? "var(--mindfs-topbar-bg, var(--mindfs-system-bar-bg, var(--mobile-overlay-bg, var(--content-bg))))"
      : "var(--bg-gradient-composite, var(--bg-gradient-start, #f3f4f6))",
    color: "var(--text-primary)",
    position: "relative",
    width: isMobile ? "100%" : undefined,
    maxWidth: isMobile ? "100%" : undefined,
    paddingTop: isMobile ? "var(--mindfs-safe-area-top, env(safe-area-inset-top, 0px))" : undefined,
    overflow: "hidden",
    isolation: "isolate",
    boxSizing: "border-box",
    transition: "grid-template-columns 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
    "--mindfs-actionbar-bottom-padding": "calc(var(--mindfs-safe-area-bottom) + 12px)",
    "--mindfs-file-menu-width": isMobile ? "52.5vw" : (isTablet ? "140px" : "182px"),
  };

  const mobileSidebarStyle = (side: 'left' | 'right'): React.CSSProperties => ({
    position: "fixed",
    top: "var(--mindfs-safe-area-top, env(safe-area-inset-top, 0px))",
    bottom: 0,
    [side]: 0,
    width: "75vw",
    zIndex: 2000,
    background: "var(--mindfs-topbar-bg, var(--mobile-sidebar-bg, var(--sidebar-bg)))",
    boxShadow: side === 'left' ? "4px 0 24px rgba(0,0,0,0.15)" : "-4px 0 24px rgba(0,0,0,0.15)",
    transition: "transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    borderTopRightRadius: side === 'left' ? "14px" : undefined,
    borderBottomRightRadius: side === 'left' ? "14px" : undefined,
    borderTopLeftRadius: side === 'right' ? "14px" : undefined,
    borderBottomLeftRadius: side === 'right' ? "14px" : undefined,
    willChange: "transform",
    backfaceVisibility: "hidden",
    transform: "translateX(0) translateZ(0)",
  });

  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.3)",
    zIndex: 1500,
    opacity: (isMobile && (leftOpen || rightOpen)) ? 1 : 0,
    pointerEvents: (isMobile && (leftOpen || rightOpen)) ? "auto" : "none",
    transition: "opacity 0.18s ease",
    willChange: "opacity",
    backfaceVisibility: "hidden",
    transform: "translateZ(0)",
  };

  const mobileFooterStyle: React.CSSProperties = {
    ...footerStyle,
    flexShrink: 0,
  };

  if (ideaWorkbench) {
    return <IdeaWorkbench {...ideaWorkbench} chat={main} history={rightSidebar} settings={sidebar} footer={footer} drawer={drawer}
      settingsOpen={leftOpen} historyOpen={rightOpen} onCloseSettings={onCloseLeft} onCloseHistory={onCloseRight} onOpenSettings={onOpenLeft} onOpenHistory={onOpenRight} />;
  }

  if (isRemoteWebUi && isMobile && remotePhoneProps) {
    return <RemotePhoneShell
      leftOpen={leftOpen}
      rightOpen={rightOpen}
      onProjects={() => { onCloseRight?.(); onOpenLeft?.(); }}
      onSessions={() => { onCloseLeft?.(); onOpenRight?.(); }}
      onChat={() => { onCloseLeft?.(); onCloseRight?.(); }}
      sidebar={sidebar}
      sessions={rightSidebar}
      main={main}
      footer={footer}
      drawer={drawer}
      phone={remotePhoneProps}
    />;
  }


  if (isRemoteWebUi && !isMobile) {
    return (
      <RemoteShell
        left={{ content: physicalLeftContent, open: physicalLeftOpen, width: physicalLeftWidth, toggleLabel: physicalLeftOpen ? t("sidebar.collapse", { label: physicalLeftLabel }) : t("sidebar.expand", { label: physicalLeftLabel }), onToggle: physicalLeftOpen ? physicalLeftClose : physicalLeftOpenHandler }}
        right={{ content: physicalRightContent, open: physicalRightOpen, width: physicalRightWidth, toggleLabel: physicalRightOpen ? t("sidebar.collapse", { label: physicalRightLabel }) : t("sidebar.expand", { label: physicalRightLabel }), onToggle: physicalRightOpen ? physicalRightClose : physicalRightOpenHandler }}
        main={main}
        drawer={drawer}
        footer={footer}
        topBar={remoteTopBar ?? {}}
        fileMenuWidth={isTablet ? "140px" : "182px"}
      />
    );
  }

  return (
    <div style={shellStyle} data-onboarding="shell">
      {isMobile && <div style={overlayStyle} onClick={() => { onCloseLeft?.(); onCloseRight?.(); }} />}

      {(!isMobile || physicalLeftOpen) && physicalLeftContent ? (
        <aside
          style={
            isMobile
              ? mobileSidebarStyle('left')
              : {
                  ...sidebarStyle,
                  overflow: physicalLeftOpen ? "auto" : "hidden",
                  pointerEvents: physicalLeftOpen ? "auto" : "none",
                }
          }
        >
          {physicalLeftContent}
        </aside>
      ) : null}

      <main
        style={
          isMobile
            ? {
                ...mainStyle,
                flex: 1,
                minHeight: 0,
                minWidth: 0,
              }
            : mainStyle
        }
      >
        {main}
        {/* 将抽屉层放入主视图内部，确保绝对定位时能精准对齐主视图宽度 */}
        {drawer}
      </main>

      {(!isMobile || physicalRightOpen) && physicalRightContent ? (
        <aside
          style={
            isMobile
              ? mobileSidebarStyle('right')
              : {
                  ...rightStyle,
                  overflow: physicalRightOpen ? "auto" : "hidden",
                  pointerEvents: physicalRightOpen ? "auto" : "none",
                }
          }
        >
          {physicalRightContent}
        </aside>
      ) : null}

      {!isMobile ? (
        <>
          <button
            type="button"
            className={`mindfs-sidebar-resize-rail mindfs-sidebar-resize-rail--left${physicalLeftOpen ? " is-open" : " is-closed"}`}
            onClick={physicalLeftOpen ? physicalLeftClose : physicalLeftOpenHandler}
            aria-label={physicalLeftOpen ? t("sidebar.collapse", { label: physicalLeftLabel }) : t("sidebar.expand", { label: physicalLeftLabel })}
            title={physicalLeftOpen ? t("sidebar.collapse", { label: physicalLeftLabel }) : t("sidebar.expand", { label: physicalLeftLabel })}
            style={{
              left: physicalLeftOpen ? `calc(${physicalLeftWidth} - 6px)` : 0,
              cursor: physicalLeftOpen ? "w-resize" : "e-resize",
            }}
          />
          {physicalRightContent ? (
            <button
              type="button"
              className={`mindfs-sidebar-resize-rail mindfs-sidebar-resize-rail--right${physicalRightOpen ? " is-open" : " is-closed"}`}
              onClick={physicalRightOpen ? physicalRightClose : physicalRightOpenHandler}
              aria-label={physicalRightOpen ? t("sidebar.collapse", { label: physicalRightLabel }) : t("sidebar.expand", { label: physicalRightLabel })}
              title={physicalRightOpen ? t("sidebar.collapse", { label: physicalRightLabel }) : t("sidebar.expand", { label: physicalRightLabel })}
              style={{
                right: physicalRightOpen ? `calc(${physicalRightWidth} - 6px)` : 0,
                cursor: physicalRightOpen ? "e-resize" : "w-resize",
              }}
            />
          ) : null}
        </>
      ) : null}

      <footer
        style={
          isMobile
            ? mobileFooterStyle
            : footerStyle
        }
      >
        {footer}
      </footer>
    </div>
  );
}
