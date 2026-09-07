import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = resolve(root, '.contract-ir-consumer');
const interfacesRoot = resolve(root, '.tools/owls-interfaces');
const validatorRoot = resolve(root, '.tools/typespec-json-schema-validator');
const requireCondition = (condition, message) => {
  if (!condition) throw new Error(`Contract IR consumer admission failed: ${message}`);
};
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const validator = await import(pathToFileURL(resolve(validatorRoot, 'src/index.mjs')).href);
const report = await readJson(resolve(evidenceDir, 'report.json'));
const contractIr = await readJson(resolve(evidenceDir, 'contract-ir.json'));
const recordedGeneratedSchema = report?.inputs?.generatedJsonSchema?.input;
requireCondition(typeof recordedGeneratedSchema === 'string' && recordedGeneratedSchema !== '', 'receipt omitted Schema B path');
const generatedSchema = isAbsolute(recordedGeneratedSchema)
  ? recordedGeneratedSchema
  : resolve(root, recordedGeneratedSchema);

const verification = await validator.verifyContractIr({
  contractIr,
  report,
  typespec: resolve(interfacesRoot, 'contracts/main.tsp'),
  generatedSchema,
  authoredSchema: resolve(interfacesRoot, 'schemas/release.schema.json'),
});
requireCondition(verification.status === 'passed', verification.error ?? JSON.stringify(verification));
requireCondition(verification.admissible === true, 'Contract IR was not admitted');
requireCondition(verification.suppliedIrId === contractIr.irId, 'supplied IR identity changed');
requireCondition(verification.computedIrId === contractIr.irId, 'IR self digest changed');
requireCondition(verification.expectedIrId === contractIr.irId, 'current source closure no longer reproduces the IR');
requireCondition(contractIr.authorities?.precedence === 'none', 'one authored authority was ranked above the other');
requireCondition(contractIr.editableAuthority === false, 'derived IR was promoted to an editable authority');

const admitted = new Map(
  contractIr.declarations.map((declaration) => [declaration.names.authoredJsonSchema, declaration]),
);
for (const name of ['Release', 'Asset', 'PrepareBudget', 'Activation']) {
  requireCondition(admitted.has(name), `required declaration ${name} is not admitted`);
}
for (const declaration of admitted.values()) {
  requireCondition(
    declaration.lanes.typespecGeneratedJsonSchema.role === 'comparison-evidence-only',
    `${declaration.id}: Schema B authority role changed`,
  );
  requireCondition(
    declaration.lanes.authoredJsonSchema.role === 'independently-authored-authority',
    `${declaration.id}: authored JSON Schema authority role changed`,
  );
}

const interfacesUrl = pathToFileURL(resolve(interfacesRoot, 'index.mjs')).href;
globalThis.__OWLS_INTERFACES_URL__ = interfacesUrl;
const [loaderContract, interfaces] = await Promise.all([
  import(pathToFileURL(resolve(root, 'src/contract.mjs')).href),
  import(interfacesUrl),
]);

for (const exportedName of [
  'LoaderError',
  'parseRelease',
  'releaseProblems',
  'releaseSchema',
  'preparableAssets',
  'chunkForRoute',
  'assetKey',
  'releaseKey',
  'stageOf',
  'roleOf',
]) {
  requireCondition(loaderContract[exportedName] === interfaces[exportedName], `${exportedName} was copied or wrapped instead of delegated`);
}
requireCondition(Object.isFrozen(loaderContract.releaseSchema), 'authoritative Schema A snapshot is mutable');

const fixtureDir = resolve(interfacesRoot, 'fixtures/valid');
const fixtureNames = (await readdir(fixtureDir)).filter((name) => name.endsWith('.json')).sort();
requireCondition(fixtureNames.length >= 4, 'expected the shared valid release corpus');
const fixtureResults = [];
for (const name of fixtureNames) {
  const input = await readJson(resolve(fixtureDir, name));
  const origins = [...new Set(input.assets.map((asset) => new URL(asset.url).origin))];
  const parsed = loaderContract.parseRelease(input, origins, loaderContract.releaseSchema);
  requireCondition(Object.isFrozen(parsed), `${name}: parsed release snapshot is mutable`);
  requireCondition(loaderContract.releaseKey(parsed) === `${parsed.appId}@${parsed.release}`, `${name}: release key drifted`);
  fixtureResults.push({ name, appId: parsed.appId, release: parsed.release, runtime: parsed.runtime });
}

const contractSource = await readFile(resolve(root, 'src/contract.mjs'), 'utf8');
requireCondition(!contractSource.includes('class LoaderError'), 'browser loader restated the shared error contract');
requireCondition(!contractSource.includes('CURRENT_SCHEMA_VERSION ='), 'browser loader restated schema version authority');
requireCondition(!contractSource.includes('"$defs"'), 'browser loader embedded a second JSON Schema authority');

const receipt = {
  schema: 'ores-wasm-loaders.web-loader-contract-ir-consumer/v1',
  status: 'passed',
  admissible: true,
  loaderCommit: process.env.GITHUB_SHA ?? null,
  interfacesCommit: process.env.OWLS_INTERFACES_REF ?? null,
  validatorCommit: process.env.TSJSV_REF ?? null,
  contractIrId: contractIr.irId,
  parityReceiptRunId: report.runId,
  declarations: contractIr.declarations.length,
  fixtures: fixtureResults,
};
await writeFile(resolve(evidenceDir, 'consumer-verification.json'), `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(receipt)}\n`);
