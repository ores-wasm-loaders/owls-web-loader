export type MarketingVariant = 'module' | 'fallback';

export type MarketingPreparationStatus = 'warmed' | 'partial' | 'failed' | 'cancelled' | 'skipped';

export interface MarketingPreparationOutcome {
  readonly key: string;
  readonly appId: string;
  readonly release: string;
  readonly variant: MarketingVariant;
  readonly status: MarketingPreparationStatus;
  readonly prepared: readonly string[];
  readonly skipped: readonly Readonly<{ id: string | null; reason: string }>[];
  readonly bytes: number;
  readonly cancelled: boolean;
  readonly reason?: string;
}

export interface MarketingPreparationLease {
  readonly promise: Promise<MarketingPreparationOutcome>;
  readonly done: Promise<MarketingPreparationOutcome>;
  release(): void;
}

/** The narrow Coordinator surface the HTML-first integration consumes. */
export interface MarketingCoordinator {
  load(
    url: string,
    options: { readonly fetcher: typeof fetch; readonly signal?: AbortSignal },
  ): Promise<Readonly<{ appId: string; release: string }>>;

  prepare(
    key: string,
    signal?: AbortSignal,
    options?: { readonly variant?: MarketingVariant },
  ): MarketingPreparationLease;
}

export interface MarketingOutcome {
  readonly element: Element;
  readonly manifestUrl: string;
  readonly variant: MarketingVariant;
  readonly key: string;
  readonly outcome: MarketingPreparationOutcome;
}

export interface MarketingError {
  readonly element: Element;
  readonly manifestUrl: string | null;
  readonly variant: MarketingVariant | null;
  readonly error: unknown;
}

export interface MarketingIntentOptions {
  readonly coordinator: MarketingCoordinator;
  readonly root?: ParentNode;
  readonly selector?: string;
  readonly fetcher?: typeof fetch;
  readonly dwellMs?: number;
  readonly exitGraceMs?: number;
  readonly visibilityMs?: number;
  readonly onOutcome?: (event: MarketingOutcome) => void | Promise<void>;
  readonly onError?: (event: MarketingError) => void | Promise<void>;
}

export interface MarketingIntentInstallation {
  readonly count: number;
  dispose(): void;
}

/** Install HTML-first, fetch-only intent preparation on `data-owls-manifest` links. */
export declare function installMarketingIntentLoader(
  options: MarketingIntentOptions,
): MarketingIntentInstallation;
