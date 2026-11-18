import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { detectPackageManager, parseManagerOption } from '../lib/package-manager.js';

test('project metadata and locks take precedence over the npx/npm launcher', async t => {
  const cwd = await fixture(t);
  const env = { npm_config_user_agent: 'npm/11.17.0' };
  await fs.writeFile(path.join(cwd, 'package.json'), '{"name":"app","packageManager":"yarn@4.18.1"}');
  await fs.writeFile(path.join(cwd, 'package-lock.json'), '{}');
  assert.equal((await detectPackageManager(cwd, { env })).name, 'yarn');
  await fs.writeFile(path.join(cwd, 'package.json'), '{"name":"app"}');
  await fs.rm(path.join(cwd, 'package-lock.json'));
  await fs.writeFile(path.join(cwd, 'yarn.lock'), '# yarn lockfile v1');
  assert.equal((await detectPackageManager(cwd, { env })).name, 'yarn');
});

test('mixed lockfiles require an explicit choice and other package managers never fall back to npm', async t => {
  const cwd = await fixture(t);
  await fs.writeFile(path.join(cwd, 'package-lock.json'), '{}');
  await fs.writeFile(path.join(cwd, 'yarn.lock'), '# yarn lockfile v1');
  await assert.rejects(detectPackageManager(cwd), /Multiple package-manager lockfiles/);
  assert.equal((await detectPackageManager(cwd, { manager: 'yarn' })).name, 'yarn');
  await fs.writeFile(path.join(cwd, 'package.json'), '{"name":"app","packageManager":"pnpm@10.0.0"}');
  await assert.rejects(detectPackageManager(cwd), /Unsupported package manager: pnpm/);
});

test('finds the workspace project root and a checked-in yarnPath', async t => {
  const root = await fixture(t);
  const cwd = path.join(root, 'packages', 'app');
  await fs.mkdir(cwd, { recursive: true });
  await fs.writeFile(path.join(cwd, 'package.json'), '{"name":"workspace"}');
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"root","packageManager":"yarn@4.18.1"}');
  await fs.writeFile(path.join(root, '.yarnrc.yml'), 'yarnPath: .yarn/releases/yarn-4.18.1.cjs\n');
  const manager = await detectPackageManager(cwd, { env: {} });
  assert.equal(manager.projectRoot, root);
  assert.equal(manager.executable, path.join(root, '.yarn/releases/yarn-4.18.1.cjs'));
});

test('manager options can precede or follow commands and stop at native passthrough', () => {
  assert.deepEqual(parseManagerOption(['i', '--package-manager=yarn', '--offline']), { manager: 'yarn', args: ['i', '--offline'] });
  assert.deepEqual(parseManagerOption(['--package-manager', 'npm', 'link', '../sdk', '--', '--package-manager=yarn']),
    { manager: 'npm', args: ['link', '../sdk', '--', '--package-manager=yarn'] });
  assert.throws(() => parseManagerOption(['i', '--package-manager', 'pnpm']), /must be npm or yarn/);
  assert.throws(() => parseManagerOption(['--package-manager=npm', 'i', '--package-manager=yarn']), /Conflicting/);
});

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'task-dev-manager-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"app"}');
  await fs.mkdir(path.join(root, '.git'));
  return root;
}
