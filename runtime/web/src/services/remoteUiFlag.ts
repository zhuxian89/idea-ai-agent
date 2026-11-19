/**
 * 当前页面是否启用了新版远程网页界面。
 * 只读 <html data-remote-ui>（由 services/remoteUi.ts 在浏览器里设置），渲染时才取值，
 * 所以没有 DOM 的环境（服务端渲染、单元测试）里组件也能正常引入。
 */
export function remoteUiActive(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.remoteUi === "1";
}
