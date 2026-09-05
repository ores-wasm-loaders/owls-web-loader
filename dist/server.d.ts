export { parseRelease } from "./manifest.js";
export { hintDescriptors } from "./hints.js";
import { type Hint } from "./hints.js";
import type { Release } from "./types.js";
/** Input must come from parseRelease. Use for HTML Link headers, including Axum/MASH SSR. */
export declare function linkHeader(release: Release, rel?: Hint, budget?: number): string;
