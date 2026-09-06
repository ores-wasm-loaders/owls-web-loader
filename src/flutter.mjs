// Flutter web.
//
// Flutter publishes a supported loading lifecycle — the generated bootstrap, an
// entrypoint-loaded callback, `initializeEngine()`, then `runApp()` — and it already chooses
// between the WasmGC build and the JS fallback at runtime. This adapter wraps that lifecycle
// uniformly; it does not re-implement it.
//
// Two rules it exists to enforce:
//   1. The bootstrap is never executed to "warm the loader". Running it STARTS the
//      application. Preparation stays fetch-only, always.
//   2. Multi-view means several views of ONE running application. It is not a way to host
//      independently compiled Flutter builds in a shared engine, so a document that already
//      owns one release refuses a second.
import { LoaderError, releaseKey } from './contract.mjs';

const owners = new WeakMap();

/** Which startup variant this runtime will use — mirrored only to decide what to PREPARE. */
export function startupVariant(wasm = globalThis.WebAssembly) {
  return wasm && typeof wasm.Function === 'function' ? 'module' : 'fallback';
}

export class FlutterAdapter {
  constructor(options) {
    this.options = options;
  }

  async activate(context) {
    if (context.release.runtime !== 'flutter-web') throw new LoaderError('runtime', 'Expected a flutter-web release');
    const doc = this.options.document;
    const key = releaseKey(context.release);
    const owner = owners.get(doc);
    if (owner && owner !== key) throw new LoaderError('flutter-owner', 'Use a separate document for an independently compiled Flutter build');
    if (!owner && this.options.getLoader()) throw new LoaderError('flutter-owner', 'An unmanaged Flutter loader already owns this document');
    owners.set(doc, key);

    if (context.release.requiresCrossOriginIsolation && doc.defaultView && doc.defaultView.crossOriginIsolated === false) {
      this.options.log?.('[owls-flutter] release declares the threaded renderer but this document is not cross-origin isolated — Flutter will fall back');
    }

    const asset = context.release.assets.find((a) => a.id === context.release.entrypoint);
    // Fetching it verifies the digest before the browser is asked to execute it.
    await context.bytes(asset.id);
    context.signal.throwIfAborted();

    await new Promise((resolve, reject) => {
      const script = doc.createElement('script');
      const finish = (error) => {
        script.onload = null;
        script.onerror = null;
        context.signal.removeEventListener('abort', abort);
        if (error) {
          script.remove();
          reject(error);
        } else resolve();
      };
      const abort = () => finish(context.signal.reason);
      script.src = asset.url;
      // Subresource integrity from the same digest the release declares: the browser refuses
      // to execute anything the manifest did not describe.
      const binary = asset.sha256.match(/../g).map((n) => String.fromCharCode(Number.parseInt(n, 16))).join('');
      script.integrity = `sha256-${btoa(binary)}`;
      script.crossOrigin = 'anonymous';
      script.referrerPolicy = 'no-referrer';
      if (this.options.nonce) script.nonce = this.options.nonce;
      script.onload = () => finish();
      script.onerror = () => finish(new LoaderError('bootstrap', 'Flutter bootstrap failed to load'));
      context.signal.addEventListener('abort', abort, { once: true });
      doc.head.append(script);
    });
    context.signal.throwIfAborted();

    const loader = this.options.getLoader();
    if (!loader) throw new LoaderError('bootstrap', 'Generated Flutter loader is missing after the bootstrap ran');

    return new Promise((resolve, reject) => {
      let called = false;
      const abort = () => reject(context.signal.reason);
      context.signal.addEventListener('abort', abort, { once: true });
      const multiView = (context.release.activation?.mode ?? 'attach-view') === 'attach-view';
      try {
        Promise.resolve(
          loader.load({
            config: this.options.loadConfig ?? {},
            onEntrypointLoaded: async (initializer) => {
              if (called) return;
              called = true;
              try {
                context.signal.throwIfAborted();
                const engine = await initializer.initializeEngine({ ...this.options.engineConfig, multiViewEnabled: multiView });
                context.signal.throwIfAborted();
                const app = await engine.runApp();
                context.signal.throwIfAborted();
                resolve(app);
              } catch (error) {
                reject(error);
              } finally {
                context.signal.removeEventListener('abort', abort);
              }
            },
          }),
        ).catch((error) => {
          context.signal.removeEventListener('abort', abort);
          reject(error);
        });
      } catch (error) {
        context.signal.removeEventListener('abort', abort);
        reject(error);
      }
    });
  }
}

/** Attach a view to a running engine. The returned function removes just that view. */
export function mountFlutterView(app, hostElement, initialData) {
  const id = app.addView({ hostElement, initialData });
  let removed = false;
  return () => {
    if (!removed) {
      removed = true;
      app.removeView(id);
    }
  };
}
