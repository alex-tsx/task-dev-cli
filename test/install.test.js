import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { report } from '../test-support/fixtures.js';

const cli = fileURLToPath(new URL('../bin/task-dev.js', import.meta.url));
const tree = { problems: ['invalid: @example/sdk@1.2.3-1234.1'], dependencies: {
  '@example/sdk': { version: '1.2.3-1234.1', invalid: '"^1.2.3" from node_modules/@example/rest' },
} };

for (const command of ['i', 'ci']) {
  test(`${command} retries eligible conflicts and validates the entire tree`, t => {
    const result = fixture(t, { command, args: ['--ignore-scripts'] });
    const npmCommand = command === 'i' ? 'install' : 'ci';
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(result.calls, [['--version'], [npmCommand, '--ignore-scripts'], [npmCommand, '--force', '--ignore-scripts'], ['ls', '--json', '--all']]);
  });
}

test('success and unrelated failures preserve npm exit codes without retry', t => {
  for (const code of [0, 2, 42]) {
    const result = fixture(t, { firstCode: code, output: 'ordinary npm output\n' });
    assert.equal(result.status, code, result.output);
    assert.deepEqual(result.calls, [['--version'], ['install']]);
  }
});

test('forced failures, malformed trees and real conflicts remain failures', t => {
  for (const config of [{ forceCode: 7 }, { tree: 'not json' },
    { tree: { ...tree, problems: [...tree.problems, 'missing: other@1'] } },
    { tree: { dependencies: {} }, lsCode: 5 }]) {
    const result = fixture(t, config);
    assert.notEqual(result.status, 0, result.output);
  }
});

test('unsupported scopes and bypass flags fail before invoking npm', t => {
  for (const args of [['--prefix', '../elsewhere'], ['--workspace=app'], ['-g'], ['--force'], ['--legacy-peer-deps']]) {
    const result = fixture(t, { args });
    assert.equal(result.status, 1);
    assert.deepEqual(result.calls, []);
  }
});

test('tree validation honors omitted dependencies and the chosen npm cache', t => {
  const args = ['--omit=dev', '--cache', '/temporary-cache'];
  const result = fixture(t, { args });
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.calls.at(-1), ['ls', '--json', '--all', ...args]);
});

function fixture(t, config) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'task-dev-mock-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const data = { command: 'i', firstCode: 1, forceCode: 0, lsCode: 1, tree, output: report(), ...config };
  writeFileSync(path.join(directory, 'package.json'), '{"name":"fixture","version":"1.0.0"}');
  const calls = path.join(directory, 'calls.jsonl');
  writeFileSync(calls, '');
  const mock = path.join(directory, 'npm-cli.js');
  writeFileSync(mock, `const fs = require('node:fs');
const config = ${JSON.stringify(data)};
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');
if (args[0] === '--version') { console.log('11.17.0'); process.exit(0); }
if (args[0] === 'ls') {
  process.stdout.write(typeof config.tree === 'string' ? config.tree : JSON.stringify(config.tree));
  process.exit(config.lsCode);
}
if (args.includes('--force')) process.exit(config.forceCode);
process.stderr.write(config.output);
process.exit(config.firstCode);
`);
  const result = spawnSync(process.execPath, [cli, data.command, ...(data.args ?? [])], {
    cwd: directory, encoding: 'utf8', env: { ...process.env, npm_execpath: mock },
  });
  return { ...result, output: result.stdout + result.stderr,
    calls: readFileSync(calls, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) };
}
