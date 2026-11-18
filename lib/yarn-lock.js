import fs from 'node:fs/promises';
import path from 'node:path';
import lockfile from '@yarnpkg/lockfile';
import semver from 'semver';
import { runYarn } from './yarn-process.js';

export async function assertYarnLock(options) {
  const { manager, cwd } = options;
  const filename = path.join(manager.projectRoot, 'yarn.lock');
  let raw;
  try { raw = await fs.readFile(filename, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('task-dev ci requires an existing yarn.lock. Run task-dev i first.');
    throw error;
  }
  if (manager.major === 1) {
    const parsed = lockfile.parse(raw);
    if (parsed.type !== 'success') throw new Error('Cannot perform a frozen install with an invalid or conflicted yarn.lock.');
    const manifest = JSON.parse(await fs.readFile(path.join(manager.projectRoot, 'package.json'), 'utf8'));
    const workspaces = await readWorkspaces(manifest, options);
    for (const project of [manifest, ...workspaces]) {
      const dependencies = { ...project.dependencies, ...project.devDependencies, ...project.optionalDependencies };
      for (const [name, spec] of Object.entries(dependencies)) {
        if (workspaces.some(workspace => workspace.name === name && semver.satisfies(workspace.version, spec))) continue;
        if (!parsed.object[`${name}@${spec}`]) throw new Error(`yarn.lock is out of sync: missing ${name}@${spec}. Run task-dev i first.`);
      }
    }
  }
  return raw;
}

async function readWorkspaces(manifest, options) {
  if (!manifest.workspaces) return [];
  const result = await runYarn(['--silent', 'workspaces', 'info', '--json'], { ...options, cwd: options.manager.projectRoot, quiet: true });
  if (result.code !== 0) throw new Error(`Cannot inspect Yarn Classic workspaces: ${result.output}`);
  const info = JSON.parse(result.stdout);
  const workspaces = typeof info.data === 'string' ? JSON.parse(info.data) : info;
  const manifests = [];
  for (const workspace of Object.values(workspaces)) {
    manifests.push(JSON.parse(await fs.readFile(path.join(options.manager.projectRoot, workspace.location, 'package.json'), 'utf8')));
  }
  return manifests;
}
