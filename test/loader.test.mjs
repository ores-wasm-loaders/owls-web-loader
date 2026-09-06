import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {Coordinator, browserPolicy, RawWasmAdapter, BindgenAdapter, MemoryStore, httpTransport, parseRelease, hintDescriptors, mountFlutterView} from "../dist/index.js";
import {linkHeader} from "../dist/server.js";

const bytes = Uint8Array.from([0,97,115,109,1,0,0,0]);
const hash = data => createHash("sha256").update(data).digest("hex");
const asset = (id="app",data=bytes) => ({id,url:"https://assets.example/"+id,kind:"wasm",bytes:data.length,sha256:hash(data),prepare:true});
const manifest = () => ({schemaVersion:1,appId:"demo",release:"r1",runtime:"raw-wasm",entrypoint:"app",assets:[asset()]});
const policy = overrides => ({...browserPolicy(["https://assets.example"]),...overrides});
const setup = (transport, overrides) => { const c = new Coordinator(policy(overrides),transport); c.register(manifest()); return c; };

test("preparation never activates; concurrent warmup and activation deduplicate",async () => {
  let calls=0, starts=0;
  const c = setup(async () => { calls++; return bytes; });
  await Promise.all([c.prefetch("demo@r1"),c.prefetch("demo@r1")]);
  const a={activate:async ctx=>{starts++; return new RawWasmAdapter().activate(ctx);}};
  const [one,two] = await Promise.all([c.activate("demo@r1",a),c.activate("demo@r1",a)]);
  assert.equal(one,two); assert.equal(calls,1); assert.equal(starts,1);
  assert.ok(one instanceof WebAssembly.Instance);
});
test("bad speculative download is evicted and activation retries",async () => {
  let calls=0;const c=setup(async()=>++calls===1?new Uint8Array(8):bytes);
  await assert.rejects(c.prefetch("demo@r1"),{code:"integrity"});
  assert.ok(await c.activate("demo@r1",new RawWasmAdapter()));
  assert.equal(calls,2);
});
test("size/budget checks stop work before fetch",async () => {
  let calls=0;const c=setup(async()=>{calls++;return bytes;},{maxPrepareBytes:1});
  await assert.rejects(c.prefetch("demo@r1"),{code:"budget"});assert.equal(calls,0);
});
test("HTTP transport cancels a chunked body before over-budget bytes accumulate",async () => {
  let cancelled=false;
  const transport=httpTransport(async()=>new Response(new ReadableStream({
    start(c){c.enqueue(new Uint8Array(20));},cancel(){cancelled=true;}
  })));
  await assert.rejects(transport(asset(),new AbortController().signal),{code:"size"});assert.equal(cancelled,true);
});
test("credentials and redirects are disabled on public transport",async () => {
  const transport=httpTransport(async(url,init)=>{assert.equal(init.credentials,"omit");assert.equal(init.redirect,"error");return new Response(bytes);});
  assert.deepEqual(await transport(asset(),new AbortController().signal),bytes);
});
test("schema, entrypoint, duplicate, origin and mutable release failures", () => {
  for(const change of [r=>r.bad=true,r=>r.assets[0].bytes=0,r=>r.entrypoint="missing",
    r=>r.assets.push({...r.assets[0]}),r=>r.assets[0].url="https://evil.example/a",
    r=>r.assets[0].url="https://assets.example/a?secret=x"]) {
    const r=manifest();change(r);assert.throws(()=>parseRelease(r,["https://assets.example"]));
  }
  const c=setup(async()=>bytes),r=manifest();r.assets[0].sha256="a".repeat(64);
  assert.throws(()=>c.register(r),{code:"release-conflict"});
});
test("registered manifest is detached from caller mutation",async()=> {
  const c=new Coordinator(policy(),async()=>bytes),r=manifest();c.register(r);r.assets[0].url="https://evil.example/";
  await c.prefetch("demo@r1");
});
test("cancelled queued preparation releases concurrency slots",async()=> {
  const c=setup(async(a,signal)=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>resolve(bytes),10);
    signal.addEventListener("abort",()=>{clearTimeout(timer);reject(signal.reason);},{once:true});
  }),{concurrency:1});
  const abort=new AbortController();
  const one=c.prefetch("demo@r1"),two=c.prefetch("demo@r1",abort.signal);abort.abort();
  await assert.rejects(two);await one;
  assert.ok(await c.activate("demo@r1",new RawWasmAdapter()));
});
test("prefetch timeout aborts transport",async()=> {
  const c=setup(async(a,signal)=>new Promise((resolve,reject)=>signal.addEventListener("abort",()=>reject(signal.reason),{once:true})),{timeoutMs:10});
  await assert.rejects(c.prefetch("demo@r1"),{code:"timeout"});
});
test("memory cache is bounded and copies owned bytes",async()=> {
  const s=new MemoryStore(8),b=bytes.slice();await s.put("a",b);b[0]=99;
  assert.equal((await s.get("a"))[0],0);await s.put("b",bytes);assert.equal(await s.get("a"),undefined);
});
test("bindgen delegates initialization to exact generated glue",async()=>{
  const r=manifest();r.runtime="wasm-bindgen";r.entrypoint="glue";r.assets.push({...asset("glue"),kind:"module",prepare:false});
  const c=new Coordinator(policy(),async()=>bytes);c.register(r);
  let inits=0,starts=0;
  const a=new BindgenAdapter("app",async()=>({default:async({module_or_path})=>{assert.deepEqual(module_or_path,bytes);inits++;}}),async()=>++starts);
  assert.equal(await c.activate("demo@r1",a),1);assert.equal(inits,1);
});
test("SSR hints import without window and distinguish modulepreload",()=>{
  const r=parseRelease(manifest(),["https://assets.example"]);
  assert.equal(hintDescriptors(r,"modulepreload").length,0);
  assert.match(linkHeader(r),/rel=prefetch; as=fetch/);
});
test("Flutter view cleanup is idempotent",()=>{
  let removed=0;
  const dispose=mountFlutterView({addView:()=>7,removeView:id=>{assert.equal(id,7);removed++;}},{});
  dispose();dispose();assert.equal(removed,1);
});
test("activation deadline rejects a non-cooperative adapter without replaying it",async()=>{
  let starts=0;const c=setup(async()=>bytes,{timeoutMs:10});
  const adapter={activate:()=>{starts++;return new Promise(()=>{});}};
  await assert.rejects(c.activate("demo@r1",adapter),{code:"timeout"});
  await assert.rejects(c.activate("demo@r1",adapter),{code:"timeout"});
  assert.equal(starts,1);
});
test("extension configuration is immutable and part of release identity",()=>{
  const c=setup(async()=>bytes), r=manifest();r.release="r2";r.extensions={tenant:{theme:"blue"}};
  const snapshot=c.register(r);r.extensions.tenant.theme="red";
  assert.equal(snapshot.extensions.tenant.theme,"blue");
  assert.throws(()=>c.register(r),{code:"release-conflict"});
  assert.throws(()=>snapshot.extensions.tenant.theme="green");
});
test("a schema-shaped but unparseable asset URL raises a declared LoaderError",async () => {
  const broken = {...manifest(), assets:[{...asset(), url:"https://[/acme/engine.wasm"}]};
  const c = new Coordinator(policy());
  assert.throws(() => c.register(broken), e => e.name === "LoaderError" && e.code === "origin");
});
