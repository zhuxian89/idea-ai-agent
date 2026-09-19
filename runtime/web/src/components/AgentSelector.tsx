import React, {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
} from "react";
import { createPortal } from "react-dom";
import { AgentIcon } from "./AgentIcon";
import type { AgentStatus } from "../services/agents";
import { useI18n } from "../i18n";
import { AgentSetupGuide } from "./AgentSetupGuide";
import { AgentSelectorRow } from "./AgentSelectorRow";
import { AgentConnectionTest } from "./AgentConnectionTest";
import { agentSetupState, agentSetupStatusKey } from "../services/agentSetup";

type AgentSelectorProps = {
  agent: string;
  model?: string;
  mode?: string;
  effort?: string;
  fastService?: "" | "on" | "off";
  agents: AgentStatus[];
  onAgentChange: (agent: string, model?: string) => void;
  onModeChange?: (mode?: string) => void;
  onEffortChange?: (effort?: string) => void;
  onFastServiceChange?: (fastService?: "" | "on" | "off") => void;
  onAgentRestart?: (agent: string) => void | Promise<void>;
  compact?: boolean;
  warnUnavailable?: boolean;
  menuPlacement?: "top" | "bottom";
  showChevron?: boolean;
  showLabel?: boolean;
  defaultExpandOptions?: boolean;
  onboardingId?: string;
  viewportMenu?: boolean;
  stableLayout?: boolean;
  allowDefaultModel?: boolean;
  closeOnSelect?: boolean;
};

const AGENT_MENU_MAX_BODY_HEIGHT = 344;
const AGENT_MENU_HEADER_HEIGHT = 34;
const AGENT_MENU_ROW_HEIGHT = 40;
const AGENT_MENU_MIN_VISIBLE_ROWS = 3;
const AGENT_MENU_MIN_BODY_HEIGHT =
  AGENT_MENU_HEADER_HEIGHT +
  AGENT_MENU_ROW_HEIGHT * AGENT_MENU_MIN_VISIBLE_ROWS;

