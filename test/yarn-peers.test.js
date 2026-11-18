import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkYarnPeers } from '../lib/yarn-peers.js';

test('Yarn accepts compatible task and Git-semver peers while retaining exact task pins', () => {
  const base = { name: '@example/sdk', version: '1.2.3-6509.4', requester: 'consumer', requesterVersion: '1.0.0' };
  for (const spec of ['^1.2.3', '1.x', 'git+ssh://git@example.com/sdk.git#semver:^1.2.3', '1.2.3-6509.4']) {
    assert.deepEqual(checkYarnPeers([{ ...base, spec }]).rejected, [], spec);
  }
  for (const spec of ['^2.0.0', '1.2.3-6509.5']) {
    assert.equal(checkYarnPeers([{ ...base, spec }]).rejected.length, 1, spec);
  }
});

test('missing providers and optional integrations keep native Yarn warning semantics', () => {
  const peer = { name: 'sdk', spec: '^1', version: null, requester: 'consumer', requesterVersion: '1' };
  assert.deepEqual(checkYarnPeers([peer]).rejected, []);
  assert.deepEqual(checkYarnPeers([{ ...peer, optional: true }]).rejected, []);
  assert.deepEqual(checkYarnPeers([{ ...peer, optional: true, version: '2.0.0' }]).rejected, []);
});
