import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/types";
import {
  EXPANDED_POLL_MS,
  fetchSystemStats,
  formatGB,
  loadLevel,
  pollDelay,
  pushHistory,
  retryDelay,
  sparkPaths,
  type HistoryPoint,
  type LoadLevel,
  type SystemStats,
} from "../services/systemStats";
import "./systemMonitor.css";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;
const SPARK_W = 260;
const SPARK_H = 44;

function Ring({ percent }: { percent: number }) {
  return (
    <svg className="sysmon-ring" viewBox="0 0 36 36" aria-hidden="true">
      <circle className="track" cx="18" cy="18" r="15.9155" pathLength={100} />
      <circle className="prog" cx="18" cy="18" r="15.9155" pathLength={100} strokeDasharray={`${percent} 100`} />
    </svg>
  );
}

function ChipGlyph({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </svg>
  );
}

function MemoryGlyph({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="6" width="20" height="9" rx="1.8" />
      <path d="M6 15v3M10 15v3M14 15v3M18 15v3M6 10.5h2.2M10.9 10.5h2.2M15.8 10.5h2.2" />
    </svg>
  );
}

function CardItem({ kind, percent, loading, t }: { kind: "cpu" | "mem"; percent: number; loading: boolean; t: Translate }) {
  const level: LoadLevel = loading ? "ok" : loadLevel(percent);
  const Glyph = kind === "cpu" ? ChipGlyph : MemoryGlyph;
  return (
    <span className="sysmon-item" data-lv={level} data-kind={kind}>
      <span className="sysmon-rg">
        <Ring percent={loading ? 0 : percent} />
        <Glyph className="sysmon-glyph" />
      </span>
      <span className="sysmon-tx">
        <span className="sysmon-name">{t(kind === "cpu" ? "sysmon.cpu" : "sysmon.mem")}</span>
        <span className="sysmon-val">{loading ? "--" : `${Math.round(percent)}%`}</span>
      </span>
    </span>
  );
}

