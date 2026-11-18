import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { replaceWithLinks } from '../lib/link.js';

test('a later linking failure restores previously replaced package copies', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'task-dev-rollback-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const modules = path.join(root, 'node_modules');
  const source = path.join(root, 'source');
  const installed = path.join(modules, 'sdk');
  await fs.mkdir(installed, { recursive: true });
  await fs.mkdir(source);
  await fs.writeFile(path.join(installed, 'index.js'), 'installed copy');
  await fs.writeFile(path.join(source, 'index.js'), 'live source');
  await assert.rejects(replaceWithLinks([
    { linkPath: installed, target: source },
    { linkPath: path.join(modules, 'missing'), target: source },
  ], modules), { code: 'ENOENT' });
  assert.equal((await fs.lstat(installed)).isSymbolicLink(), false);
  assert.equal(await fs.readFile(path.join(installed, 'index.js'), 'utf8'), 'installed copy');
  assert.equal(await fs.readFile(path.join(source, 'index.js'), 'utf8'), 'live source');
  assert.deepEqual(await fs.readdir(modules), ['sdk']);
});
