// Resource hints and intent. Hints are best effort; Coordinator preparation enforces budgets.
import { LoaderError, preparableAssets } from './contract.mjs';

export function hintDescriptors(release, rel = 'prefetch', budget = 8 * 1024 * 1024) {
  const selected = preparableAssets(release).filter((asset) => rel !== 'modulepreload' || asset.kind === 'module');
  if (!Number.isSafeInteger(budget) || budget < 1 || selected.reduce((total, asset) => total + asset.bytes, 0) > budget) {
    throw new LoaderError('budget', 'Hints exceed the declared preparation budget');
  }
  return selected.map((asset) => Object.freeze({
    rel,
    href: asset.url,
    as: rel === 'modulepreload' ? undefined : 'fetch',
    crossorigin: 'anonymous',
    referrerpolicy: 'no-referrer',
  }));
}

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
 * Prepare public assets only after meaningful intent. Leases prevent one link from cancelling
 * another link's identical work. Activation remains correct when preparation is skipped,
 * cancelled, evicted, or failed.
 */
export function prepareOnIntent(element, coordinator, key, optionsOrError = {}) {
  const options = typeof optionsOrError === 'function' ? { onError: optionsOrError } : optionsOrError;
  const {
    dwellMs = 150,
    exitGraceMs = 150,
    visibilityMs = 0,
    doc = element.ownerDocument,
    onOutcome = () => {},
    onError = () => {},
  } = options;
  for (const value of [dwellMs, exitGraceMs, visibilityMs]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new LoaderError('budget', 'Intent delays must be non-negative safe integers');
    }
  }

  let pointer = false;
  let focused = false;
  let touched = false;
  let visible = false;
  let stopped = false;
  let startTimer;
  let releaseTimer;
  let lease;
  const wanted = () => pointer || focused || touched || visible;
  const safeError = (error) => { try { onError(error); } catch { /* callback isolation */ } };
  const safeOutcome = (outcome) => { try { onOutcome(outcome); } catch { /* callback isolation */ } };
  const clearStart = () => { if (startTimer !== undefined) { clearTimeout(startTimer); startTimer = undefined; } };
  const clearRelease = () => { if (releaseTimer !== undefined) { clearTimeout(releaseTimer); releaseTimer = undefined; } };
  const release = () => {
    clearRelease();
    lease?.release();
    lease = undefined;
  };
  const start = () => {
    if (stopped || lease || !wanted()) return;
    try {
      lease = coordinator.prepare(key);
      void lease.promise.then(safeOutcome, safeError);
    } catch (error) {
      safeError(error);
    }
  };
  const arm = (delay = dwellMs) => {
    clearRelease();
    if (startTimer === undefined && !lease) {
      startTimer = setTimeout(() => { startTimer = undefined; start(); }, delay);
    }
  };
  const releaseLater = () => {
    if (wanted()) { clearRelease(); return; }
    clearStart();
    if (releaseTimer !== undefined) return;
    releaseTimer = setTimeout(() => {
      releaseTimer = undefined;
      if (!wanted()) release();
    }, exitGraceMs);
  };

  const pointerEnter = () => { pointer = true; arm(); };
  const pointerLeave = () => { pointer = false; releaseLater(); };
  const focusIn = () => { focused = true; arm(); };
  const focusOut = () => { focused = false; releaseLater(); };
  const touchStart = () => { touched = true; clearStart(); start(); };
  const touchEnd = () => { touched = false; releaseLater(); };
  const pointerDown = () => { pointer = true; clearStart(); start(); };
  const hide = (event) => {
    if (event.type === 'pagehide' || doc?.visibilityState === 'hidden') {
      pointer = false;
      focused = false;
      touched = false;
      visible = false;
      clearStart();
      release();
    }
  };

  element.addEventListener('pointerenter', pointerEnter, { passive: true });
  element.addEventListener('pointerleave', pointerLeave, { passive: true });
  element.addEventListener('pointerdown', pointerDown, { passive: true });
  element.addEventListener('focusin', focusIn, { passive: true });
  element.addEventListener('focusout', focusOut, { passive: true });
  element.addEventListener('touchstart', touchStart, { passive: true });
  element.addEventListener('touchend', touchEnd, { passive: true });
  element.addEventListener('touchcancel', touchEnd, { passive: true });
  doc?.addEventListener('visibilitychange', hide);
  doc?.addEventListener('pagehide', hide);

  let observer = null;
  if (visibilityMs > 0 && typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) arm(visibilityMs);
      else releaseLater();
    }, { rootMargin: '0px 0px -25% 0px' });
    observer.observe(element);
  }

  return () => {
    stopped = true;
    pointer = false;
    focused = false;
    touched = false;
    visible = false;
    clearStart();
    release();
    element.removeEventListener('pointerenter', pointerEnter);
    element.removeEventListener('pointerleave', pointerLeave);
    element.removeEventListener('pointerdown', pointerDown);
    element.removeEventListener('focusin', focusIn);
    element.removeEventListener('focusout', focusOut);
    element.removeEventListener('touchstart', touchStart);
    element.removeEventListener('touchend', touchEnd);
    element.removeEventListener('touchcancel', touchEnd);
    doc?.removeEventListener('visibilitychange', hide);
    doc?.removeEventListener('pagehide', hide);
    observer?.disconnect();
  };
}

export function prepareWhenIdle(coordinator, key, onError = () => {}) {
  let lease;
  const start = () => {
    try {
      lease = coordinator.prepare(key);
      void lease.promise.catch(onError);
    } catch (error) {
      onError(error);
    }
  };
  const idle = typeof globalThis.requestIdleCallback === 'function';
  const id = idle ? globalThis.requestIdleCallback(start) : setTimeout(start, 200);
  return () => {
    lease?.release();
    if (idle) globalThis.cancelIdleCallback?.(id);
    else clearTimeout(id);
  };
}

export function addPrerenderRule(doc, urls, { eagerness = 'moderate' } = {}) {
  if (typeof HTMLScriptElement === 'undefined' || !HTMLScriptElement.supports?.('speculationrules')) return null;
  const script = doc.createElement('script');
  script.type = 'speculationrules';
  script.textContent = JSON.stringify({ prerender: [{ source: 'list', urls, eagerness }] });
  doc.head.append(script);
  return () => script.remove();
}
