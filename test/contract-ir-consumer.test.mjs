import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const interfacesRef = 'f8fc1873c1b402c04f67dbf62f89b3691ba300fe';
const validatorRef = '3171025cbe03a7026a71ce94eea18c910e1431b2';

test('the consumer workflow pins the admitted multi-language contract and its verifier', async () => {
  const workflow = await readFile(new URL('.github/workflows/contract-ir-consumer.yml', root), 'utf8');
  assert.ok(workflow.includes(`OWLS_INTERFACES_REF: ${interfacesRef}`));
  assert.ok(workflow.includes(`TSJSV_REF: ${validatorRef}`));
  assert.ok(workflow.includes(`ref: ${interfacesRef}`));
  assert.ok(workflow.includes(`ref: ${validatorRef}`));
  assert.match(workflow, /--contract-ir=\.contract-ir-consumer\/contract-ir\.json/);
  assert.match(workflow, /check-language-projections\.mjs/);
  assert.match(workflow, /projection-receipt\.json/);
  assert.match(workflow, /node scripts\/verify-contract-ir-consumer\.mjs/);
  assert.match(workflow, /include-hidden-files:\s*true/);
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
