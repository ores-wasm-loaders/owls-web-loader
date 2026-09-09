// Framework-neutral route preparation for split WASM releases.
//
// This module never executes application or framework code. It resolves the immutable route asset
// dependency DAG admitted by owls-interfaces and asks the existing Coordinator byte boundary to
// fetch, verify, deduplicate, and cache each asset. Dioxus/Leptos/native adapters still own activation.
import {
  LoaderError,
  chunkForRoute,
  dependencyClosureForRoute,
  releaseKey,
} from './contract.mjs';

const freezeSkipped = (entries) => Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));

function receipt(release, route, target, prepared, skipped, bytes, status, reason) {
  return Object.freeze({
    key: releaseKey(release),
    appId: release.appId,
    release: release.release,
    route,
    target,
    status,
    ready: status === 'warmed',
    prepared: Object.freeze([...prepared]),
    skipped: freezeSkipped(skipped),
    bytes,
    ...(reason ? { reason } : {}),
  });
}

function validateCoordinator(coordinator) {
  if (!coordinator || typeof coordinator.get !== 'function' || typeof coordinator.bytes !== 'function') {
    throw new TypeError('prefetchRoute requires a Coordinator-compatible get()/bytes() boundary');
  }
  const policy = coordinator.policy;
  if (!policy || !Number.isSafeInteger(policy.maxPrepareBytes) || !Number.isSafeInteger(policy.maxAssetBytes)) {
    throw new TypeError('prefetchRoute requires Coordinator preparation policy limits');
  }
  return policy;
}

/**
 * Fetch, verify, and cache the dependency closure for one admitted route.
 *
 * Route intent is more specific than ambient release preparation, so `prepare:false` / `stage:lazy`
 * assets in the declared route closure are eligible here. The same page/release preparation budget
 * still applies, and a failed dependency blocks its dependents from being reported as prepared.
 */
export async function prefetchRoute(coordinator, key, route, signal) {
  const policy = validateCoordinator(coordinator);
  if (typeof route !== 'string' || !route.startsWith('/') || route.length > 2048) {
    throw new LoaderError('route', 'Route preparation requires an absolute application path');
  }

  const release = coordinator.get(key);
  const target = chunkForRoute(release, route);
  if (!target) return receipt(release, route, null, [], [], 0, 'skipped', 'unmapped-route');

  const assets = dependencyClosureForRoute(release, route);
  if (!assets.length) {
    throw new LoaderError('manifest', `Route \`${route}\` resolved to \`${target}\` without an asset closure`);
  }

  if (!policy.allowPreparation(release)) {
    return receipt(
      release,
      route,
      target,
      [],
      assets.map((asset) => ({ id: asset.id, reason: 'policy-declined' })),
      0,
      'skipped',
      'policy-declined',
    );
  }

  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason ?? new LoaderError('cancelled', 'Route preparation cancelled'));
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new LoaderError('timeout', 'Route preparation timed out')),
    policy.timeoutMs,
  );

  const prepared = [];
  const preparedIds = new Set();
  const skipped = [];
  let spent = 0;
  let reserved = 0;
  let firstFailure;
  const budget = Math.min(
    policy.maxPrepareBytes,
    release.prepareBudget?.maxBytes ?? policy.maxPrepareBytes,
  );

  try {
    for (const asset of assets) {
      if (controller.signal.aborted) {
        skipped.push({ id: asset.id, reason: 'cancelled' });
        continue;
      }
      if ((asset.dependencies ?? []).some((dependency) => !preparedIds.has(dependency))) {
        skipped.push({ id: asset.id, reason: 'dependency-unavailable' });
        continue;
      }
      if (asset.bytes > policy.maxAssetBytes) {
        skipped.push({ id: asset.id, reason: 'over-asset-limit' });
        continue;
      }
      if (reserved + asset.bytes > budget) {
        skipped.push({ id: asset.id, reason: 'over-budget' });
        continue;
      }

      // Failed and partially transferred requests still consume their speculative reservation.
      reserved += asset.bytes;
      try {
        await coordinator.bytes(release, asset.id, controller.signal);
        controller.signal.throwIfAborted();
        prepared.push(asset.id);
        preparedIds.add(asset.id);
        spent += asset.bytes;
      } catch (error) {
        firstFailure ??= error;
        skipped.push({ id: asset.id, reason: controller.signal.aborted ? 'cancelled' : 'failed' });
      }
    }

    const cancelled = controller.signal.aborted;
    const failed = skipped.some((entry) => entry.reason === 'failed' || entry.reason === 'dependency-unavailable');
    const status = cancelled
      ? 'cancelled'
      : failed
        ? prepared.length ? 'partial' : 'failed'
        : skipped.length
          ? 'partial'
          : 'warmed';
    const reason = cancelled
      ? controller.signal.reason instanceof Error ? controller.signal.reason.message : String(controller.signal.reason ?? 'cancelled')
      : firstFailure instanceof Error ? firstFailure.message : firstFailure ? String(firstFailure) : undefined;
    return receipt(release, route, target, prepared, skipped, spent, status, reason);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
