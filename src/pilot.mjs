// Progressive enhancement for Astro/HTML pages. A normal anchor is always the fallback.
import { browserPolicy } from './coordinator.mjs';
import { prepareOnIntent } from './hints.mjs';
import { LoaderError } from './contract.mjs';

/** Initial experiment settings, not a claim about bundle sizes or achieved performance. */
export function pilotPolicy(origins, overrides = {}) {
  return browserPolicy(origins, {
    maxPrepareBytes: 1024 * 1024, maxPreparingReleases: 1, concurrency: 2, ...overrides,
  });
}

/**
 * `start({signal})` must synchronously acquire runtime ownership and return a mount handle
 * promise. ActivationHost.activate does this. Omit start for normal full-page navigation.
 * Turning off `prepare` is a kill switch for speculation, not for ordinary activation.
 */
export function connectApplicationLink(element, coordinator, key, {
  start, prepare = true, onError = () => {}, intent = {},
} = {}) {
  const fail = (error) => { try { onError(error); } catch { /* UI reporting cannot break navigation */ } };
  const stopIntent = prepare
    ? prepareOnIntent(element, coordinator, key, { ...intent, prepareOnPress: false, prepareOnTouch: false, onError: fail })
    : () => {};
  const controller = new AbortController();
  let stopped = false;
  let pending = false;
  let mounted;
  const click = (event) => {
    if (stopped || !start || event.defaultPrevented || (event.button !== undefined && event.button !== 0) ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
        element.hasAttribute?.('download') || (element.target && element.target !== '_self')) return;
    const view = element.ownerDocument?.defaultView;
    let destination;
    try { destination = new URL(element.href, view?.location?.href); } catch { return; }
    if (!['https:', 'http:'].includes(destination.protocol) || destination.username || destination.password ||
        destination.origin !== view?.location?.origin) return;
    if (pending) { event.preventDefault(); return; }
    let result;
    try { result = start({ signal: controller.signal }); }
    catch (error) { fail(error); return; } // Leave the ordinary navigation untouched.
    event.preventDefault();
    pending = true;
    stopIntent(); // Runtime ownership was acquired above, before releasing preparation.
    void Promise.resolve(result).then(async (handle) => {
      mounted = handle;
      if (stopped) { await handle?.unmount?.(); throw controller.signal.reason; }
      if (!handle?.interactive || typeof handle.interactive.then !== 'function') {
        throw new LoaderError('readiness', 'Activation must expose useful-interaction readiness');
      }
      await handle.interactive;
    }).catch(async (error) => {
      try { await mounted?.unmount?.(); } catch { /* Document-scoped runtimes require navigation. */ }
      if (!stopped) { fail(error); try { view.location.assign(destination.href); } catch (navigationError) { fail(navigationError); } }
    }).finally(() => { pending = false; });
  };
  element.addEventListener('click', click);
  return () => {
    if (stopped) return;
    stopped = true;
    controller.abort(new LoaderError('cancelled', 'Link integration disposed'));
    stopIntent();
    element.removeEventListener('click', click);
    void Promise.resolve().then(() => mounted?.unmount?.()).catch(() => {});
  };
}
