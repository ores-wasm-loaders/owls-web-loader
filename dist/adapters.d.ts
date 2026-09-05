import type { Adapter, LoadContext } from "./coordinator.js";
export declare class RawWasmAdapter implements Adapter<WebAssembly.Instance> {
    readonly imports: WebAssembly.Imports;
    private compiled?;
    private owner?;
    constructor(imports?: WebAssembly.Imports);
    compile(context: LoadContext): Promise<WebAssembly.Module>;
    activate(context: LoadContext): Promise<WebAssembly.Instance>;
}
export interface BindgenModule {
    default(options: {
        module_or_path: Uint8Array;
    }): Promise<unknown>;
    [name: string]: unknown;
}
/** Supply the exact build's imported glue. Only generated glue knows its imports/start function. */
export declare class BindgenAdapter<T = BindgenModule> implements Adapter<T> {
    readonly wasmAssetId: string;
    readonly loadGlue: (context: LoadContext) => Promise<BindgenModule>;
    readonly start: (glue: BindgenModule, context: LoadContext) => Promise<T>;
    constructor(wasmAssetId: string, loadGlue: (context: LoadContext) => Promise<BindgenModule>, start?: (glue: BindgenModule, context: LoadContext) => Promise<T>);
    activate(context: LoadContext): Promise<T>;
}
/** Leptos islands: hydrate once per document; no assumptions about per-island bundles. */
export declare class LeptosAdapter extends BindgenAdapter<void> {
    constructor(wasmAssetId: string, loadGlue: (context: LoadContext) => Promise<BindgenModule>, hydrate: (glue: BindgenModule) => void | Promise<void>);
}
/** Dioxus owns splitting/routing. The caller supplies its pinned build's launch hook. */
export declare class DioxusAdapter<T> extends BindgenAdapter<T> {
}
