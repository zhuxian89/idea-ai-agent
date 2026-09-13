import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const service = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync("src/services/session.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
  {
    exports: service.exports,
    require: (name) => {
      if (name === "./base") {
        return { appURL: (path) => path, wsURL: (path) => path };
      }
      if (name === "./api") {
        return {
          protectedFetch: async () => ({ ok: true }),
          protectedJSON: async () => ({}),
        };
      }
      if (name === "./e2ee") {
        return {
          e2eeService: {
            setClientId() {},
            isRequired: () => false,
          },
        };
      }
      return require(name);
    },
  },
);

function fakeDB(initialStores) {
  const stores = new Set(initialStores);
  const deleted = [];
  const created = [];
  return {
    objectStoreNames: { contains: (name) => stores.has(name) },
    deleteObjectStore(name) {
      if (!stores.has(name)) {
        throw new Error(`store not found: ${name}`);
      }
      stores.delete(name);
      deleted.push(name);
    },
    createObjectStore(name, options) {
      stores.add(name);
      created.push({ name, options });
    },
    deleted,
    created,
    stores,
  };
}

test("session cache version bumps to 4", () => {
  assert.equal(service.exports.SESSION_CACHE_VERSION, 4);
});

test("version 3 caches rebuild the sessions store and keep session lists", () => {
  const db = fakeDB(["sessions", "session-lists", "drafts", "attachments"]);
  service.exports.applySessionCacheUpgrade(db, 3);
  assert.deepEqual(db.deleted, ["sessions"]);
  assert.deepEqual(
    db.created.map((item) => item.name),
    ["sessions"],
  );
  assert.equal(db.created[0].options.keyPath, "cacheKey");
  assert.deepEqual([...db.stores].sort(), [
    "attachments",
    "drafts",
    "session-lists",
    "sessions",
  ]);
});

test("pre-version-2 caches follow the same rebuild path", () => {
  const db = fakeDB(["sessions", "session-lists"]);
  service.exports.applySessionCacheUpgrade(db, 1);
  assert.deepEqual(db.deleted, ["sessions"]);
  assert.deepEqual(db.created.map((item) => item.name), ["sessions"]);
  assert.ok(db.stores.has("sessions"));
  assert.ok(db.stores.has("session-lists"));
});

test("fresh installs create both stores without deleting anything", () => {
  const db = fakeDB([]);
  service.exports.applySessionCacheUpgrade(db, 0);
  assert.deepEqual(db.deleted, []);
  assert.deepEqual(
    db.created.map((item) => item.name).sort(),
    ["session-lists", "sessions"],
  );
});

test("already-current caches are left untouched", () => {
  const db = fakeDB(["sessions", "session-lists"]);
  service.exports.applySessionCacheUpgrade(db, 4);
  assert.deepEqual(db.deleted, []);
  assert.deepEqual(db.created, []);
});
