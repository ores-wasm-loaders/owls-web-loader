// Resource hints and intent.
//
// Hints are hints: the browser decides whether to act on one, when, and whether to keep the
// result. They are emitted alongside real preparation, never instead of it.
//
//   prefetch        a resource a LATER same-site navigation will likely need.
//   preload         a resource the CURRENT document needs soon. Not a future-page cache.
//   modulepreload   a JS module for the CURRENT document's module map. Not a cross-page registry.
//
// Browser HTTP caches are partitioned by top-level site, so a hint issued on one org's
// marketing site does not warm another org's app on a different site, however shared the CDN.

import { LoaderError, preparableAssets } from './contract.mjs';

export function hintDescriptors(release, rel = 'prefetch', budget = 8 * 1024 * 1024) {
  const selected = preparableAssets(release).filter((a) => rel !== 'modulepreload' || a.kind === 'module');
  if (!Number.isSafeInteger(budget) || budget < 1 || selected.reduce((n, a) => n + a.bytes, 0) > budget) {
    throw new LoaderError('budget', 'Hints exceed the declared preparation budget');
  }
  return selected.map((asset) =>
    Object.freeze({
      rel,
      href: asset.url,
      as: rel === 'modulepreload' ? undefined : 'fetch',
      crossorigin: 'anonymous',
      referrerpolicy: 'no-referrer',
    }),
  );
}

/** Add the hints to a document. Returns a disposer, because a hint outliving its page is litter. */
export function addHints(doc, release, rel = 'prefetch', budget) {
  const links = hintDescriptors(release, rel, budget).map((descriptor) => {
    const link = doc.createElement('link');
    for (const [key, value] of Object.entries(descriptor)) if (value) link.setAttribute(key, value);
    doc.head.append(link);
    return link;
  });
  return () => links.forEach((link) => link.remove());
}

/**
 * Prepare when the visitor shows they are heading somewhere — and not before.
 *
 * A marketing page that prepares on load makes every visitor pay for a click most of them
 * will not make. `dwellMs` keeps a cursor passing over a button from costing anything;
 * pointer-down is the strongest signal short of the click itself, so it prepares immediately;
 * touch has no hover, so a trigger that stays on screen counts too; and hiding the tab
 * cancels whatever is in flight.
 *
 * Preparation is never activation: this only ever calls `coordinator.prefetch`.
 */
export function prepareOnIntent(element, coordinator, key, options = {}) {
  const { dwellMs = 120, visibilityMs = 2_000, doc = element.ownerDocument, onError = () => {} } = options;
  const controller = new AbortController();
  let timer = null;
  let started = false;

  const begin = () => {
    if (started || controller.signal.aborted) return;
    started = true;
    // A failed or cancelled preparation is a non-event: activation still works from cold.
    void coordinator.prefetch(key, controller.signal).catch(onError);
  };
  const arm = (delay) => {
    if (timer === null && !started) timer = setTimeout(() => { timer = null; begin(); }, delay);
  };
  const disarm = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const enter = () => arm(dwellMs);
  const down = () => {
    disarm();
    begin();
  };
  element.addEventListener('pointerenter', enter, { passive: true });
  element.addEventListener('focusin', enter, { passive: true });
  element.addEventListener('pointerleave', disarm, { passive: true });
  element.addEventListener('focusout', disarm, { passive: true });
  element.addEventListener('pointerdown', down, { passive: true });

  let observer = null;
  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) arm(visibilityMs);
          else disarm();
        }
      },
      { rootMargin: '0px 0px -25% 0px' },
    );
    observer.observe(element);
  }

  const onHide = () => {
    if (doc?.visibilityState === 'hidden') {
      disarm();
      controller.abort();
    }
  };
  doc?.addEventListener('visibilitychange', onHide);

  return () => {
    disarm();
    controller.abort();
    element.removeEventListener('pointerenter', enter);
    element.removeEventListener('focusin', enter);
    element.removeEventListener('pointerleave', disarm);
    element.removeEventListener('focusout', disarm);
    element.removeEventListener('pointerdown', down);
    observer?.disconnect();
    doc?.removeEventListener('visibilitychange', onHide);
  };
}

/** Prepare during idle time. Use where there is no single element that means "heading there". */
export function prepareWhenIdle(coordinator, key, onError = () => {}) {
  const controller = new AbortController();
  const start = () => {
    void coordinator.prefetch(key, controller.signal).catch(onError);
  };
  const idle = typeof globalThis.requestIdleCallback === 'function';
  const id = idle ? globalThis.requestIdleCallback(start) : setTimeout(start, 200);
  return () => {
    controller.abort();
    if (idle) globalThis.cancelIdleCallback?.(id);
    else clearTimeout(id);
  };
}

/**
 * Prerender the destination PAGE.
 *
 * This is the honest answer to "ready when we arrive": it prepares the destination's own
 * document rather than pretending a runtime can be handed across a navigation. Support and
 * eligibility vary, so it is an enhancement the click path never depends on.
 */
export function addPrerenderRule(doc, urls, { eagerness = 'moderate' } = {}) {
  if (typeof HTMLScriptElement === 'undefined' || !HTMLScriptElement.supports?.('speculationrules')) return null;
  const script = doc.createElement('script');
  script.type = 'speculationrules';
  script.textContent = JSON.stringify({ prerender: [{ source: 'list', urls, eagerness }] });
  doc.head.append(script);
  return () => script.remove();
}