function AgentMenuPortal({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  if (enabled && typeof document !== "undefined") {
    return createPortal(children, document.body);
  }
  return <>{children}</>;
}

function hasAgentOptions(agent?: AgentStatus): boolean {
  return !!(
    agent &&
    ((agent.models?.length ?? 0) > 0 ||
      (agent.modes?.length ?? 0) > 0 ||
      (agent.efforts?.length ?? 0) > 0 ||
      agent.supports_fast_service)
  );
}

export function AgentSelector({
  agent,
  model = "",
  mode = "",
  effort = "",
  fastService = "",
  agents,
  onAgentChange,
  onModeChange,
  onEffortChange,
  onFastServiceChange,
  onAgentRestart,
  compact = false,
  warnUnavailable = false,
  menuPlacement = "top",
  showChevron = false,
  showLabel = false,
  defaultExpandOptions = false,
  onboardingId,
  viewportMenu = false,
  stableLayout = false,
  allowDefaultModel = false,
  closeOnSelect = true,
}: AgentSelectorProps) {
  const { t } = useI18n();
  const selectedAgentStatus = agents.find((item) => item.name === agent);
  const showUnavailableWarning = warnUnavailable && !selectedAgentStatus?.probe_pending;
  const selectedModelStatus = useMemo(() => {
    if (!selectedAgentStatus) return null;
    const fallbackModel =
      selectedAgentStatus.default_model_id ||
      selectedAgentStatus.current_model_id ||
      "";
    return (
      (selectedAgentStatus.models ?? []).find(
        (item) => item.id === (model || fallbackModel),
      ) ?? null
    );
  }, [selectedAgentStatus, model]);
  const selectedEfforts =
    selectedModelStatus?.efforts ?? selectedAgentStatus?.efforts ?? [];
  const showSelectedEffort =
    selectedEfforts.length > 0 && !!selectedModelStatus?.supportEffort;
  const selectedEffort = showSelectedEffort
    ? effort || selectedAgentStatus?.default_effort || "auto"
    : "";
  const selectedEffortLabel = selectedEffort;
  const [isOpen, setIsOpen] = useState(false);
  const [submenuAgent, setSubmenuAgent] = useState<string | null>(null);
  const [setupAgent, setSetupAgent] = useState<string | null>(null);
  const [modelSectionExpanded, setModelSectionExpanded] = useState(true);
  const [modeSectionExpanded, setModeSectionExpanded] = useState(false);
  const [effortSectionExpanded, setEffortSectionExpanded] = useState(false);
  const [serviceTierSectionExpanded, setServiceTierSectionExpanded] =
    useState(false);
  const [testingAgent, setTestingAgent] = useState<AgentStatus | null>(null);
  const [menuBodyHeight, setMenuBodyHeight] = useState<number | null>(null);
  const [menuHorizontalOffset, setMenuHorizontalOffset] = useState(0);
  const [viewportMenuPosition, setViewportMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const agentColumnRef = useRef<HTMLDivElement>(null);
  const submenuAgentStatus = useMemo(
    () => agents.find((item) => item.name === submenuAgent) ?? null,
    [agents, submenuAgent],
  );
  const setupAgentStatus = useMemo(
    () => agents.find((item) => item.name === setupAgent) ?? null,
    [agents, setupAgent],
  );
  const submenuModels = useMemo(
    () => submenuAgentStatus?.models ?? [],
    [submenuAgentStatus],
  );
  const submenuSelectedModel = useMemo(() => {
    if (!submenuAgentStatus) return null;
    const fallbackModel =
      submenuAgentStatus.default_model_id ||
      submenuAgentStatus.current_model_id ||
      "";
    const targetModel =
      submenuAgentStatus.name === agent
        ? model || fallbackModel
        : fallbackModel;
    return (
      (submenuAgentStatus.models ?? []).find(
        (item) => item.id === targetModel,
      ) ?? null
    );
  }, [submenuAgentStatus, agent, model]);
  const submenuEfforts = useMemo(
    () => submenuSelectedModel?.efforts ?? submenuAgentStatus?.efforts ?? [],
    [submenuAgentStatus, submenuSelectedModel],
  );
  const submenuModes = useMemo(
    () => submenuAgentStatus?.modes ?? [],
    [submenuAgentStatus],
  );
  const displayedMode = useMemo(() => {
    if (!submenuAgentStatus) return "";
    const fallbackMode = submenuAgentStatus.current_mode_id || "";
    return submenuAgentStatus.name === agent
      ? mode || fallbackMode
      : fallbackMode;
  }, [submenuAgentStatus, agent, mode]);
  const submenuIsCodex = submenuAgentStatus?.name === "codex";
  const submenuSupportsEffort = useMemo(
    () => submenuEfforts.length > 0 && !!submenuSelectedModel?.supportEffort,
    [submenuEfforts, submenuSelectedModel],
  );
  const submenuSupportsServiceTier =
    !!submenuAgentStatus?.supports_fast_service;
  const fallbackEffort = submenuAgentStatus?.default_effort || "";
  const displayedEffort = submenuIsCodex
    ? effort || fallbackEffort || "Auto"
    : effort || fallbackEffort || "Auto";
  const fallbackFastService = submenuAgentStatus?.default_fast_service || "";
  const fastModeEnabled =
    (submenuAgentStatus?.name === agent ? fastService : fallbackFastService) ===
    "on";
  const buttonTitle = useMemo(() => {
    if (showUnavailableWarning) {
      return t("agent.currentUnavailable", { name: agent });
    }
    if (agent) {
      const modelLabel = model || t("agent.defaultModel");
      return selectedEffortLabel
        ? `${agent} · ${modelLabel} · ${t("agent.effort")}: ${selectedEffortLabel}`
        : `${agent} · ${modelLabel}`;
    }
    return undefined;
  }, [agent, model, selectedEffortLabel, t, showUnavailableWarning]);

  useEffect(() => {
    const handlePointerOutside = (e: PointerEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        !menuRef.current?.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setSubmenuAgent(null);
        setSetupAgent(null);
        setModelSectionExpanded(true);
        setModeSectionExpanded(false);
        setEffortSectionExpanded(false);
        setServiceTierSectionExpanded(false);
        setMenuBodyHeight(null);
      }
    };
    if (isOpen && !testingAgent) {
      const handleEscape = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        setIsOpen(false);
        dropdownRef.current?.querySelector("button")?.focus();
      };
      document.addEventListener("pointerdown", handlePointerOutside);
      document.addEventListener("keydown", handleEscape);
      return () => {
        document.removeEventListener("pointerdown", handlePointerOutside);
        document.removeEventListener("keydown", handleEscape);
      };
    }
  }, [isOpen, testingAgent]);

  useEffect(() => {
    if (!isOpen || submenuAgent) {
      return;
    }
    const node = agentColumnRef.current;
    if (!node) {
      return;
    }
    setMenuBodyHeight(
      Math.min(
        AGENT_MENU_MAX_BODY_HEIGHT,
        Math.max(node.scrollHeight, AGENT_MENU_MIN_BODY_HEIGHT),
      ),
    );
  }, [isOpen, submenuAgent, agents]);

  useLayoutEffect(() => {
    if (!isOpen || !menuRef.current) {
      return;
    }

    if (viewportMenu) {
      const updatePosition = () => {
        const anchor = dropdownRef.current?.getBoundingClientRect();
        const menu = menuRef.current?.getBoundingClientRect();
        if (!anchor || !menu) return;
        const viewport = window.visualViewport;
        const viewportLeft = viewport?.offsetLeft ?? 0;
        const viewportTop = viewport?.offsetTop ?? 0;
        const viewportWidth = viewport?.width ?? window.innerWidth;
        const viewportHeight = viewport?.height ?? window.innerHeight;
        const margin = 8;
        const maxLeft = viewportLeft + viewportWidth - menu.width - margin;
        const left = Math.max(viewportLeft + margin, Math.min(anchor.left, maxLeft));
        const below = anchor.bottom + 8;
        const above = anchor.top - menu.height - 8;
        const top = menuPlacement === "bottom" && below + menu.height <= viewportTop + viewportHeight - margin
          ? below
          : Math.max(viewportTop + margin, above);
        setViewportMenuPosition((current) =>
          current && Math.abs(current.top - top) < 0.5 && Math.abs(current.left - left) < 0.5
            ? current
            : { top, left },
        );
      };
      updatePosition();
      const observer = new ResizeObserver(updatePosition);
      observer.observe(menuRef.current);
      if (dropdownRef.current) observer.observe(dropdownRef.current);
      window.addEventListener("resize", updatePosition);
      window.addEventListener("scroll", updatePosition, true);
      window.visualViewport?.addEventListener("resize", updatePosition);
      window.visualViewport?.addEventListener("scroll", updatePosition);
      return () => {
        observer.disconnect();
        window.removeEventListener("resize", updatePosition);
        window.removeEventListener("scroll", updatePosition, true);
        window.visualViewport?.removeEventListener("resize", updatePosition);
        window.visualViewport?.removeEventListener("scroll", updatePosition);
      };
    }

    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth);
    const margin = 8;
    const rect = menuRef.current.getBoundingClientRect();
    let correction = 0;

    if (rect.left < viewportLeft + margin) {
      correction = viewportLeft + margin - rect.left;
    }
    if (rect.right + correction > viewportRight - margin) {
      correction -= rect.right + correction - (viewportRight - margin);
    }

    if (Math.abs(correction) > 0.5) {
      setMenuHorizontalOffset((current) => current + correction);
    }
  }, [
    setupAgent,
    isOpen,
    menuBodyHeight,
    menuHorizontalOffset,
    menuPlacement,
    submenuAgent,
    viewportMenu,
  ]);

  const handleAgentSelect = useCallback(
    (newAgent: string, nextModel?: string) => {
      onAgentChange(newAgent, nextModel);
      if (!closeOnSelect) {
        const next = agents.find((item) => item.name === newAgent);
        const hasError = next && agentSetupState(next) !== "ready";
        setSetupAgent(hasError ? newAgent : null);
        setSubmenuAgent(!hasError && hasAgentOptions(next) ? newAgent : null);
        if (submenuAgent !== newAgent) {
          setModelSectionExpanded(true);
          setModeSectionExpanded(false);
          setEffortSectionExpanded(false);
          setServiceTierSectionExpanded(false);
        }
        return;
      }
      setIsOpen(false);
      setSubmenuAgent(null);
      setSetupAgent(null);
      setModelSectionExpanded(true);
      setModeSectionExpanded(false);
      setEffortSectionExpanded(false);
      setServiceTierSectionExpanded(false);
    },
    [onAgentChange, closeOnSelect, agents, submenuAgent],
  );

  const handleAgentRowClick = useCallback(
    (entry: AgentStatus) => {
      if (agentSetupState(entry) !== "ready") {
        setSubmenuAgent(null);
        setSetupAgent(entry.name);
        return;
      }
      setSetupAgent(null);
      if (!closeOnSelect && entry.name === agent) {
        const hasError = agentSetupState(entry) !== "ready";
        setSetupAgent(hasError ? entry.name : null);
        setSubmenuAgent(!hasError && hasAgentOptions(entry) ? entry.name : null);
        return;
      }
      handleAgentSelect(
        entry.name,
        allowDefaultModel
          ? ""
          : entry.default_model_id || entry.current_model_id || "",
      );
    },
    [allowDefaultModel, handleAgentSelect, closeOnSelect, agent],
  );

  const handleSubmenuToggle = useCallback((entry: AgentStatus) => {
    if (
      (entry.models?.length ?? 0) === 0 &&
      (entry.modes?.length ?? 0) === 0 &&
      (entry.efforts?.length ?? 0) === 0 &&
      !entry.supports_fast_service
    ) {
      return;
    }
    setSetupAgent(null);
    setModelSectionExpanded(true);
    setModeSectionExpanded(false);
    setEffortSectionExpanded(false);
    setServiceTierSectionExpanded(false);
    const node = agentColumnRef.current;
    if (node) {
      setMenuBodyHeight(
        Math.min(
          AGENT_MENU_MAX_BODY_HEIGHT,
          Math.max(node.scrollHeight, AGENT_MENU_MIN_BODY_HEIGHT),
        ),
      );
    }
    setSubmenuAgent((prev) => (prev === entry.name ? null : entry.name));
  }, []);

  const handleEffortSelect = useCallback(
    (nextEffort: string) => {
      onEffortChange?.(nextEffort);
      if (!closeOnSelect) return;
      setIsOpen(false);
      setSubmenuAgent(null);
      setSetupAgent(null);
      setModelSectionExpanded(true);
      setModeSectionExpanded(false);
      setEffortSectionExpanded(false);
      setServiceTierSectionExpanded(false);
      setMenuBodyHeight(null);
    },
    [onEffortChange, closeOnSelect],
  );

  const handleServiceTierSelect = useCallback(
    (nextFastService: "" | "on" | "off") => {
      onFastServiceChange?.(nextFastService);
      if (!closeOnSelect) return;
      setIsOpen(false);
      setSubmenuAgent(null);
      setSetupAgent(null);
      setModelSectionExpanded(true);
      setModeSectionExpanded(false);
      setEffortSectionExpanded(false);
      setServiceTierSectionExpanded(false);
      setMenuBodyHeight(null);
    },
    [onFastServiceChange, closeOnSelect],
  );

  const handleModeSelect = useCallback(
    (nextMode: string) => {
      if (submenuAgentStatus && submenuAgentStatus.name !== agent) {
        onAgentChange(submenuAgentStatus.name);
      }
      onModeChange?.(nextMode);
      if (!closeOnSelect) return;
      setIsOpen(false);
      setSubmenuAgent(null);
      setSetupAgent(null);
      setModelSectionExpanded(true);
      setModeSectionExpanded(false);
      setEffortSectionExpanded(false);
      setServiceTierSectionExpanded(false);
      setMenuBodyHeight(null);
    },
    [submenuAgentStatus, agent, onAgentChange, onModeChange, closeOnSelect],
  );

  const bodyHeight = setupAgentStatus ? Math.max(menuBodyHeight || 0, 300) : menuBodyHeight;

  return (
    <div ref={dropdownRef} data-onboarding={onboardingId} style={{ position: "relative" }}>
      <style>{`
        @keyframes agent-refresh-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      <button
        type="button"
        onClick={() => {
          setIsOpen((prev) => {
            const next = !prev;
            if (next) {
              setMenuHorizontalOffset(0);
              const selectedAgent = agents.find((item) => item.name === agent) || agents[0];
              const selectedHasError = selectedAgent && agentSetupState(selectedAgent) !== "ready";
              setSubmenuAgent(
                !selectedHasError && defaultExpandOptions && hasAgentOptions(selectedAgent)
                  ? agent
                  : null,
              );
              setSetupAgent(selectedHasError ? selectedAgent.name : null);
              setModelSectionExpanded(true);
              setModeSectionExpanded(false);
              setEffortSectionExpanded(false);
              setServiceTierSectionExpanded(false);
              setMenuBodyHeight(null);
            } else {
              setMenuHorizontalOffset(0);
              setSubmenuAgent(null);
              setSetupAgent(null);
              setModelSectionExpanded(true);
              setModeSectionExpanded(false);
              setEffortSectionExpanded(false);
              setServiceTierSectionExpanded(false);
              setMenuBodyHeight(null);
            }
            return next;
          });
        }}
        title={buttonTitle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          padding: compact ? "4px 4px" : "6px 8px",
          borderRadius: "12px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          fontSize: "16px",
          transition: "background 0.2s",
          outline: "none",
          position: "relative",
        }}
        onMouseEnter={(e) => {
          if (compact) e.currentTarget.style.background = "rgba(0,0,0,0.05)";
        }}
        onMouseLeave={(e) => {
          if (compact) e.currentTarget.style.background = "transparent";
        }}
      >
        <AgentIcon
          agentName={agent}
          style={{ width: "16px", height: "16px" }}
        />
        {showLabel ? (
          <span className="idea-agent-selector-label">
            <span className="idea-agent-selector-model">
              {agent === "claude" ? "Claude Code" : agent === "codex" ? "Codex" : agent} · {model || t("agent.defaultModel")}
            </span>
            {selectedEffortLabel ? (
              <span className="idea-agent-selector-effort">
                {t("agent.effortShort", { effort: selectedEffortLabel })}
              </span>
            ) : null}
          </span>
        ) : null}
        {showChevron ? (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ color: "var(--text-secondary)" }}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        ) : null}
        {showUnavailableWarning && (
          <span
            style={{
              color: "var(--text-secondary)",
              fontSize: "11px",
              whiteSpace: "nowrap",
            }}
          >
            {t(agentSetupStatusKey(selectedAgentStatus))}
          </span>
        )}
      </button>

      {testingAgent ? <AgentConnectionTest agent={testingAgent} onClose={() => setTestingAgent(null)} /> : null}
      {isOpen && (
        <AgentMenuPortal enabled={viewportMenu}>
          <div
            ref={menuRef}
            data-agent-menu="true"
            className={stableLayout ? "idea-agent-menu" : undefined}
            style={{
            position: viewportMenu ? "fixed" : "absolute",
            ...(viewportMenu
              ? {
                  top: viewportMenuPosition?.top ?? 0,
                  left: viewportMenuPosition?.left ?? 0,
                  visibility: viewportMenuPosition ? "visible" : "hidden",
                }
              : menuPlacement === "bottom"
                ? { top: "calc(100% + 8px)", right: 0 }
                : { bottom: "calc(100% + 8px)", right: 0 }),
            background: "var(--menu-bg)",
            border: "1px solid var(--menu-border)",
            borderRadius: "12px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
            zIndex: 1000,
            width: stableLayout ? "min(376px, calc(100vw - 16px))" : "max-content",
            minWidth: "0",
            maxWidth: "calc(100vw - 16px)",
            boxSizing: "border-box",
            padding: "8px 0",
            display: "flex",
            alignItems: "stretch",
            height: bodyHeight ? `${bodyHeight + 16}px` : "auto",
            maxHeight: stableLayout ? "min(360px, calc(100dvh - 16px))" : "360px",
            transform:
              viewportMenu || menuHorizontalOffset === 0
                ? undefined
                : `translateX(${menuHorizontalOffset}px)`,
            }}
          >
          <div
            ref={agentColumnRef}
            style={{
              width: stableLayout ? "40%" : "fit-content",
              flexShrink: stableLayout ? 0 : undefined,
              minWidth: "0",
              maxWidth:
                stableLayout ? "none" : submenuAgentStatus || setupAgentStatus
                  ? "min(44vw, 180px)"
                  : "min(72vw, 180px)",
              height: bodyHeight ? `${bodyHeight}px` : "auto",
              maxHeight: stableLayout ? "100%" : `${AGENT_MENU_MAX_BODY_HEIGHT}px`,
              minHeight: 0,
              overflowY: "auto",
            }}
          >
            <div
              style={{
                padding: "6px 12px",
                fontSize: "11px",
                fontWeight: 600,
                color: "var(--text-secondary)",
                textTransform: "uppercase",
              }}
            >
              Agent
            </div>
            {agents.map((a) => <AgentSelectorRow key={a.name} agent={a}
              active={submenuAgent === a.name || setupAgent === a.name || (!submenuAgent && !setupAgent && a.name === agent)}
              expanded={submenuAgent === a.name || (agentSetupState(a) !== "ready" && setupAgent === a.name)}
              hasOptions={hasAgentOptions(a)}
              onSelect={() => handleAgentRowClick(a)}
              onExpand={() => handleSubmenuToggle(a)} />)}
          </div>

          <div
            style={{
              width:
                stableLayout ? "60%" : submenuAgentStatus || setupAgentStatus ? "fit-content" : "0",
              flexShrink: stableLayout ? 0 : undefined,
              minWidth: submenuAgentStatus || setupAgentStatus ? "0" : "0",
              maxWidth:
                stableLayout ? "none" : submenuAgentStatus || setupAgentStatus
                  ? "min(40vw, 180px)"
                  : "0",
              borderLeft:
                stableLayout || submenuAgentStatus || setupAgentStatus
                  ? "1px solid var(--menu-divider)"
                  : "none",
              height: bodyHeight ? `${bodyHeight}px` : "auto",
              maxHeight: stableLayout ? "100%" : `${AGENT_MENU_MAX_BODY_HEIGHT}px`,
              minHeight: 0,
              overflowY: "auto",
              overflowX: "hidden",
              transition: stableLayout ? undefined : "width 0.16s ease, border-left-color 0.16s ease",
              boxSizing: "border-box",
            }}
          >
            {stableLayout && !submenuAgentStatus && !setupAgentStatus ? <p style={{ margin: 0, padding: "12px", fontSize: "12px", lineHeight: 1.6, color: "var(--text-secondary)" }}>{selectedAgentStatus?.probe_pending ? t("agent.discoveryHint") : t("agent.selectOptionsHint")}</p> : null}
            {setupAgentStatus ? (
              <div style={{ padding: "12px" }}>
                <AgentSetupGuide key={setupAgentStatus.name} agent={setupAgentStatus}
                  onProbe={onAgentRestart}
                  onTest={() => setTestingAgent(setupAgentStatus)}
                  onContinue={() => {
                    setSetupAgent(null);
                    if (hasAgentOptions(setupAgentStatus) || allowDefaultModel) {
                      setSubmenuAgent(setupAgentStatus.name);
                      setModelSectionExpanded(true);
                    } else handleAgentRowClick(setupAgentStatus);
                  }} />
              </div>
            ) : submenuAgentStatus ? (
              <>
                <SectionHeader
                  title={t("agent.model")}
                  expanded={modelSectionExpanded}
                  onToggle={() => setModelSectionExpanded((prev) => !prev)}
                  value={
                    allowDefaultModel && submenuAgentStatus.name === agent && !model
                      ? t("agent.defaultModel")
                      : submenuSelectedModel?.id || undefined
                  }
                />
                {modelSectionExpanded ? (
                  <>
                    {allowDefaultModel ? (
                      <button
                        type="button"
                        onClick={() => handleAgentSelect(submenuAgentStatus.name, "")}
                        style={sectionItemStyle(
                          submenuAgentStatus.name === agent && !model,
                          false,
                        )}
                      >
                        <span style={{ fontSize: "13px", fontWeight: 500 }}>
                          {t("agent.defaultModel")}
                        </span>
                        <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                          {t("agent.defaultModelDescription")}
                        </span>
                      </button>
                    ) : null}
                    {submenuModels.map((item, index) => {
                      const isSelected =
                        submenuAgentStatus.name === agent &&
                        !!model &&
                        item.id === (submenuSelectedModel?.id || "");
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() =>
                            handleAgentSelect(submenuAgentStatus.name, item.id)
                          }
                          style={sectionItemStyle(
                            isSelected,
                            allowDefaultModel || index > 0,
                            item.hidden ? 0.66 : 1,
                          )}
                          title={item.description || item.id}
                        >
                          <span style={{ fontSize: "13px", fontWeight: 500 }}>
                            {item.name || item.id}
                          </span>
                          {item.description ? (
                            <span
                              style={{
                                fontSize: "11px",
                                color: "var(--text-secondary)",
                                whiteSpace: "normal",
                                overflowWrap: "anywhere",
                                wordBreak: "break-word",
                              }}
                            >
                              {item.description}
                            </span>
                          ) : item.hidden ? (
                            <span
                              style={{
                                fontSize: "11px",
                                color: "var(--text-secondary)",
                              }}
                            >
                              hidden
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </>
                ) : null}
                {submenuModes.length > 0 ? (
                  <>
                    <SectionHeader
                      title={t("agent.mode")}
                      expanded={modeSectionExpanded}
                      onToggle={() => setModeSectionExpanded((prev) => !prev)}
                      topBorder={
                        modelSectionExpanded ||
                        submenuModels.length > 0 ||
                        !!submenuSelectedModel?.id
                      }
                      value={displayedMode || undefined}
                    />
                    {modeSectionExpanded ? (
                      <>
                        {submenuModes.map((item, index) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => handleModeSelect(item.id)}
                            style={sectionItemStyle(
                              item.id === displayedMode,
                              index > 0,
                            )}
                            title={item.description || item.id}
                          >
                            <span style={{ fontSize: "13px", fontWeight: 500 }}>
                              {item.name || item.id}
                            </span>
                            {item.description ? (
                              <span
                                style={{
                                  fontSize: "11px",
                                  color: "var(--text-secondary)",
                                  whiteSpace: "normal",
                                  overflowWrap: "anywhere",
                                  wordBreak: "break-word",
                                }}
                              >
                                {item.description}
                              </span>
                            ) : null}
                          </button>
                        ))}
                      </>
                    ) : null}
                  </>
                ) : null}
                {submenuSupportsEffort ? (
                  <>
                    <SectionHeader
                      title={t("agent.effort")}
                      expanded={effortSectionExpanded}
                      onToggle={() => setEffortSectionExpanded((prev) => !prev)}
                      topBorder={
                        modelSectionExpanded ||
                        submenuModels.length > 0 ||
                        !!submenuSelectedModel?.id ||
                        submenuModes.length > 0
                      }
                      value={displayedEffort}
                    />
                    {effortSectionExpanded ? (
                      <>
                        {submenuEfforts.map((item, index) => (
                          <button
                            key={item}
                            type="button"
                            onClick={() => handleEffortSelect(item)}
                            style={sectionItemStyle(
                              item === displayedEffort.toLowerCase(),
                              index > 0,
                            )}
                          >
                            <span
                              style={{
                                fontSize: "13px",
                                fontWeight: 500,
                                textTransform: "capitalize",
                              }}
                            >
                              {item}
                            </span>
                          </button>
                        ))}
                      </>
                    ) : null}
                  </>
                ) : null}
                {submenuSupportsServiceTier ? (
                  <>
                    <SectionHeader
                      title={t("agent.fastMode")}
                      expanded={serviceTierSectionExpanded}
                      onToggle={() =>
                        setServiceTierSectionExpanded((prev) => !prev)
                      }
                      topBorder={
                        modelSectionExpanded ||
                        submenuModels.length > 0 ||
                        !!submenuSelectedModel?.id ||
                        submenuModes.length > 0 ||
                        submenuSupportsEffort
                      }
                      value={fastModeEnabled ? t("agent.enabled") : t("agent.disabled")}
                    />
                    {serviceTierSectionExpanded ? (
                      <>
                        {(["off", "on"] as const).map((item, index) => (
                          <button
                            key={item}
                            type="button"
                            onClick={() => handleServiceTierSelect(item)}
                            style={sectionItemStyle(
                              (item === "on") === fastModeEnabled,
                              index > 0,
                            )}
                          >
                            <span
                              style={{
                                fontSize: "13px",
                                fontWeight: 500,
                              }}
                            >
                              {item === "on" ? t("agent.enabled") : t("agent.disabled")}
                            </span>
                          </button>
                        ))}
                      </>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
          </div>
          </div>
        </AgentMenuPortal>
      )}
    </div>
  );
}

function SectionHeader({
  title,
  expanded,
  onToggle,
  topBorder = false,
  value,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  topBorder?: boolean;
  value?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        minWidth: 0,
        padding: "10px 12px",
        border: "none",
        borderTop: topBorder ? "1px solid var(--menu-divider)" : "none",
        background: expanded ? "rgba(59, 130, 246, 0.05)" : "transparent",
        color: "var(--text-primary)",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          flex: "0 1 auto",
          minWidth: 0,
          maxWidth: "45%",
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: expanded ? "#3b82f6" : "var(--text-secondary)",
          whiteSpace: "normal",
          overflowWrap: "anywhere",
        }}
      >
        {title}
      </span>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: "8px",
          flex: "1 1 auto",
          minWidth: 0,
          marginLeft: "8px",
        }}
      >
        {value ? (
          <span
            title={value}
            style={{
              minWidth: 0,
              fontSize: "11px",
              color: "var(--text-secondary)",
              whiteSpace: "normal",
              maxWidth: "100%",
              overflowWrap: "anywhere",
              textAlign: "right",
            }}
          >
            {value}
          </span>
        ) : null}
        <SelectorChevron expanded={expanded} />
      </span>
    </button>
  );
}

function SelectorChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      style={{
        flexShrink: 0,
        color: expanded ? "#3b82f6" : "#9ca3af",
        transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 0.16s ease",
      }}
    >
      <path
        d="M4 2.5 8 6 4 9.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function sectionItemStyle(
  selected: boolean,
  topBorder = false,
  opacity = 1,
): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "2px",
    width: "100%",
    minWidth: 0,
    padding: "10px 12px",
    border: "none",
    borderTop: topBorder ? "1px solid var(--menu-divider)" : "none",
    background: selected ? "rgba(59, 130, 246, 0.08)" : "transparent",
    color: selected ? "#3b82f6" : "var(--text-primary)",
    textAlign: "left",
    cursor: "pointer",
    opacity,
  };
}
