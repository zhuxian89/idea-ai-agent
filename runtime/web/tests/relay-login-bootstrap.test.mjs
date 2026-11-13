import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const source = ts.transpileModule(readFileSync("src/services/bootstrap.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
function browser({status = 200, offline = false} = {}) {
  const requests = [];
  const crypto = {required:true, configured:false, nodeId:"old-node", unlocked:false, secretPresent:false};
  const service = {};
  vm.runInNewContext(source, {
    exports: service, Error,
    fetch: async (target, init) => {
      requests.push({target, init});
      if (offline) throw new Error("offline");
      return {ok:status === 200,status,json:async()=>({e2ee_required:false,no_relayer:false})};
    },
    require: name => name === "./base" ? {appPath:path=>`/n/node${path}`} : name === "./e2ee" ? {
      e2eeService: {snapshot:()=>({...crypto}),configure:(required,nodeId)=>Object.assign(crypto,{required,nodeId,configured:true})},
    } : assert.fail(name),
  });
  return {service:service.bootstrapService,requests,online:()=>{status=200;offline=false;}};
}

test("Relay node starts without a pairing key or handshake", async()=>{
  const b=browser();
  const state=await b.service.start();
  assert.equal(state.phase,"ready");
  assert.equal(state.e2ee.required,false);
  assert.equal(b.service.canUseProtectedAPI(),true);
  assert.deepEqual(b.requests.map(r=>r.target),["/n/node/api/relay/status"]);
});

test("Relay status failure stays visible until manual retry",async()=>{
  for (const failure of [{status:401},{status:502},{offline:true}]) {
    const b=browser(failure);
    const state=await b.service.start();
    assert.equal(state.phase,"error");
    assert.equal(state.error,failure.offline ? "offline" : `relay_status_failed_${failure.status}`);
    assert.equal(b.service.canUseProtectedAPI(),false);
    assert.equal(b.requests.length,1);
    b.online();
    assert.equal((await b.service.start()).phase,"ready");
    assert.equal(b.requests.length,2);
  }
});

test("Relay binding uses the existing status API without browser credentials",async()=>{
  const b=browser();
  await b.service.start();
  await b.service.startRelayBinding();
  assert.equal(b.requests[1].target,"/n/node/api/relay/bind/start");
  assert.equal(b.requests[1].init.method,"POST");
  assert.equal(b.requests[1].init.headers,undefined);
});
