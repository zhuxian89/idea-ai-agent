import React from "react";
import { isRemoteWebUi } from "../../services/remoteUi";
import { AGENT_INSTALLATION_CHANGED } from "../../services/agentInstallation";
import type { useFileTreeMenus } from "./useFileTreeMenus";
import type { useAgentLifecycle } from "./useAgentLifecycle";
import type { FileTreeProps } from "../fileTreeModel";

type Deps = {
  fileTreeMenusApi: ReturnType<typeof useFileTreeMenus>;
  agentLifecycleApi: ReturnType<typeof useAgentLifecycle>;
  props: Required<Pick<FileTreeProps, "agentSettingsActive" | "agentSettingsOnly" | "agentsVersion">>;
};

export function useFileTreeMenuBehavior({ fileTreeMenusApi, agentLifecycleApi, props }: Deps) {
  const { isMenuOpen, menuRef, moreHost, protectedAPIReady, setIsMenuOpen } = fileTreeMenusApi;
  const { loadAgentLifecycleCatalog } = agentLifecycleApi;
  const { agentSettingsActive, agentSettingsOnly, agentsVersion } = props;

  const inPhoneMore = moreHost !== null;
  React.useLayoutEffect(() => {
    if (!isMenuOpen || !isRemoteWebUi || inPhoneMore) return;
    const menu = menuRef.current?.querySelector<HTMLElement>("[data-file-tree-menu]");
    const sidebar = menu?.closest(".workspace-projects");
    if (!menu || !sidebar) return;

    const viewport = window.visualViewport;
    const fitMenu = () => {
      const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      const bottom = Math.min(viewportBottom, sidebar.getBoundingClientRect().bottom);
      menu.style.maxHeight = `max(0px, calc(${bottom - menu.getBoundingClientRect().top - 8}px - env(safe-area-inset-bottom, 0px)))`;
    };
    fitMenu();
    const observer = new ResizeObserver(fitMenu);
    observer.observe(sidebar);
    viewport?.addEventListener("resize", fitMenu);
    return () => {
      observer.disconnect();
      viewport?.removeEventListener("resize", fitMenu);
    };
  }, [inPhoneMore, isMenuOpen]);
  React.useEffect(() => {
    if (!isMenuOpen || inPhoneMore) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    const menuItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[data-file-tree-menu] button:not(:disabled)") ?? [])
      .filter(button => button.getClientRects().length > 0);
    menuItems()[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!menuRef.current?.contains(document.activeElement)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setIsMenuOpen(false);
        menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        const buttons = menuItems();
        if (!buttons.length) return;
        event.preventDefault();
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].focus();
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [inPhoneMore, isMenuOpen]);
  React.useEffect(() => {
    if (!agentSettingsOnly || !protectedAPIReady) return;
    loadAgentLifecycleCatalog();
    window.addEventListener(AGENT_INSTALLATION_CHANGED, loadAgentLifecycleCatalog);
    return () => window.removeEventListener(AGENT_INSTALLATION_CHANGED, loadAgentLifecycleCatalog);
  }, [agentSettingsOnly, agentSettingsActive, agentsVersion, protectedAPIReady, loadAgentLifecycleCatalog]);

  return { inPhoneMore };
}
