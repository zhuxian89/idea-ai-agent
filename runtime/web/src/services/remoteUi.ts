import { isIdeaRuntime } from "./ideaBridge";
import { isNativeShellRuntime } from "./runtime";
import { restoreGlowConfig } from "./remoteGlow";

/**
 * 新版远程网页界面只作用于浏览器里的远程页面。
 * IDEA 内嵌页面（isIdeaRuntime）和原生壳（Android / 鸿蒙）保持原样。
 */
export const isRemoteWebUi: boolean = !isIdeaRuntime && !isNativeShellRuntime();

if (isRemoteWebUi && typeof document !== "undefined") {
  document.documentElement.dataset.remoteUi = "1";
  restoreGlowConfig();
}
