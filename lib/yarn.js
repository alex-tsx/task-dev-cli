import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readLinkPackages, replaceWithLinks, verifyInstalledCopies } from './link.js';
import { runYarn } from './yarn-process.js';
import { validateYarnPeers } from './yarn-peers.js';
import { assertYarnLock } from './yarn-lock.js';
import { readLocalDependencies } from './validate.js';
import { detachClassicLinks, excludeCopiedSourceModules } from './yarn-classic.js';
import { removeEmptyPortalRemnants } from './yarn-portals.js';

export function validateYarnArgs(args, { linking = false, ci = false } = {}) {
  for (const arg of args) {
    if (/^(?:--(?:cwd|modules-folder|global)|-C)(?:=|$)/.test(arg)) throw new Error(`${arg} changes the project scope; run task-dev from the intended project directory.`);
    if ((linking || ci) && /^--(?:no-lockfile|pure-lockfile)(?:=|$)/.test(arg)) throw new Error(`${arg} prevents retaining the dependency lockfile.`);
    if (/^--(?:pnp|enable-pnp)(?:=|$)/.test(arg)) throw new Error('Classic experimental PnP is unsupported; use Yarn 4 for Plug\'n\'Play.');
    if (arg === '--mode=update-lockfile' || (arg === 'update-lockfile' && args.includes('--mode'))) throw new Error('Yarn update-lockfile mode does not install a tree to validate.');
    if (linking && /^--(?:immutable|frozen-lockfile|dry-run)(?:=|$)/.test(arg)) throw new Error(`${arg} prevents updating the local package dependency graph.`);
    if (ci && /^--(?:no-immutable|immutable=false|frozen-lockfile=false)(?:=|$)/.test(arg)) throw new Error(`${arg} disables frozen-lockfile checks.`);
  }
}

export async function installYarn(command, args, options) {
  const { manager } = options;
  const frozen = command === 'ci';
  const before = frozen ? await assertYarnLock(options) : null;
  const adding = hasPackageSpecs(args);
  if (frozen && adding) throw new Error('task-dev ci installs the whole project; package arguments are unsupported.');
  const cliArgs = manager.major === 1
    ? [adding ? 'add' : 'install', '--non-interactive', ...(frozen ? ['--frozen-lockfile'] : []), ...args]
    : [adding ? 'add' : 'install', ...(frozen ? ['--immutable'] : []), ...args];
  const env = { ...process.env, ...options.env };
  if (!frozen && manager.major === 4) env.YARN_ENABLE_IMMUTABLE_INSTALLS = 'false';
  const manifestPath = path.join(options.cwd, 'package.json');
  const manifestBefore = await fs.readFile(manifestPath, 'utf8');
  const localPackages = manager.major === 1 ? [...new Map([
    ...await readLocalDependencies(options.cwd), ...(options.localPackages ?? []),
  ].map(pkg => [pkg.name, pkg])).values()] : [];
  const restoreMissingLinks = manager.major === 1 ? await detachClassicLinks(localPackages, options) : null;
  let result;
  try { result = await runYarn(cliArgs, { ...options, env }); }
  finally { await restoreMissingLinks?.(); }
  if (result.code !== 0 && manager.major === 4 && manager.linker === 'node-modules' &&
    await removeEmptyPortalRemnants(options.localPackages ?? [], result.output)) {
    console.warn('task-dev: removed empty directories left by Yarn during the portal transition; retrying install.');
    result = await runYarn(cliArgs, { ...options, env });
  }
  const manifestAfter = await fs.readFile(manifestPath, 'utf8');
  if (manifestBefore !== manifestAfter && isDeepStrictEqual(JSON.parse(manifestBefore), JSON.parse(manifestAfter))) {
    await fs.writeFile(manifestPath, manifestBefore);
  }
  if (result.code !== 0) return result.code;
  if (manager.major === 1) await excludeCopiedSourceModules(localPackages, { ...options, env });
  if (frozen && await fs.readFile(path.join(manager.projectRoot, 'yarn.lock'), 'utf8') !== before) {
    throw new Error('Yarn changed yarn.lock during a frozen install.');
  }
  return validateYarnPeers({ ...options, env });
}

export async function linkYarn(paths, args, options) {
  const { cwd, manager } = options;
  const packages = await readLinkPackages(paths, options);
  const filename = path.join(cwd, 'package.json');
  const raw = await fs.readFile(filename, 'utf8');
  const manifest = JSON.parse(raw);
  if (manager.major === 1 && (manifest.workspaces || manager.projectRoot !== cwd)) throw new Error('Yarn Classic linking supports standalone project roots; use workspaces for packages inside a monorepo.');
  for (const pkg of packages) {
    let relative = path.relative(cwd, pkg.target).split(path.sep).join('/');
    if (!relative.startsWith('.') && !path.isAbsolute(relative)) relative = `./${relative}`;
    const spec = `${manager.major === 1 ? 'file' : 'portal'}:${relative}`;
    const sections = ['dependencies', 'devDependencies', 'optionalDependencies'].filter(section => Object.hasOwn(manifest[section] ?? {}, pkg.name));
    if (!sections.length) sections.push('dependencies');
    for (const section of sections) {
      manifest[section] ??= {};
      manifest[section][pkg.name] = spec;
    }
  }
  const indent = raw.match(/\n([\t ]+)"/)?.[1] ?? '  ';
  await fs.writeFile(filename, `${JSON.stringify(manifest, null, indent)}\n`);
  const code = await installYarn('install', [...(manager.major === 1 ? ['--force'] : []), ...args], { ...options, localPackages: packages });
  if (code !== 0) return code;
  if (manager.major === 1) {
    await verifyInstalledCopies(packages, 'Yarn Classic');
    await replaceWithLinks(packages, path.join(cwd, 'node_modules'));
  }
  for (const pkg of packages) console.log(`task-dev: linked ${pkg.name} -> ${pkg.target}${manager.major === 4 ? ' (portal)' : ''}`);
  return 0;
}

function hasPackageSpecs(args) {
  const valueOptions = ['--registry', '--cache-folder', '--network-concurrency', '--network-timeout', '--mutex', '--mode', '--link-folder', '--preferred-cache-folder', '--production'];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (valueOptions.includes(arg)) { index++; continue; }
    if (!arg.startsWith('-')) return true;
  }
  return false;
}
