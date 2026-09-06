// The contract this loader speaks is owned by owls-interfaces, not restated here.
//
// One package declares the release shape and its invariants; every host implements against
// that declaration. A second copy of the parsing rules is how a host and its contract drift
// apart without anyone noticing.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;

function resolveInterfaces() {
  const candidates = [];
  let dir = HERE;
  for (let i = 0; i <= 5; i += 1) {
    candidates.push(
      join(dir, '.vendor/.zed/owls-interfaces/index.mjs'),
      join(dir, 'owls-interfaces/index.mjs'),
      join(dir, 'ores-wasm-loaders/owls-interfaces/index.mjs'),
    );
    dir = dirname(dir);
  }
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(`owls-interfaces not found. Run \`zed install\`, or check it out under ~/codes/ores-wasm-loaders. Looked in:\n  ${candidates.join('\n  ')}`);
  }
  return found;
}

export const interfaces = await import(resolveInterfaces());
export const {
  LoaderError,
  parseRelease,
  releaseProblems,
  releaseSchema,
  preparableAssets,
  chunkForRoute,
  assetKey,
  releaseKey,
  stageOf,
  roleOf,
} = interfaces;
