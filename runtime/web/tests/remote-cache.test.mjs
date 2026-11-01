import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

for (const [kind, firstNode, secondNode] of [["nodes", "node", "node2"], ["projects", "node/p/P", "node/p/P2"]]) {
test(`${kind} with overlapping names cannot read or evict each other's file caches`, async () => {
  const records = new Map();
  const localStorage = {
    get length() { return records.size; },
    key: i => [...records.keys()][i] ?? null,
    getItem: key => records.get(key) ?? null,
    setItem: (key,value) => records.set(key,value),
    removeItem: key => records.delete(key),
  };
  const source = ts.transpileModule(readFileSync("src/services/file.ts","utf8"), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
  }).outputText;
  function client(node) {
    const exports = {};
    vm.runInNewContext(source, {
      exports, URL, URLSearchParams, AbortController, TextEncoder, console,
      window: {location:{pathname:`/n/${node}/`,origin:"https://relay.test"},localStorage,setTimeout,clearTimeout},
      fetch: async () => ({ok:true,status:200,json:async()=>({file:{root:"root",path:"same.ts",name:"same.ts",content:node,encoding:"utf-8",size:node.length,truncated:false}})}),
      require: name => {
        if (name === "./base") return {appURL:(path,params)=>`/n/${node}${path}?${params}`};
        if (name === "./e2ee") return {e2eeService:{isRequired:()=>false,parseProtectedJSONResponse:response=>response.json()}};
        throw new Error(name);
      },
    });
    return exports;
  }
  const params = {rootId:"root",path:"same.ts"};
  const first = client(firstNode);
  const second = client(secondNode);
  await first.fetchFile(params);
  assert.equal(await second.getCachedFile(params),null);
  await second.fetchFile(params);
  assert.equal((await client(firstNode).getCachedFile(params)).content,firstNode);
  assert.equal((await client(secondNode).getCachedFile(params)).content,secondNode);
  first.clearFileCacheForRoot("root");
  assert.equal((await client(secondNode).getCachedFile(params)).content,secondNode);
});
}
