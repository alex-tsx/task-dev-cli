import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readOptionalPeerBaseline } from '../lib/optional-peers.js';

test('records existing optional peer versions using npm ancestor lookup', async t => {
  const cwd = await directory(t);
  await fs.writeFile(path.join(cwd, 'package-lock.json'), JSON.stringify({ packages: {
    '': {},
    'node_modules/redux': { version: '4.2.1' },
    'node_modules/recharts/node_modules/react-redux': {
      peerDependencies: { redux: '^5', required: '^1', absent: '^1' },
      peerDependenciesMeta: { redux: { optional: true }, absent: { optional: true } },
    },
    'node_modules/recharts/node_modules/@example/consumer': {
      peerDependencies: { '@example/sdk': '^2' }, peerDependenciesMeta: { '@example/sdk': { optional: true } },
    },
    'node_modules/@example/sdk': { version: '1.0.0' },
    'node_modules/recharts/node_modules/@example/sdk': { version: '1.5.0' },
  } }));
  assert.deepEqual(await readOptionalPeerBaseline(cwd), [
    { name: 'redux', version: '4.2.1', spec: '^5', requesterPath: 'node_modules/recharts/node_modules/react-redux' },
    { name: '@example/sdk', version: '1.5.0', spec: '^2', requesterPath: 'node_modules/recharts/node_modules/@example/consumer' },
  ]);
});

test('uses shrinkwrap first and returns no exceptions without an existing lockfile', async t => {
  const cwd = await directory(t);
  assert.deepEqual(await readOptionalPeerBaseline(cwd), []);
  await fs.writeFile(path.join(cwd, 'package-lock.json'), 'invalid JSON');
  await fs.writeFile(path.join(cwd, 'npm-shrinkwrap.json'), '{"packages":{}}');
  assert.deepEqual(await readOptionalPeerBaseline(cwd), []);
});

async function directory(t) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'task-dev-lock-baseline-'));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  return cwd;
}
