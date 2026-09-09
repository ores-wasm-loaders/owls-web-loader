import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const interfacesRoot = resolve(root, '.tools/owls-interfaces');
const evidenceDir = resolve(root, '.contract-ir-consumer');
const sha256 = (input) => createHash('sha256').update(input).digest('hex');
const requireCondition = (condition, message) => {
  if (!condition) throw new Error(`Route dependency consumer admission failed: ${message}`);
};

const interfacesUrl = pathToFileURL(resolve(interfacesRoot, 'index.mjs')).href;
globalThis.__OWLS_INTERFACES_URL__ = interfacesUrl;
const [loaderContract, interfaces] = await Promise.all([
  import(pathToFileURL(resolve(root, 'src/contract.mjs')).href),
  import(interfacesUrl),
]);

for (const name of ['dependencyClosure', 'dependencyClosureForRoute', 'chunkForRoute']) {
  requireCondition(typeof interfaces[name] === 'function', `admitted interfaces omitted ${name}`);
  requireCondition(loaderContract[name] === interfaces[name], `${name} was copied or wrapped instead of delegated`);
}

const contractSource = await readFile(resolve(root, 'src/contract.mjs'), 'utf8');
requireCondition(!/function\s+dependencyClosure/u.test(contractSource), 'browser loader reimplemented dependencyClosure');
requireCondition(!/function\s+dependencyClosureForRoute/u.test(contractSource), 'browser loader reimplemented dependencyClosureForRoute');

const dioxus = JSON.parse(await readFile(resolve(interfacesRoot, 'fixtures/valid/dioxus.json'), 'utf8'));
const origins = [...new Set(dioxus.assets.map((asset) => new URL(asset.url).origin))];
const admitted = loaderContract.parseRelease(dioxus, origins, loaderContract.releaseSchema);
const target = loaderContract.chunkForRoute(admitted, '/app/reports/2026');
const closure = loaderContract.dependencyClosureForRoute(admitted, '/app/reports/2026').map((asset) => asset.id);
requireCondition(target === 'chunks-reports.wasm', `unexpected Dioxus route target ${target}`);
requireCondition(
  JSON.stringify(closure) === JSON.stringify(['chunks-app.wasm', 'chunks-reports.wasm']),
  `unexpected Dioxus dependency closure ${JSON.stringify(closure)}`,
);

const body = Object.freeze({
  schema: 'ores-wasm-loaders.route-dependency-consumer/v1',
  status: 'passed',
  admissible: true,
  editableAuthority: false,
  interfacesCommit: process.env.OWLS_INTERFACES_REF ?? null,
  validatorCommit: process.env.TSJSV_REF ?? null,
  target,
  closure,
  delegatedExports: ['chunkForRoute', 'dependencyClosure', 'dependencyClosureForRoute'],
});
const receipt = Object.freeze({ ...body, receiptId: sha256(JSON.stringify(body)) });
await writeFile(resolve(evidenceDir, 'route-dependency-consumer.json'), `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(receipt)}\n`);
