import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

const source = ts.transpileModule(readFileSync(new URL("../src/services/standaloneRelease.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const sandbox = {exports:{},require:()=>({z})}; vm.runInNewContext(source,sandbox);
const {selectStandaloneRelease,compareStandaloneVersions,checkStandaloneRelease} = sandbox.exports;
function release(version,{platform="windows-amd64",checksum=true,draft=false}={}) {
  const file=`local-ai-agent-${version}-${platform}.${platform.startsWith("windows")?"zip":"tar.gz"}`;
  return {tag_name:`standalone-v${version}`,draft,prerelease:true,assets:[{name:file},...(checksum?[{name:`${file}.sha256`}]:[])]};
}

test("version discovery selects numeric versions and only complete packages for the host platform",()=>{
  const releases=[release("0.1.26-standalone.9"),release("0.1.26-standalone.10"),release("0.1.26-standalone.11",{checksum:false}),release("0.1.26-standalone.12",{draft:true}),release("0.1.26-standalone.13",{platform:"macos-arm64"}),release("../bad")];
  assert.equal(selectStandaloneRelease(releases,"windows-amd64"),"0.1.26-standalone.10");
  assert.equal(selectStandaloneRelease(releases,"macos-arm64"),"0.1.26-standalone.13");
  assert.throws(()=>selectStandaloneRelease(releases,"linux-arm64"),/No standalone release/);
  assert.throws(()=>selectStandaloneRelease({error:"rate limit"},"windows-amd64"));
  assert.equal(compareStandaloneVersions("0.1.26-standalone.10","0.1.26-standalone.9"),1);
  assert.equal(compareStandaloneVersions("0.1.26","0.1.26-standalone.99"),1);
  assert.equal(compareStandaloneVersions("0.1.26","0.1.26"),0);
  assert.equal(compareStandaloneVersions("0.1.26-standalone.9","0.2.0-standalone.1"),-1);
});

test("manual checks fetch newly published versions and expose GitHub failures",async()=>{
  let version="0.1.26-standalone.43";
  sandbox.fetch=async()=>({ok:true,json:async()=>[release(version)]});
  assert.equal(await checkStandaloneRelease("windows-amd64",new AbortController().signal),version);
  version="0.1.26-standalone.44";
  assert.equal(await checkStandaloneRelease("windows-amd64",new AbortController().signal),version);
  sandbox.fetch=async()=>({ok:false,status:403});
  await assert.rejects(checkStandaloneRelease("windows-amd64",new AbortController().signal),/HTTP 403/);
});
