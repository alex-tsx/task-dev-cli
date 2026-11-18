import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approvedConflict, taskException } from '../lib/versions.js';
import { report } from '../test-support/fixtures.js';

test('task versions satisfy full npm range syntax by their base version', () => {
  for (const range of ['^1.2.3', '~1.2', '1.x', '*', '1.0.0 - 1.9.0', '>=1.2 <2', '^0.1 || ^1.2.3',
    'git+ssh://git@example.com/sdk.git#semver:^1.2.3']) {
    assert.equal(taskException('1.2.3-1234.1+build.2', range)?.comparableVersion, '1.2.3', range);
  }
});

test('real incompatibilities and explicit task pins keep their meaning', () => {
  for (const [version, range] of [
    ['1.2.3-1234.1', '^2'], ['0.2.3-1234.1', '^0.1.0'], ['1.2.3', '^1.2.3'],
    ['1.2.3-1234.1', '1.2.3-1234.2'], ['1.2.3-1234.1', '^1.2.3-9999.1'],
    ['garbage', '*'], ['1.2.3-1234.1', 'file:../sdk'], ['1.2.3-1234.1', 'git+ssh://git@example.com/sdk.git#main'],
  ]) assert.equal(taskException(version, range), null, `${version} vs ${range}`);
  assert.ok(taskException('v1.2.3-1234.1+build', '1.2.3-1234.1'));
});

test('conflict detection supports arbitrary scopes, unscoped names, and npm log formats', () => {
  for (const name of ['@example/sdk', 'sdk']) {
    for (const prefix of ['npm error', 'npm ERR!']) {
      const output = report({ name, requester: 'rest' }).replaceAll('npm error', prefix);
      assert.equal(approvedConflict(output)?.name, name);
    }
  }
  const warning = report({ name: 'unrelated', version: '9.0.0', range: '^1' }).replaceAll('npm error', 'npm warn');
  assert.equal(approvedConflict(warning + report())?.name, '@example/sdk');
});

test('ambiguous reports and unrelated failures never authorize force', () => {
  for (const output of [report() + report(), report({ range: '^2' }), report({ version: '1.2.3' }),
    'npm error code ENOTCACHED', `${report()}Conflicting peer dependency: sdk@1\nConflicting peer dependency: sdk@2\n`]) {
    assert.equal(approvedConflict(output), null);
  }
});

test('undefined local versions require an explicitly supplied manifest version', () => {
  const output = report({ version: 'undefined' });
  assert.equal(approvedConflict(output), null);
  assert.equal(approvedConflict(output, [{ name: '@example/sdk', version: '1.2.3-1234.1' }])?.version, '1.2.3-1234.1');
  assert.equal(approvedConflict(output, [{ name: '@example/sdk', version: '2.0.0-1234.1' }]), null);
});
