import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { mount } from "./helpers/mount-app-fixture.mjs";

const fixture = `
  import { StandaloneProjects } from "./src/components/StandaloneProjects";
  function Fixture() {
    const [added, setAdded] = useState("");
    const [count, setCount] = useState(0);
    return <><StandaloneProjects onAdded={id => { setAdded(id); setCount(value => value + 1); }} /><output data-testid="added">{added}</output><output data-testid="count">{count}</output></>;
  }
`;

function localDirectoryResponse() {
  return {
    path: "/Users/test",
    parent: "/Users",
    items: [
      { name: "Projects", path: "/Users/test/Projects", is_dir: true },
      { name: "Existing", path: "/Users/test/Existing", is_dir: true, is_added_root: true },
    ],
  };
}

test("standalone project picker adds an existing local directory", async (t) => {
  const requests = [];
  const page = await mount(t, fixture, (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/api/local_dirs")) return localDirectoryResponse();
    requests.push(request.postDataJSON());
    return { id: "Projects" };
  });

  await page.getByRole("button", { name: "Add project" }).click();
  await page.getByRole("button", { name: /Add local directory/ }).click();
  await page.getByRole("button", { name: /Projects/ }).first().click();
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await expect(page.getByTestId("added")).toHaveText("Projects");
  assert.deepEqual(requests, [{ path: "/Users/test/Projects", create: false }]);
});

test("standalone project picker creates a blank project in the selected location", async (t) => {
  const requests = [];
  const page = await mount(t, fixture, (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/api/local_dirs")) return localDirectoryResponse();
    requests.push(request.postDataJSON());
    return { id: "demo" };
  });

  await page.getByRole("button", { name: "Add project" }).click();
  await page.getByRole("button", { name: /Blank project/ }).click();
  await page.getByRole("button", { name: "Place here" }).click();
  await page.getByLabel("Project name").fill("demo");
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await expect(page.getByTestId("added")).toHaveText("demo");
  assert.deepEqual(requests, [{ path: "/Users/test/demo", create: true }]);
});

test("standalone project picker follows GitHub import progress and opens the imported project", async (t) => {
  const requests = [];
  let complete = false;
  let statusReads = 0;
  const page = await mount(t, fixture, (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/api/local_dirs")) return localDirectoryResponse();
    if (url.pathname.endsWith("/api/imports/github/import-1")) {
      statusReads++;
      return complete
        ? { task_id: "import-1", status: "done", root_id: "github-demo", message: "done" }
        : { task_id: "import-1", status: "cloning", message: "Cloning repository" };
    }
    requests.push(request.postDataJSON());
    return { task_id: "import-1", status: "accepted" };
  });

  await page.getByRole("button", { name: "Add project" }).click();
  await page.getByRole("button", { name: /Import from GitHub/ }).click();
  await page.getByRole("button", { name: "Place here" }).click();
  await page.getByLabel("GitHub").fill("https://github.com/example/demo");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cloning..." })).toBeDisabled();
  await expect(page.getByText("Cloning repository", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  complete = true;

  await expect(page.getByTestId("added")).toHaveText("github-demo");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("count")).toHaveText("1");
  assert.ok(statusReads >= 2);
  assert.deepEqual(requests, [{
    url: "https://github.com/example/demo",
    parent_path: "/Users/test",
  }]);
});

test("standalone project picker navigates up and adds an empty directory entered by path", async (t) => {
  const browsed = [];
  const requests = [];
  const page = await mount(t, fixture, request => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/api/local_dirs")) {
      const path = url.searchParams.get("path") || "/Users/test";
      browsed.push(path);
      return path === "/Users/test" ? localDirectoryResponse() : { path, parent: "/Users", items: [] };
    }
    requests.push(request.postDataJSON());
    return { id: "empty" };
  });
  await page.getByRole("button", { name: "Add project" }).click();
  await page.getByRole("button", { name: /Add local directory/ }).click();
  await expect(page.getByRole("button", { name: /Existing/ }).first()).toBeDisabled();
  await page.getByRole("button", { name: "Open directory Projects", exact: true }).click();
  await page.getByRole("button", { name: "Parent directory", exact: true }).click();
  await page.getByLabel("Directory path").fill("/Users/empty");
  await page.getByRole("button", { name: "Go", exact: true }).click();
  await page.getByRole("button", { name: "Add current directory", exact: true }).click();
  await expect(page.getByTestId("added")).toHaveText("empty");
  assert.deepEqual(browsed, ["/Users/test", "/Users/test/Projects", "/Users", "/Users/empty"]);
  assert.deepEqual(requests, [{ path: "/Users/empty", create: false }]);
});

test("standalone project picker switches Windows volumes and creates a project there", async (t) => {
  const requests = [];
  const browsed = [];
  const page = await mount(t, fixture, request => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/api/local_dirs")) {
      const path = url.searchParams.get("path") || "C:\\Users\\test";
      browsed.push(path);
      return { path, parent: "", volumes: [{ name: "C:", path: "C:\\" }, { name: "D:", path: "D:\\" }], items: [] };
    }
    requests.push(request.postDataJSON());
    return { id: "demo" };
  });
  await page.getByRole("button", { name: "Add project" }).click();
  await page.getByRole("button", { name: /Blank project/ }).click();
  await page.getByRole("button", { name: "D:", exact: true }).click();
  await page.getByRole("button", { name: "Place here" }).click();
  await page.getByLabel("Project name").fill("../escape");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  assert.equal(requests.length, 0);
  await page.getByLabel("Project name").fill("demo");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByTestId("added")).toHaveText("demo");
  assert.deepEqual(browsed, ["C:\\Users\\test", "D:\\"]);
  assert.deepEqual(requests, [{ path: "D:\\demo", create: true }]);
});

test("standalone project picker shows failed imports and can start a new task", async (t) => {
  let imports = 0;
  const page = await mount(t, fixture, request => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/api/local_dirs")) return localDirectoryResponse();
    if (request.method() === "POST") return { task_id: `import-${++imports}` };
    if (url.pathname.endsWith("/import-1")) return { status: "failed", message: "Clone failed" };
    assert.ok(url.pathname.endsWith("/import-2"));
    return { status: "done", root_id: "retry", message: "done" };
  });
  await page.getByRole("button", { name: "Add project" }).click();
  await page.getByRole("button", { name: /Import from GitHub/ }).click();
  await page.getByRole("button", { name: "Place here" }).click();
  await page.getByLabel("GitHub").fill("https://github.com/example/demo");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Clone failed");
  await expect(page.getByTestId("count")).toHaveText("0");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByTestId("added")).toHaveText("retry");
  assert.equal(imports, 2);
});

test("a failed directory lookup cannot register a stale selection", async (t) => {
  const page = await mount(t, fixture, request => {
    assert.ok(new URL(request.url()).pathname.endsWith("/api/local_dirs"));
    return localDirectoryResponse();
  });
  await page.getByRole("button", { name: "Add project" }).click();
  await page.getByRole("button", { name: /Add local directory/ }).click();
  await page.route("**/api/local_dirs?*", route => route.fulfill({ status: 403, body: "Directory unavailable" }));
  await page.getByLabel("Directory path").fill("/unavailable");
  await page.getByRole("button", { name: "Go", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add current directory", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Open directory Projects", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("count")).toHaveText("0");
});
