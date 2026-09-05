import type {Coordinator, Adapter} from "./coordinator.js";
import {LoaderError} from "./manifest.js";
export interface BridgeRequest {requestId:string; method:"prefetch"|"activate"; releaseKey:string; document:string;}
/** Attach to the exact retained document; the native host receives completion, not runtime objects. */
export function createWebViewBridge(coordinator: Coordinator, adapters: ReadonlyMap<string,Adapter<unknown>>,
  currentDocument: () => string, reply: (json: string) => void) {
  return Object.freeze({receive(input: unknown): void {
    const r = input as BridgeRequest;
    const valid = r && typeof r === "object" && Object.keys(r).sort().join(",") === "document,method,releaseKey,requestId" &&
      typeof r.requestId === "string" && /^[0-9]{1,16}$/.test(r.requestId) &&
      typeof r.releaseKey === "string" && r.releaseKey.length <= 256 &&
      r.document === currentDocument() && ["prefetch","activate"].includes(r.method);
    if (!valid) throw new LoaderError("bridge","Invalid bridge request or document");
    const operation = async () => {
      if (r.method === "prefetch") await coordinator.prefetch(r.releaseKey);
      else {
        const adapter = adapters.get(r.releaseKey);
        if (!adapter) throw new LoaderError("bridge","No activation adapter registered");
        await coordinator.activate(r.releaseKey,adapter);
      }
    };
    void operation().then(
      () => reply(JSON.stringify({requestId:r.requestId,ok:true})),
      () => reply(JSON.stringify({requestId:r.requestId,ok:false}))
    );
  }});
}

