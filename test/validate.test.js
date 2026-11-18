import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { validateTree } from '../lib/validate.js';

const options = { cwd: process.cwd() };

test('every invalid edge must qualify, including multiple edges on one node', async () => {
  const tree = invalidTree('"^1.2" from node_modules/@example/rest, "^1" from node_modules/other');
  assert.equal((await validateTree(tree, options)).ok, true);
  tree.dependencies.sdk.invalid += ', "^2" from node_modules/broken';
  const result = await validateTree(tree, options);
  assert.equal(result.ok, false);
  assert.match(result.rejected.join(), /broken requires \^2/);
});

test('missing, extraneous, unrecognized and nested problems are rejected', async () => {
  for (const problem of ['missing: other@1', 'extraneous: other@1', 'invalid: other@9']) {
    const tree = invalidTree('"^1" from node_modules/rest');
    tree.dependencies.sdk.problems = [problem];
    assert.equal((await validateTree(tree, options)).ok, false, problem);
  }
  const tree = invalidTree(true);
  assert.equal((await validateTree(tree, options)).ok, false);
});

test('local root file exceptions are restricted to the explicitly linked target', async () => {
  const tree = invalidTree('"file:../sdk" from the root project');
  const localPackages = [{ name: 'sdk', target: path.resolve(options.cwd, '../sdk') }];
  assert.equal((await validateTree(tree, { ...options, localPackages })).ok, true);
  assert.equal((await validateTree(tree, options)).ok, false);
  tree.dependencies.sdk.invalid += ', "^2" from node_modules/other';
  assert.equal((await validateTree(tree, { ...options, localPackages })).ok, false);
});

test('optional peer exceptions require an unchanged lockfile edge and actual optional metadata', async t => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'task-dev-optional-'));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const requester = path.join(cwd, 'node_modules', 'outer', 'node_modules', 'rest');
  await fs.mkdir(requester, { recursive: true });
  const manifest = path.join(requester, 'package.json');
  await fs.writeFile(manifest, JSON.stringify({ peerDependencies: { sdk: '^2' }, peerDependenciesMeta: { sdk: { optional: true } } }));
  const tree = invalidTree('"^2" from node_modules/outer/node_modules/rest');
  const existingOptionalPeers = [{ name: 'sdk', version: '1.2.3-1234.1', spec: '^2', requesterPath: 'node_modules/outer/node_modules/rest' }];
  assert.equal((await validateTree(tree, { cwd })).ok, false);
  assert.equal((await validateTree(tree, { cwd, existingOptionalPeers })).ok, true);
  assert.equal((await validateTree(tree, { cwd, existingOptionalPeers: [{ ...existingOptionalPeers[0], version: '1.2.3-1234.2' }] })).ok, false);
  assert.equal((await validateTree(tree, { cwd, existingOptionalPeers: [{ ...existingOptionalPeers[0], spec: '^3' }] })).ok, false);
  await fs.writeFile(manifest, JSON.stringify({ peerDependencies: { sdk: '^2' } }));
  assert.equal((await validateTree(tree, { cwd, existingOptionalPeers })).ok, false);
});

function invalidTree(invalid) {
  return { problems: ['invalid: sdk@1.2.3-1234.1 /app/node_modules/sdk'], dependencies: {
    sdk: { version: '1.2.3-1234.1', invalid },
  } };
}
