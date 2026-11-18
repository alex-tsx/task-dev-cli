import fs from 'node:fs/promises';
import path from 'node:path';
import { install } from './install.js';

export async function link(paths, npmArgs, options) {
  const { cwd } = options;
  const packages = [];
  const names = new Set();
  const modules = path.join(cwd, 'node_modules');
  for (const input of paths) {
    const target = await fs.realpath(path.resolve(cwd, input));
    if (cwd === target || cwd.startsWith(`${target}${path.sep}`) ||
      target === modules || target.startsWith(`${modules}${path.sep}`)) {
      throw new Error(`Cannot link ${input}: choose a package outside the project's node_modules and its parent directories.`);
    }
    const manifest = JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8'));
    const name = manifest.name;
    if (typeof name !== 'string' || !/^(?:@[a-z\d][a-z\d._-]*\/)?[a-z\d][a-z\d._-]*$/i.test(name)) {
      throw new Error(`${input} must have a valid package.json name.`);
    }
    if (names.has(name)) throw new Error(`Duplicate local package name: ${name}`);
    names.add(name);
    if (await hasModules(path.join(target, 'node_modules'))) {
      console.warn(`task-dev: ${name} has its own node_modules, which can shadow the app's dependencies. Move it aside (for example to ide_node_modules) during development. Its contents will be left unchanged.`);
    }
    packages.push({ name, version: manifest.version, target, linkPath: path.join(modules, name) });
  }

  // Install the source directories as ordinary packages first, so npm owns the complete
  // dependency graph and lockfile. --no-save would prevent that lockfile from being written.
  const code = await install('install', [...npmArgs, '--save', '--package-lock', '--install-links',
    ...packages.map(pkg => pkg.target)], { ...options, localPackages: packages });
  if (code !== 0) return code;

  // A live directory symlink cannot also retain node_modules nested in the installed copy. Refuse
  // that layout before replacing anything, rather than silently discarding version-specific dependencies.
  for (const pkg of packages) {
    const stat = await fs.lstat(pkg.linkPath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`npm did not install a regular copy of ${pkg.name}; no package directories were replaced.`);
    }
    const installed = JSON.parse(await fs.readFile(path.join(pkg.linkPath, 'package.json'), 'utf8'));
    if (installed.name !== pkg.name || installed.version !== pkg.version) {
      throw new Error(`npm installed a different package in place of ${pkg.name}@${pkg.version}; no copies were replaced.`);
    }
    if (await hasModules(path.join(pkg.linkPath, 'node_modules'))) {
      throw new Error(`npm installed nested dependencies inside ${pkg.name}. Align the conflicting dependency versions before linking. The installed copies and lockfile have been kept intact.`);
    }
  }

  await replaceWithLinks(packages, modules);
  for (const pkg of packages) console.log(`task-dev: linked ${pkg.name} -> ${pkg.target}`);
  return 0;
}

export async function replaceWithLinks(packages, modules) {
  const backup = await fs.mkdtemp(path.join(modules, '.task-dev-'));
  const moved = [];
  try {
    for (const pkg of packages) {
      const saved = path.join(backup, String(moved.length));
      await fs.rename(pkg.linkPath, saved);
      moved.push({ ...pkg, saved });
      await fs.symlink(pkg.target, pkg.linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    }
  } catch (error) {
    const failures = [error];
    for (const pkg of moved.toReversed()) {
      try {
        await fs.rm(pkg.linkPath, { recursive: true, force: true });
        await fs.rename(pkg.saved, pkg.linkPath);
      } catch (rollbackError) {
        failures.push(rollbackError);
      }
    }
    if (failures.length > 1) throw new AggregateError(failures, `Link rollback failed; original copies remain in ${backup}`);
    await fs.rm(backup, { recursive: true, force: true });
    throw error;
  }
  await fs.rm(backup, { recursive: true, force: true });
}

async function hasModules(directory) {
  try {
    const stat = await fs.lstat(directory);
    return stat.isSymbolicLink() || (await fs.readdir(directory)).length > 0;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
