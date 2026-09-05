import type { Adapter, LoadContext } from "./coordinator.js";
export interface FlutterApp {
    addView(options: {
        hostElement: HTMLElement;
        initialData?: unknown;
    }): number;
    removeView(id: number): unknown;
}
export interface FlutterInitializer {
    initializeEngine(options: Readonly<Record<string, unknown>>): Promise<{
        runApp(): Promise<FlutterApp>;
    }>;
}
export interface FlutterLoader {
    load(options: {
        config: Readonly<Record<string, unknown>>;
        onEntrypointLoaded(initializer: FlutterInitializer): Promise<void>;
    }): Promise<unknown> | void;
}
export interface FlutterOptions {
    document: Document;
    getLoader(): FlutterLoader | undefined;
    loadConfig?: Readonly<Record<string, unknown>>;
    engineConfig?: Readonly<Record<string, unknown>>;
    nonce?: string;
}
/** Requires a generated bootstrap containing flutter_js + flutter_build_config, with NO automatic load(). */
export declare class FlutterAdapter implements Adapter<FlutterApp> {
    readonly options: FlutterOptions;
    constructor(options: FlutterOptions);
    activate(context: LoadContext): Promise<FlutterApp>;
}
export declare function mountFlutterView(app: FlutterApp, hostElement: HTMLElement, initialData?: unknown): () => void;
