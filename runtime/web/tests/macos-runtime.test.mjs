import { test } from "node:test";
import { expect } from "@playwright/test";
import { mount } from "./helpers/mount-app-fixture.mjs";

const fixture = `
  import { isRelayPWAContext, isStandaloneDisplayMode } from "./src/app/relayContext";
  import { useFileTreePWAAndTips } from "./src/components/useFileTreePWAAndTips";
  import { getNativePlatform, shouldEnablePWAInstall, shouldRegisterServiceWorker } from "./src/services/runtime";
  function Fixture() {
    const pwa = useFileTreePWAAndTips({ relayNoRelayer: false, isNativeApp: false, protectedAPIReady: false });
    return <>
      <output data-testid="platform">{getNativePlatform()}</output>
      <output data-testid="standalone">{String(isStandaloneDisplayMode())}</output>
      <output data-testid="relay-window">{String(isRelayPWAContext())}</output>
      <output data-testid="service-worker">{String(shouldRegisterServiceWorker())}</output>
      <output data-testid="pwa-install">{String(shouldEnablePWAInstall())}</output>
      {pwa.shouldShowInstallButton && <button>Install app</button>}
      {pwa.shouldShowInstallHelp && <p data-testid="install-help">{pwa.installHelp}</p>}
    </>;
  }
`;

test("Mac shell uses the desktop web runtime and hides browser install actions", async (t) => {
  const marker = `<script>window.MindFSMacApp = Object.freeze({ platform: "macos" });</script>`;
  const page = await mount(t, fixture, () => ({}), 900, "/n/test/", marker);
  await expect(page.getByTestId("platform")).toHaveText("web");
  await expect(page.getByTestId("standalone")).toHaveText("true");
  await expect(page.getByTestId("relay-window")).toHaveText("true");
  await expect(page.getByTestId("service-worker")).toHaveText("true");
  await expect(page.getByTestId("pwa-install")).toHaveText("false");
  await expect(page.getByRole("button", { name: "Install app" })).toHaveCount(0);
  await expect(page.getByTestId("install-help")).toHaveCount(0);
});

test("ordinary desktop browser retains the PWA install actions", async (t) => {
  const page = await mount(t, fixture, () => ({}), 900, "/n/test/");
  await expect(page.getByTestId("standalone")).toHaveText("false");
  await expect(page.getByTestId("relay-window")).toHaveText("false");
  await expect(page.getByTestId("pwa-install")).toHaveText("true");
  await expect(page.getByRole("button", { name: "Install app" })).toBeVisible();
  await expect(page.getByTestId("install-help")).toBeVisible();
});

test("desktop settings hide Web Push in the Mac shell and retain Bark", async (t) => {
  const source = `import { WorkspaceFixture as Fixture } from './tests/fixtures/workspace-sidebars';`;
  for (const isMac of [true, false]) {
    const marker = isMac ? `<script>window.MindFSMacApp = { platform: "macos" };</script>` : "";
    const page = await mount(t, source, () => ({}), 1440, "/", marker);
    await page.getByRole("button", { name: "Open file tree menu" }).click();
    const menu = page.locator("[data-file-tree-menu]");
    await expect(menu.getByRole("button", { name: "Bark push" })).toBeVisible();
    const webPush = menu.getByRole("button", { name: "Enable notifications" });
    if (isMac) await expect(webPush).toHaveCount(0);
    else await expect(webPush).toBeVisible();
  }
});
