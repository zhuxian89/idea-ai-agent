import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { mount } from "./helpers/mount-app-fixture.mjs";

const sessionFixture = `import { SessionHooksFixture as Fixture } from "./tests/fixtures/session-hooks";`;
const session = (key, root = "root") => ({
  key,
  session_key: key,
  root_id: root,
  type: "chat",
  agent: "codex",
  model: "old-model",
  name: key,
  exchanges: [],
});

test("session navigation ignores late history from a previous selection", async (t) => {
  const page = await mount(t, sessionFixture, () => ({}));
  await page.waitForFunction(() => window.sessionFixture);
  await page.evaluate(
    (s) => {
      void window.sessionFixture.select(s);
    },
    session("one", "a"),
  );
  await page.waitForFunction(() => window.restores["a::one"]);
  await page.evaluate(
    (s) => {
      void window.sessionFixture.select(s);
    },
    session("two", "b"),
  );
  await page.waitForFunction(() => window.restores["b::two"]);
  await page.evaluate(() =>
    window.restores["a::one"]({ key: "one", name: "Late old history" }),
  );
  await expect
    .poll(() =>
      page.evaluate(() => window.sessionFixture.snapshot().selected.key),
    )
    .toBe("two");
  assert.equal(
    await page.evaluate(() => window.sessionFixture.snapshot().loading),
    true,
  );
  await page.evaluate(() =>
    window.restores["b::two"]({ key: "two", name: "Current history" }),
  );
  await expect
    .poll(() =>
      page.evaluate(() => window.sessionFixture.snapshot().selected.name),
    )
    .toBe("Current history");
  const state = await page.evaluate(() => window.sessionFixture.snapshot());
  assert.equal(state.loading, false);
  assert.equal(state.root, "b");
  assert.equal(state.url.session, "two");
});

test("sending uses the visible session and composer model instead of another bound drawer session", async (t) => {
  const page = await mount(t, sessionFixture, () => ({}));
  await page.waitForFunction(() => window.sessionFixture);
  await page.evaluate(
    ([s, d]) => window.sessionFixture.seed(s, d),
    [session("visible"), session("drawer")],
  );
  await expect(page.getByTestId("selection")).toHaveText("visible");
  await page.evaluate(() => {
    void window.sessionFixture.send("Hello", "chat", "codex", "new-model");
  });
  await page.waitForFunction(() => window.sent.length === 1);
  const sent = await page.evaluate(() => window.sent[0]);
  assert.deepEqual(sent.slice(0, 6), [
    "root",
    "visible",
    "Hello",
    "chat",
    "codex",
    "new-model",
  ]);
  const pending = await page.evaluate(() => window.sessionFixture.snapshot());
  assert.equal(pending.selected.pending, true);
  assert.equal(
    pending.cache["root::visible"].exchanges.at(-1).content,
    "Hello",
  );
  assert.equal(
    pending.cache["root::visible"].exchanges.at(-1).pending_ack,
    true,
  );
  assert.equal(pending.cache["root::drawer"].exchanges.length, 0);
  await page.evaluate(() => window.finishSend(false));
  await expect
    .poll(() =>
      page.evaluate(() => window.sessionFixture.snapshot().selected.pending),
    )
    .toBe(false);
  assert.deepEqual(
    await page.evaluate(() => window.sessionFixture.snapshot().pending),
    {},
  );
});

test("a failed new-session send removes its optimistic tab, selection and cache entry", async (t) => {
  const page = await mount(t, sessionFixture, () => ({}));
  await page.waitForFunction(() => window.sessionFixture);
  await page.evaluate(() => {
    void window.sessionFixture.send("New conversation", "chat", "codex");
  });
  await page.waitForFunction(() => window.sent.length === 1);
  await expect(page.getByTestId("selection")).toHaveText(/^pending-/);
  const pending = await page.evaluate(() => window.sessionFixture.snapshot());
  const tempKey = pending.selected.key;
  assert.equal(pending.tabs.root[0].key, tempKey);
  assert.equal(
    pending.cache[`root::${tempKey}`].exchanges[0].content,
    "New conversation",
  );
  assert.equal(await page.evaluate(() => window.sent[0][1]), undefined);
  await page.evaluate(() => window.finishSend(false));
  await expect(page.getByTestId("selection")).toHaveText("none");
  const state = await page.evaluate(() => window.sessionFixture.snapshot());
  assert.deepEqual(state.sessions, []);
  assert.deepEqual(state.tabs.root, []);
  assert.deepEqual(state.pending, {});
  assert.equal(state.cache[`root::${tempKey}`], undefined);
  assert.equal(state.url.session, "");
});

const gitFixture = `
  import { useWorkspaceGit } from "./src/app/useWorkspaceGit";
  const noop = () => {};
  function Fixture() {
    const currentRootIdRef = useRef("a");
    const managedRootByIdRef = useRef({a:{is_git_repo:true},b:{is_git_repo:true}});
    const git = useWorkspaceGit({currentRootIdRef,managedRootByIdRef,fileOpenRequestRef:useRef(0),
      setRelatedSelectedFileKey:noop,setMainViewPreferenceForRoot:noop,setSelectedSession:noop,
      setSelectedSessionLoading:noop,setFile:noop,replaceURLState:noop,setCurrentRootId:noop,
      isMobile:false,setIsLeftOpen:noop,refreshTreeDir:async (...args) => window.refreshed.push(args),
      selectedDirRef:useRef("."),t:key => key});
    window.git = git;
    window.switchRoot = root => { currentRootIdRef.current = root; };
    return <output data-testid="branch">{git.gitStatus?.branch}</output>;
  }
  window.refreshed = [];
`;

