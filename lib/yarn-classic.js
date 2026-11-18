import fs from 'node:fs/promises';
import path from 'node:path';
import { runYarn } from './yarn-process.js';

export async function detachClassicLinks(packages, { cwd }) {
  const detached = [];
  for (const pkg of packages) {
    const linkPath = pkg.linkPath ?? path.join(cwd, 'node_modules', pkg.name);
    let stat;
    try { stat = await fs.lstat(linkPath); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!stat.isSymbolicLink() || await fs.realpath(linkPath) !== pkg.target) continue;
    // Classic may write .yarn-metadata.json through an existing manual symlink.
    // Detach just that symlink so Yarn must install a regular copy first.
    await fs.unlink(linkPath);
    detached.push({ ...pkg, linkPath });
  }
  return async () => {
    for (const pkg of detached) {
      try { await fs.lstat(pkg.linkPath); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await fs.symlink(pkg.target, pkg.linkPath, process.platform === 'win32' ? 'junction' : 'dir');
      }
    }
  };
}

export async function excludeCopiedSourceModules(packages, options) {
  const candidates = [];
  for (const pkg of packages) {
    if (!await directoryExists(path.join(pkg.target, 'node_modules'))) continue;
    const linkPath = pkg.linkPath ?? path.join(options.cwd, 'node_modules', pkg.name);
    const installed = await fs.lstat(linkPath);
    // Never remove anything through a live link into a user's source checkout.
    if (installed.isSymbolicLink()) continue;
    const modules = path.join(linkPath, 'node_modules');
    if (!await directoryExists(modules)) continue;
    const manifest = JSON.parse(await fs.readFile(path.join(linkPath, 'package.json'), 'utf8'));
    if (manifest.name !== pkg.name || manifest.version !== pkg.version) throw new Error(`Yarn installed an unexpected copy of ${pkg.name}; copied dependencies were left intact.`);
    candidates.push({ ...pkg, modules });
  }
  if (!candidates.length) return;

  // Classic's file: directory fetcher copies IDE node_modules too. Its public logical tree
  // distinguishes those unowned files from actual hoisted/nested dependency placements.
  const result = await runYarn(['--silent', 'list', '--json', '--depth=1'], { ...options, cwd: options.manager.projectRoot, quiet: true });
  if (result.code !== 0) throw new Error(`Cannot inspect Yarn Classic's dependency tree: ${result.output}`);
  const report = result.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line)).find(item => item.type === 'tree');
  if (!report?.data?.trees) throw new Error('Yarn Classic did not return a dependency tree; copied dependencies were left intact.');
  for (const pkg of candidates) {
    const node = report.data.trees.find(item => item.name === `${pkg.name}@${pkg.version}`);
    if (!node) throw new Error(`Cannot locate ${pkg.name} in Yarn's dependency tree; copied dependencies were left intact.`);
    if (node.children.some(child => !child.shadow)) throw new Error(`Yarn Classic installed nested dependencies inside ${pkg.name}. Move its source node_modules aside before installing; no nested dependencies were discarded.`);
  }
  for (const pkg of candidates) {
    await fs.rm(pkg.modules, { recursive: true, force: true });
    console.warn(`task-dev: excluded copied source node_modules from ${pkg.name}; Yarn's dependency tree has no nested entries there.`);
  }
}

async function directoryExists(filename) {
  try {
    const stat = await fs.lstat(filename);
    return stat.isDirectory() || stat.isSymbolicLink();
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
