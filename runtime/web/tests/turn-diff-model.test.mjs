import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import { test } from "node:test";

const compiled = ts.transpileModule(fs.readFileSync("src/components/turnDiffModel.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const sandbox = { exports: {}, TextEncoder, TextDecoder };
vm.runInNewContext(compiled, sandbox);
const { parseTurnDiff } = sandbox.exports;

test("turn diff parser groups files and ignores file headers in line totals", () => {
  const result = parseTurnDiff(`diff --git a/src/A.java b/src/A.java
index 111..222 100644
--- a/src/A.java
+++ b/src/A.java
@@ -1,2 +1,3 @@
 unchanged
-old
+new
+extra
diff --git a/src/New.java b/src/New.java
new file mode 100644
--- /dev/null
+++ b/src/New.java
@@ -0,0 +1 @@
+created`);

  assert.equal(result.files.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(result.files.map(({ path, kind, additions, deletions }) => ({ path, kind, additions, deletions })))), [
    { path: "src/A.java", kind: "modified", additions: 2, deletions: 1 },
    { path: "src/New.java", kind: "added", additions: 1, deletions: 0 },
  ]);
  assert.equal(result.additions, 3);
  assert.equal(result.deletions, 1);
});

test("turn diff parser handles delete, rename, binary, and Git-quoted UTF-8 paths", () => {
  const result = parseTurnDiff(`diff --git a/old.txt b/old.txt
deleted file mode 100644
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-gone
diff --git a/before.txt b/after.txt
similarity index 100%
rename from before.txt
rename to after.txt
diff --git "a/\\346\\265\\213\\350\\257\\225.png" "b/\\346\\265\\213\\350\\257\\225.png"
Binary files "a/\\346\\265\\213\\350\\257\\225.png" and "b/\\346\\265\\213\\350\\257\\225.png" differ
diff --git a/image file.bin b/image file.bin
index 111..222 100644
GIT binary patch
literal 1
Acmd;`);

  assert.equal(result.files[0].kind, "deleted");
  assert.equal(result.files[1].kind, "renamed");
  assert.equal(result.files[1].oldPath, "before.txt");
  assert.equal(result.files[2].path, "测试.png");
  assert.equal(result.files[2].binary, true);
  assert.equal(result.files[3].path, "image file.bin");
  assert.equal(result.files[3].binary, true);
});
