// Server-side rendering support: the Link headers a MASH/Axum page can emit for a release it
// is about to link to. Hints only — the browser decides whether to act on them, and the click
// path never depends on one having worked.
export { hintDescriptors } from './hints.mjs';
import { hintDescriptors } from './hints.mjs';

/** Input must come from Coordinator.register / parseRelease. */
export function linkHeader(release, rel = 'prefetch', budget) {
  return hintDescriptors(release, rel, budget)
    .map((h) => {
      // Header delimiters must remain data even in a manually constructed descriptor.
      const href = new URL(h.href).href.replace(/[<>"\\]/g, (c) => encodeURIComponent(c));
      return `<${href}>; rel=${h.rel}; ${h.as ? 'as=fetch; ' : ''}crossorigin=anonymous`;
    })
    .join(', ');
}
