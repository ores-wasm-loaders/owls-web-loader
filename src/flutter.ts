import type {Adapter, LoadContext} from "./coordinator.js";
import {LoaderError, releaseKey} from "./manifest.js";

export interface FlutterApp {
  addView(options: {hostElement: HTMLElement; initialData?: unknown}): number;
  removeView(id: number): unknown;
}
export interface FlutterInitializer {
  initializeEngine(options: Readonly<Record<string, unknown>>): Promise<{runApp(): Promise<FlutterApp>}>;
}
export interface FlutterLoader {
  load(options: {config: Readonly<Record<string, unknown>>; onEntrypointLoaded(initializer: FlutterInitializer): Promise<void>}): Promise<unknown> | void;
}
export interface FlutterOptions {
  document: Document;
  getLoader(): FlutterLoader | undefined;
  loadConfig?: Readonly<Record<string, unknown>>;
  engineConfig?: Readonly<Record<string, unknown>>;
  nonce?: string;
}
const owners = new WeakMap<Document,string>();
/** Requires a generated bootstrap containing flutter_js + flutter_build_config, with NO automatic load(). */
export class FlutterAdapter implements Adapter<FlutterApp> {
  constructor(readonly options: FlutterOptions) {}
  async activate(context: LoadContext): Promise<FlutterApp> {
    if (context.release.runtime !== "flutter-web") throw new LoaderError("runtime", "Expected flutter-web release");
    const {document:doc} = this.options, key = releaseKey(context.release), owner = owners.get(doc);
    if (owner && owner !== key) throw new LoaderError("flutter-owner", "Use a separate document for independent Flutter builds");
    if (!owner && this.options.getLoader()) throw new LoaderError("flutter-owner", "An unmanaged Flutter loader already owns this document");
    owners.set(doc,key);
    const asset = context.release.assets.find(a => a.id === context.release.entrypoint)!;
    await context.bytes(asset.id);
    context.signal.throwIfAborted();
    await new Promise<void>((resolve,reject) => {
      const script = doc.createElement("script");
      const finish = (error?: unknown) => {
        script.onload = null; script.onerror = null;
        context.signal.removeEventListener("abort",abort);
        if (error) { script.remove(); reject(error); } else resolve();
      };
      const abort = () => finish(context.signal.reason);
      script.src = asset.url;
      const binary = asset.sha256.match(/../g)!.map(n => String.fromCharCode(parseInt(n,16))).join("");
      script.integrity = "sha256-" + btoa(binary); script.crossOrigin = "anonymous";
      script.referrerPolicy = "no-referrer";
      if (this.options.nonce) script.nonce = this.options.nonce;
      script.onload = () => finish(); script.onerror = () => finish(new LoaderError("bootstrap", "Flutter bootstrap failed"));
      context.signal.addEventListener("abort",abort,{once:true}); doc.head.append(script);
    });
    context.signal.throwIfAborted();
    const loader = this.options.getLoader();
    if (!loader) throw new LoaderError("bootstrap", "Generated Flutter loader is missing");
    return new Promise<FlutterApp>((resolve,reject) => {
      let called = false;
      const abort = () => reject(context.signal.reason);
      context.signal.addEventListener("abort",abort,{once:true});
      try {
        Promise.resolve(loader.load({
          config: this.options.loadConfig ?? {},
          onEntrypointLoaded: async initializer => {
            if (called) return;
            called = true;
            try {
              context.signal.throwIfAborted();
              const engine = await initializer.initializeEngine({...this.options.engineConfig, multiViewEnabled:true});
              context.signal.throwIfAborted();
              const app = await engine.runApp();
              context.signal.throwIfAborted();
              resolve(app);
            } catch (error) { reject(error); }
            finally { context.signal.removeEventListener("abort",abort); }
          }
        })).catch(error => { context.signal.removeEventListener("abort",abort); reject(error); });
      } catch(error) { context.signal.removeEventListener("abort",abort); reject(error); }
    });
  }
}
export function mountFlutterView(app: FlutterApp, hostElement: HTMLElement, initialData?: unknown): () => void {
  const id = app.addView({hostElement,initialData});
  let removed = false;
  return () => { if (!removed) { removed = true; app.removeView(id); } };
}

