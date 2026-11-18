import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import semver from 'semver';
import { runNpm } from './npm.js';
import { runYarn } from './yarn-process.js';

const lockfiles = [
  ['npm-shrinkwrap.json', 'npm'], ['package-lock.json', 'npm'], ['yarn.lock', 'yarn'],
  ['pnpm-lock.yaml', 'pnpm'], ['bun.lock', 'bun'], ['bun.lockb', 'bun'],
];

export function parseManagerOption(args) {
  const remaining = [];
  let manager;
  let passthrough = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--') passthrough = true;
    if (!passthrough && (arg === '--package-manager' || arg.startsWith('--package-manager='))) {
      const value = arg === '--package-manager' ? args[++index] : arg.slice('--package-manager='.length);
      if (!['npm', 'yarn'].includes(value)) throw new Error('--package-manager must be npm or yarn.');
      if (manager && manager !== value) throw new Error('Conflicting --package-manager options.');
      manager = value;
    } else remaining.push(arg);
  }
  return { args: remaining, manager };
}

export async function detectPackageManager(cwd, { manager, env = process.env } = {}) {
  let directory = cwd;
  while (true) {
    const raw = await readOptional(path.join(directory, 'package.json'));
    const manifest = raw ? JSON.parse(raw) : {};
    const declared = manifest.packageManager?.split('@')[0] ?? manifest.devEngines?.packageManager?.name;
    const locks = new Set();
    for (const [filename, name] of lockfiles) {
      if (await exists(path.join(directory, filename))) locks.add(name);
    }
    const yarnConfig = await exists(path.join(directory, '.yarnrc.yml')) || await exists(path.join(directory, '.yarnrc'));
    const boundary = await exists(path.join(directory, '.git')) || path.dirname(directory) === directory;
    if (declared || locks.size || yarnConfig || boundary) {
      if (!manager && !declared && locks.size > 1) {
        throw new Error(`Multiple package-manager lockfiles in ${directory}. Set packageManager in package.json or use --package-manager npm|yarn.`);
      }
      const name = manager ?? declared ?? [...locks][0] ?? (yarnConfig || /^yarn\//.test(env.npm_config_user_agent ?? '') ? 'yarn' : 'npm');
      if (!['npm', 'yarn'].includes(name)) throw new Error(`Unsupported package manager: ${name}. Supported: npm, Yarn Classic 1.x and Yarn 4.x.`);
      const projectRoot = declared || locks.size || yarnConfig ? directory : cwd;
      const executable = name === 'yarn' ? await findYarnPath(cwd, projectRoot, env) : undefined;
      return { name, projectRoot, executable, declaredVersion: manager ? undefined : manifest.packageManager?.split('@')[1] };
    }
    directory = path.dirname(directory);
  }
}

export async function preparePackageManager(manager, options) {
  const result = manager.name === 'npm'
    ? await runNpm(['--version'], { ...options, quiet: true })
    : await runYarn(['--version'], { ...options, manager, quiet: true });
  if (result.code !== 0) throw new Error(`Cannot run ${manager.name}: ${result.output.trim()}`);
  const version = result.stdout.trim();
  if (!semver.valid(version)) throw new Error(`Unrecognized ${manager.name} version: ${version}`);
  if (manager.name === 'npm') {
    if (!semver.satisfies(version, '>=11.10.0 <12')) throw new Error(`npm ${version} is unsupported; use npm >=11.10.0 <12.`);
    return { ...manager, version };
  }
  const major = semver.major(version);
  if (major !== 1 && major !== 4) throw new Error(`Yarn ${version} is unsupported; use Yarn Classic 1.x or Yarn 4.x.`);
  const declaredMajor = manager.declaredVersion?.match(/^(\d+)\./)?.[1];
  if (declaredMajor && Number(declaredMajor) !== major) throw new Error(`The project requests Yarn ${manager.declaredVersion}, but Yarn ${version} ran. Activate the project's Yarn version first.`);
  let linker = 'node-modules';
  if (major === 1) {
    const manifest = JSON.parse(await fs.readFile(path.join(manager.projectRoot, 'package.json'), 'utf8'));
    const config = await runYarn(['--silent', 'config', 'get', 'plugnplay-override'], { ...options, manager, quiet: true });
    if (config.code !== 0) throw new Error(`Cannot read Yarn Classic's PnP setting: ${config.output.trim()}`);
    const override = config.stdout.trim();
    const enabled = override === 'undefined' ? manifest.installConfig?.pnp : !['false', '0', ''].includes(override);
    if (enabled) throw new Error('Classic experimental PnP is unsupported; use Yarn 4 for Plug\'n\'Play.');
  } else {
    const config = await runYarn(['config', 'get', 'nodeLinker', '--json'], { ...options, manager, quiet: true });
    if (config.code !== 0) throw new Error(`Cannot read Yarn's nodeLinker: ${config.output.trim()}`);
    linker = JSON.parse(config.stdout);
    if (!['pnp', 'node-modules'].includes(linker)) throw new Error(`Unsupported Yarn nodeLinker: ${linker}. Supported: pnp, node-modules.`);
  }
  return { ...manager, version, major, linker };
}

async function findYarnPath(cwd, projectRoot, env) {
  if (env.npm_execpath && /^yarn(?:[-.].*)?\.(?:c?js|mjs)$/i.test(path.basename(env.npm_execpath))) return env.npm_execpath;
  let directory = cwd;
  while (true) {
    const raw = await readOptional(path.join(directory, '.yarnrc.yml'));
    if (raw) {
      const config = parse(raw);
      if (typeof config?.yarnPath === 'string') return path.resolve(directory, config.yarnPath);
    }
    if (directory === projectRoot || path.dirname(directory) === directory) return undefined;
    directory = path.dirname(directory);
  }
}

async function readOptional(filename) {
  try { return await fs.readFile(filename, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function exists(filename) {
  try { await fs.stat(filename); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
