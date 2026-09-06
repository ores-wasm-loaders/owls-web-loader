// Dependency-free bridge: inject the product's ores-otel writer. No user data or raw URLs.
const PHASES = new Set(['intent', 'fetch', 'prepare-start', 'prepared', 'prepare-cancelled',
  'activate-start', 'activated', 'mount-start', 'runtime-ready', 'mounted', 'interactive',
  'unmounted', 'deactivated', 'mount-error', 'error']);
const PUBLIC_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function createLoaderReporter({ write, now = () => performance.now(), maxContexts = 128, labels = {} } = {}) {
  if (typeof write !== 'function' || !Number.isSafeInteger(maxContexts) || maxContexts < 1) {
    throw new TypeError('Reporter requires a writer and a positive bounded context count');
  }
  const starts = new Map();
  const fixed = {};
  if (['A', 'B', 'C', 'D'].includes(labels.cohort)) fixed.cohort = labels.cohort;
  if (['leptos', 'dioxus', 'flutter', 'none'].includes(labels.framework)) fixed.framework = labels.framework;
  if (['wasm', 'javascript', 'unknown'].includes(labels.runtimeMode)) fixed.runtimeMode = labels.runtimeMode;
  return (input) => {
    if (!input || !PHASES.has(input.phase) || !PUBLIC_ID.test(input.appId ?? '') || !PUBLIC_ID.test(input.release ?? '')) return;
    const event = { ...fixed, phase: input.phase, appId: input.appId, release: input.release };
    const operation = Number.isSafeInteger(input.operation) && input.operation >= 0 ? input.operation : 'runtime';
    const key = `${input.appId}@${input.release}:${operation}`;
    const time = now();
    if (input.phase === 'activate-start' || input.phase === 'mount-start') {
      if (starts.size >= maxContexts && !starts.has(key)) starts.delete(starts.keys().next().value);
      starts.set(key, time);
    }
    if (['activated', 'interactive'].includes(input.phase) && starts.has(key)) {
      const elapsed = time - starts.get(key);
      if (Number.isFinite(elapsed) && elapsed >= 0) event.durationMs = elapsed;
      starts.delete(key);
    }
    if (['error', 'mount-error', 'unmounted', 'deactivated'].includes(input.phase)) starts.delete(key);
    for (const field of ['bytes', 'prepared', 'skipped']) {
      if (Number.isSafeInteger(input[field]) && input[field] >= 0) event[field] = input[field];
    }
    if (['module', 'fallback'].includes(input.variant)) event.variant = input.variant;
    if (['warmed', 'partial', 'failed', 'skipped', 'cancelled'].includes(input.status)) event.status = input.status;
    if (typeof input.cancelled === 'boolean') event.cancelled = input.cancelled;
    try { write(Object.freeze(event)); } catch { /* Telemetry must never break the loader. */ }
  };
}