test("late Git status and history stay cached under their original root", async (t) => {
  let releaseStatus, releaseHistory;
  const page = await mount(t, gitFixture, (request) => {
    const url = new URL(request.url());
    const root = url.searchParams.get("root");
    if (url.pathname.endsWith("status")) {
      const status = {
        available: true,
        branch: root,
        dirty_count: 0,
        items: [],
      };
      if (root === "a")
        return new Promise((resolve) => {
          releaseStatus = () => resolve(status);
        });
      return status;
    }
    const history = {
      available: true,
      items: [{ hash: root, message: root, commit_time: "2026-11-09" }],
      has_more: false,
    };
    if (root === "a")
      return new Promise((resolve) => {
        releaseHistory = () => resolve(history);
      });
    return history;
  });
  await page.waitForFunction(() => window.git);
  await page.evaluate(() => {
    void window.git.refreshGitStatus("a");
    void window.git.refreshGitHistory("a", { force: true });
  });
  await expect.poll(() => !!releaseStatus && !!releaseHistory).toBe(true);
  await page.evaluate(async () => {
    window.switchRoot("b");
    await window.git.refreshGitStatus("b");
    await window.git.refreshGitHistory("b", { force: true });
  });
  releaseStatus();
  releaseHistory();
  await page.waitForFunction(
    () => window.git.gitStatusByRoot.a && window.git.gitHistoryByRoot.a,
  );
  await expect(page.getByTestId("branch")).toHaveText("b");
  assert.deepEqual(
    await page.evaluate(() => ({
      visible: window.git.gitHistory.items[0].hash,
      cached: window.git.gitHistoryByRoot.a.items[0].hash,
    })),
    { visible: "b", cached: "a" },
  );
});

test("staging a Git file refreshes its status and directory without reloading history", async (t) => {
  const requests = [];
  const page = await mount(t, gitFixture, (request) => {
    requests.push({
      path: new URL(request.url()).pathname,
      body: request.postDataJSON(),
    });
    return {
      status: { available: true, branch: "a", dirty_count: 1, items: [] },
    };
  });
  await page.waitForFunction(() => window.git);
  await page.evaluate(() =>
    window.git.handleGitStageItem("a", {
      path: "file.ts",
      status: "M",
      additions: 1,
      deletions: 0,
    }),
  );
  await expect(page.getByTestId("branch")).toHaveText("a");
  assert.equal(requests.length, 1);
  assert.match(requests[0].path, /stage$/);
  assert.equal(requests[0].body.path, "file.ts");
  assert.deepEqual(await page.evaluate(() => window.refreshed), [
    ["a", ".", true],
  ]);
});

for (const [mode, path] of [
  ["IDE", "/"],
  ["remote", "/n/node/p/project/"],
]) {
  test(`the real ${mode} App opens its workspace without task-board requests or project-creation controls`, async (t) => {
    const requests = [];
    const page = await mount(
      t,
      `
      import { App } from "./src/App";
      import { sessionService } from "./src/services/session";
      // There is no live agent in this fixture; App still runs its real bootstrap,
      // root initialization, session effects and component tree.
      sessionService.connect = () => {};
      window.bootstrap = bootstrapService;
      function Fixture() { return <App />; }
    `,
      (request) => {
        const pathname = new URL(request.url()).pathname;
        requests.push({ path: pathname, method: request.method() });
        if (pathname.endsWith("/api/dirs"))
          return [
            { id: "root", root_path: "/workspace/root", is_git_repo: false },
          ];
        if (pathname.endsWith("/api/relay/status"))
          return { e2ee_required: false };
        if (pathname.endsWith("/api/tree"))
          return {
            entries: [{ name: "README.md", path: "README.md", is_dir: false }],
          };
        return { agents: [], shells: [], items: [], entries: [], plugins: [] };
      },
      900,
      path,
    );
    await expect
      .poll(() => page.evaluate(() => window.bootstrap.snapshot().phase))
      .toBe("ready");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("root"))
      .toBe("root");
    if (mode === "IDE")
      await expect(page.locator(".idea-empty-chat")).toBeVisible();
    else
      await expect(
        page.getByText("README.md", { exact: true }).first(),
      ).toBeVisible();
    assert.equal(
      requests.some((r) =>
        /\/api\/(tasks|task-templates|stage-templates|local_dirs|imports\/github)/.test(
          r.path,
        ),
      ),
      false,
    );
    assert.equal(
      requests.some((r) => /\/api\/dirs/.test(r.path) && r.method !== "GET"),
      false,
    );
    await expect(
      page.getByRole("button", {
        name: /create task|task template|add project|create project/i,
      }),
    ).toHaveCount(0);
  });
}
