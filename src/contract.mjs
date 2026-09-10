// Browser- and Node-safe resolution of the shared contracts owned by owls-interfaces.
//
// Browser deployments should place owls-interfaces beside owls-web-loader, or set
// `globalThis.__OWLS_INTERFACES_URL__` before dynamically importing the loader. Node keeps the
// zed/source-tree discovery path, but imports node builtins only inside the Node branch.
const OVERRIDE = '__OWLS_INTERFACES_URL__';

function configuredUrl() {
  const value = globalThis[OVERRIDE];
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${OVERRIDE} must be a non-empty module URL when configured`);
  }
  return new URL(value, import.meta.url).href;
}

async function importFirst(candidates, label) {
  const failures = [];
  for (const candidate of candidates) {
    try {
      return await import(candidate);
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`${label}. Tried:\n  ${failures.join('\n  ')}`);
}

async function loadInterfaces() {
  const configured = configuredUrl();
  if (configured) return import(configured);

  if (globalThis.process?.versions?.node) {
    const [{ existsSync }, { dirname, join }, { fileURLToPath, pathToFileURL }] = await Promise.all([
      import('node:fs'),
      import('node:path'),
      import('node:url'),
    ]);
    const candidates = [];
    let dir = fileURLToPath(new URL('.', import.meta.url));
    for (let i = 0; i <= 5; i += 1) {
      candidates.push(
        join(dir, '.vendor/.zed/owls-interfaces/index.mjs'),
        join(dir, 'owls-interfaces/index.mjs'),
        join(dir, 'ores-wasm-loaders/owls-interfaces/index.mjs'),
      );
      dir = dirname(dir);
    }
    const found = candidates.find((path) => existsSync(path));
    if (!found) {
      throw new Error(`owls-interfaces not found. Run \`zed install\`, check out the sibling repository, or set ${OVERRIDE}. Looked in:\n  ${candidates.join('\n  ')}`);
    }
    return import(pathToFileURL(found).href);
  }

  return importFirst([
    new URL('../../owls-interfaces/index.mjs', import.meta.url).href,
    new URL('../owls-interfaces/index.mjs', import.meta.url).href,
  ], `owls-interfaces not found beside the browser loader; set ${OVERRIDE} before importing owls-web-loader`);
}

export const interfaces = await loadInterfaces();
export const {
  LoaderError,
  parseRelease,
  releaseProblems,
  releaseSchema,
  preparableAssets,
  dependencyClosure,
  dependencyClosureForRoute,
  chunkForRoute,
  assetKey,
  releaseKey,
  stageOf,
  roleOf,
  configSchema,
  parseOresWasmConfig,
  configProblems,
  resolveOresWasmEnv,
} = interfaces;
