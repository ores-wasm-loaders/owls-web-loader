export {parseRelease} from "./manifest.js";
export {hintDescriptors} from "./hints.js";
import {hintDescriptors, type Hint} from "./hints.js";
import type {Release} from "./types.js";
/** Input must come from parseRelease. Use for HTML Link headers, including Axum/MASH SSR. */
export function linkHeader(release: Release, rel: Hint = "prefetch", budget?: number): string {
  return hintDescriptors(release,rel,budget).map(h => {
    // Header delimiters must remain data even in manually constructed typed objects.
    const href = new URL(h.href).href.replace(/[<>"\\]/g,c => encodeURIComponent(c));
    return `<${href}>; rel=${h.rel}; ${h.as ? "as=fetch; " : ""}crossorigin=anonymous`;
  }).join(", ");
}

