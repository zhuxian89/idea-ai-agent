/**
 * 对话区边框流光的用户配置。只保存在本机浏览器，不涉及后台。
 * 默认开启；是否亮起由“agent 是否在运行”决定（见 remoteDesign.css）。
 */
export type GlowEffect = "breathe" | "orbit" | "dual" | "sweep";
export type GlowColor = "theme" | "violet" | "teal" | "amber" | "rose" | "green" | "custom";
export type GlowSpeed = "slow" | "normal" | "fast" | "rapid";

export type GlowConfig = {
  on: boolean;
  fx: GlowEffect;
  color: GlowColor;
  custom: string;
  speed: GlowSpeed;
};

export const GLOW_STORAGE_KEY = "mindfs-remote-glow";
export const GLOW_CHANGE_EVENT = "mindfs:remote-glow-changed";

export const GLOW_DEFAULT: GlowConfig = { on: true, fx: "breathe", color: "theme", custom: "#6366f1", speed: "normal" };

export const GLOW_EFFECTS: GlowEffect[] = ["breathe", "orbit", "dual", "sweep"];
export const GLOW_SPEEDS: GlowSpeed[] = ["slow", "normal", "fast", "rapid"];
/** 转一圈（或来回一次）的秒数。 */
export const GLOW_SPEED_SECONDS: Record<GlowSpeed, number> = { slow: 24, normal: 14, fast: 8, rapid: 4.5 };
export const GLOW_PALETTE: Array<{ id: Exclude<GlowColor, "theme" | "custom">; stops: [string, string, string] }> = [
  { id: "violet", stops: ["#6366f1", "#8b5cf6", "#e879f9"] },
  { id: "teal", stops: ["#14b8a6", "#22d3ee", "#a7f3d0"] },
  { id: "amber", stops: ["#f59e0b", "#fb923c", "#fde68a"] },
  { id: "rose", stops: ["#f43f5e", "#fb7185", "#fda4af"] },
  { id: "green", stops: ["#16a34a", "#4ade80", "#bbf7d0"] },
];

const HEX = /^#[0-9a-fA-F]{6}$/;

export function normalizeGlowConfig(value: unknown): GlowConfig {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<GlowConfig>;
  const colors: GlowColor[] = ["theme", "custom", ...GLOW_PALETTE.map((item) => item.id)];
  return {
    on: typeof raw.on === "boolean" ? raw.on : GLOW_DEFAULT.on,
    fx: GLOW_EFFECTS.includes(raw.fx as GlowEffect) ? (raw.fx as GlowEffect) : GLOW_DEFAULT.fx,
    color: colors.includes(raw.color as GlowColor) ? (raw.color as GlowColor) : GLOW_DEFAULT.color,
    custom: typeof raw.custom === "string" && HEX.test(raw.custom) ? raw.custom : GLOW_DEFAULT.custom,
    speed: GLOW_SPEEDS.includes(raw.speed as GlowSpeed) ? (raw.speed as GlowSpeed) : GLOW_DEFAULT.speed,
  };
}

export function loadGlowConfig(): GlowConfig {
  if (typeof window === "undefined") return { ...GLOW_DEFAULT };
  try {
    const stored = window.localStorage.getItem(GLOW_STORAGE_KEY);
    return stored ? normalizeGlowConfig(JSON.parse(stored)) : { ...GLOW_DEFAULT };
  } catch {
    return { ...GLOW_DEFAULT };
  }
}

/** 三段渐变色；“跟随主题”时返回 null，由主题里的变量决定。 */
export function glowStops(config: GlowConfig): [string, string, string] | null {
  if (config.color === "theme") return null;
  if (config.color === "custom") {
    const c = config.custom;
    return [c, `color-mix(in srgb, ${c} 60%, #fff)`, `color-mix(in srgb, ${c} 30%, #fff)`];
  }
  return GLOW_PALETTE.find((item) => item.id === config.color)?.stops ?? null;
}

/** 把配置写到 <html> 上，样式只读这些属性和变量。 */
export function applyGlowConfig(config: GlowConfig): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.glow = config.on ? "on" : "off";
  root.dataset.glowFx = config.fx;
  const stops = glowStops(config);
  (["--glow1", "--glow2", "--glow3"] as const).forEach((name, index) => {
    if (stops) root.style.setProperty(name, stops[index]);
    else root.style.removeProperty(name);
  });
  root.style.setProperty("--glow-dur", `${GLOW_SPEED_SECONDS[config.speed]}s`);
}

export function saveGlowConfig(config: GlowConfig): void {
  try {
    window.localStorage.setItem(GLOW_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // 存储不可用时本次页面里仍然生效。
  }
  applyGlowConfig(config);
  window.dispatchEvent(new CustomEvent<GlowConfig>(GLOW_CHANGE_EVENT, { detail: config }));
}

/** 页面启动时调用一次。 */
export function restoreGlowConfig(): GlowConfig {
  const config = loadGlowConfig();
  applyGlowConfig(config);
  return config;
}