function Spark({ points, now, id, label, t }: { points: HistoryPoint[]; now: number; id: string; label: string; t: Translate }) {
  const { line, area } = sparkPaths(points, now, SPARK_W, SPARK_H);
  return (
    <>
      <div className="sysmon-spark">
        <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" role="img" aria-label={label}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: "var(--sm-c)", stopOpacity: 0.3 }} />
              <stop offset="1" style={{ stopColor: "var(--sm-c)", stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          {area ? <path d={area} style={{ fill: `url(#${id})` }} /> : null}
          {line ? <path className="line" d={line} /> : null}
        </svg>
      </div>
      <div className="sysmon-axis">
        <span>{t("sysmon.ago")}</span>
        <span>{t("sysmon.now")}</span>
      </div>
    </>
  );
}

function Details({ stats, cpuHistory, memHistory, now, uid, t }: { stats: SystemStats; cpuHistory: HistoryPoint[]; memHistory: HistoryPoint[]; now: number; uid: string; t: Translate }) {
  const cpuLevel = loadLevel(stats.cpu_percent);
  const memLevel = loadLevel(stats.mem_percent);
  const worst: LoadLevel = cpuLevel === "crit" || memLevel === "crit" ? "crit" : cpuLevel === "warn" || memLevel === "warn" ? "warn" : "ok";
  return (
    <>
      <div className="sysmon-head">
        <div className="sysmon-pop-h">
          <b>{t("sysmon.title")}</b>
          <span className="sysmon-live"><i />{t("sysmon.live", { seconds: EXPANDED_POLL_MS / 1000 })}</span>
        </div>
        {stats.host ? <span className="sysmon-host" title={stats.host}>{stats.host}</span> : null}
      </div>
      {worst !== "ok" ? (
        <div className="sysmon-warn" data-k={worst} role="status">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 2.5 20h19L12 4zM12 10v4M12 17h.01" /></svg>
          <span>{t(worst === "crit" ? "sysmon.crit" : "sysmon.warn")}</span>
        </div>
      ) : null}
      <div className="sysmon-blk" data-lv={cpuLevel}>
        <div className="sysmon-big">
          <Ring percent={stats.cpu_percent} />
          <span className="sysmon-num">{Math.round(stats.cpu_percent)}<small>%</small></span>
        </div>
        <div className="sysmon-meta">
          <h4><ChipGlyph className="sysmon-h-glyph" />{t("sysmon.processor")}</h4>
          <p>{t("sysmon.cores", { cores: stats.cpu_cores, percent: Math.round(stats.cpu_percent) })}</p>
        </div>
        <Spark points={cpuHistory} now={now} id={`${uid}-cpu`} label={t("sysmon.chartCpu")} t={t} />
      </div>
      <div className="sysmon-blk" data-lv={memLevel}>
        <div className="sysmon-big">
          <Ring percent={stats.mem_percent} />
          <span className="sysmon-num">{Math.round(stats.mem_percent)}<small>%</small></span>
        </div>
        <div className="sysmon-meta">
          <h4><MemoryGlyph className="sysmon-h-glyph" />{t("sysmon.memory")}</h4>
          <p>{t("sysmon.memUsed", { used: formatGB(stats.mem_used), total: formatGB(stats.mem_total) })}</p>
          <p>{t("sysmon.memFree", { free: formatGB(Math.max(0, stats.mem_total - stats.mem_used)) })}</p>
        </div>
        <Spark points={memHistory} now={now} id={`${uid}-mem`} label={t("sysmon.chartMem")} t={t} />
      </div>
      <p className="sysmon-note">{t("sysmon.note")}</p>
    </>
  );
}

export type SystemMonitorViewProps = {
  /** 还没有读到数据时为 null，显示读取中。 */
  stats: SystemStats | null;
  cpuHistory: HistoryPoint[];
  memHistory: HistoryPoint[];
  now: number;
  expanded: boolean;
  onToggle: () => void;
  t: Translate;
  /** 用于渐变的 id 前缀，同一页面有多个实例时避免冲突。 */
  uid: string;
};

/** 纯展示：卡片与详情。轮询和展开状态在 SystemMonitor 里。 */
export function SystemMonitorView({ stats, cpuHistory, memHistory, now, expanded, onToggle, t, uid }: SystemMonitorViewProps) {
  const loading = stats === null;
  const label = loading
    ? t("sysmon.loading")
    : t("sysmon.summary", { cpu: Math.round(stats.cpu_percent), mem: Math.round(stats.mem_percent) });
  return (
    <div className="sysmon" data-sysmon>
      <button
        type="button"
        className="sysmon-card"
        data-state={loading ? "loading" : "ready"}
        aria-haspopup="dialog"
        aria-expanded={expanded && !loading}
        aria-label={label}
        onClick={onToggle}
      >
        <CardItem kind="cpu" percent={stats?.cpu_percent ?? 0} loading={loading} t={t} />
        <span className="sysmon-sep" aria-hidden="true" />
        <CardItem kind="mem" percent={stats?.mem_percent ?? 0} loading={loading} t={t} />
      </button>
      {expanded && !loading ? (
        <div className="sysmon-pop" role="dialog" aria-label={t("sysmon.title")}>
          <Details stats={stats} cpuHistory={cpuHistory} memHistory={memHistory} now={now} uid={uid} t={t} />
        </div>
      ) : null}
    </div>
  );
}

type Reading = { stats: SystemStats | null; cpu: HistoryPoint[]; mem: HistoryPoint[]; failed: boolean };

/**
 * 读取这台电脑的负载。详情展开时每 2 秒一次，收起时 5 秒一次；页面在后台时停止，回到前台立即补一次。
 * 读取失败（旧版后台没有接口、公网暂时不通）时不显示，隔 30 秒再试，不弹错误。
 */
export function useSystemStats(expanded: boolean): Reading {
  const [reading, setReading] = useState<Reading>({ stats: null, cpu: [], mem: [], failed: false });
  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      if (!disposed) timer = window.setTimeout(poll, delay);
    };
    const poll = async () => {
      if (document.hidden) return;
      try {
        const stats = await fetchSystemStats();
        if (disposed) return;
        const t = Date.now();
        setReading((previous) => ({
          stats,
          cpu: pushHistory(previous.cpu, { t, v: stats.cpu_percent }),
          mem: pushHistory(previous.mem, { t, v: stats.mem_percent }),
          failed: false,
        }));
        schedule(pollDelay(expanded));
      } catch (error) {
        if (disposed) return;
        const { delay, failed } = retryDelay(error);
        if (failed) setReading({ stats: null, cpu: [], mem: [], failed: true });
        schedule(delay);
      }
    };
    const onVisible = () => { if (!document.hidden) void poll(); };
    document.addEventListener("visibilitychange", onVisible);
    void poll();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [expanded]);
  return reading;
}

/** 左侧栏左下角的电脑状态。读取失败时整张卡片不显示。 */
export function SystemMonitor() {
  const { t } = useI18n();
  const uid = useId().replace(/:/g, "");
  const [expanded, setExpanded] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const reading = useSystemStats(expanded);
  const close = useCallback(() => setExpanded(false), []);

  useEffect(() => {
    if (!expanded) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [expanded, close]);

  if (reading.failed) return null;
  return (
    <div ref={root}>
      <SystemMonitorView
        stats={reading.stats}
        cpuHistory={reading.cpu}
        memHistory={reading.mem}
        now={reading.cpu[reading.cpu.length - 1]?.t ?? Date.now()}
        expanded={expanded}
        onToggle={() => setExpanded((value) => !value)}
        t={t as Translate}
        uid={uid}
      />
    </div>
  );
}
