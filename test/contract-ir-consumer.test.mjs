import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

function exactRef(workflow, name) {
  const match = workflow.match(new RegExp(`^\\s*${name}:\\s*([0-9a-f]{40})\\s*$`, 'm'));
  assert.ok(match, `${name} must be a full immutable commit SHA`);
  return match[1];
}

test('the consumer workflow pins the admitted multi-language contract and its verifier', async () => {
  const workflow = await readFile(new URL('.github/workflows/contract-ir-consumer.yml', root), 'utf8');
  const interfacesRef = exactRef(workflow, 'OWLS_INTERFACES_REF');
  const validatorRef = exactRef(workflow, 'TSJSV_REF');

  assert.notEqual(interfacesRef, validatorRef, 'interface and validator source closures are distinct');
  assert.match(workflow, /ref:\s*\$\{\{ env\.OWLS_INTERFACES_REF \}\}/);
  assert.match(workflow, /ref:\s*\$\{\{ env\.TSJSV_REF \}\}/);
  assert.match(workflow, /git -C \.tools\/owls-interfaces rev-parse HEAD/);
  assert.match(workflow, /git -C \.tools\/typespec-json-schema-validator rev-parse HEAD/);
  assert.match(workflow, /--contract-ir=\.contract-ir-consumer\/contract-ir\.json/);
  assert.match(workflow, /check-language-projections\.mjs/);
  assert.match(workflow, /projection-receipt\.json/);
  assert.match(workflow, /node scripts\/verify-contract-ir-consumer\.mjs/);
  assert.match(workflow, /include-hidden-files:\s*true/);
  assert.doesNotMatch(
    workflow,
    /repository:\s*ORESoftware\/typespec-json-schema-validator[\s\S]{0,200}?ref:\s*(?:main|master|v\d+)/,
  );
});

test('the browser loader verifies IR, five-language projections, and direct contract delegation', async () => {
  const verifier = await readFile(new URL('scripts/verify-contract-ir-consumer.mjs', root), 'utf8');
  const contract = await readFile(new URL('src/contract.mjs', root), 'utf8');

  assert.match(verifier, /verifyContractIr/);
  assert.match(verifier, /computedIrId/);
  assert.match(verifier, /expectedIrId/);
  assert.match(verifier, /projectionReceipt\.receiptId/);
  assert.match(verifier, /language projection receipt self digest changed/);
  for (const language of ['typescript', 'rust', 'dart', 'go', 'gleam']) {
    assert.match(verifier, new RegExp(`${language}:`));
  }
  assert.match(verifier, /assertionDigest/);
  assert.match(verifier, /comparison-evidence-only/);
  assert.match(verifier, /independently-authored-authority/);
  assert.match(verifier, /precedence === 'none'/);
  assert.match(verifier, /__OWLS_INTERFACES_URL__/);
  assert.match(verifier, /loaderContract\[exportedName\] === interfaces\[exportedName\]/);
  assert.doesNotMatch(verifier, /process\.argv/);

  assert.doesNotMatch(contract, /class LoaderError/);
  assert.doesNotMatch(contract, /CURRENT_SCHEMA_VERSION\s*=/);
  assert.doesNotMatch(contract, /"\$defs"/);
});
