import fs from 'node:fs/promises';
import path from 'node:path';
import { install } from './install.js';
import { link } from './link.js';
import { parseManagerOption, detectPackageManager, preparePackageManager } from './package-manager.js';
import { installYarn, linkYarn, validateYarnArgs } from './yarn.js';

const help = `Usage: task-dev [--package-manager npm|yarn] <command> [arguments]

Commands:
  link <path> [path ...] [-- manager options]  Link local packages with their dependency graph
  i | install [manager arguments]              Install task-versioned dependencies
  ci [manager options]                        Frozen install from the lockfile

Examples:
  task-dev link ../sdk ../rest
  task-dev i
  task-dev --package-manager yarn ci

Selects npm or Yarn from packageManager and project lockfiles, independently of npx.
Supports npm 11, Yarn Classic 1.x, and Yarn 4.x (node-modules or Plug'n'Play).
Run from the project's package.json directory. Manager output is streamed as it runs.
`;

export async function main(args) {
  const parsed = parseManagerOption(args);
  args = parsed.args;
  const [command, ...rest] = args;
  if (command === '--version' || command === '-v') {
    const manifest = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
    console.log(manifest.version);
    return 0;
  }
  if (!command || command === '--help' || command === '-h' || command === 'help' || rest.includes('--help')) {
    console.log(help);
    return 0;
  }
  if (!['link', 'i', 'install', 'ci'].includes(command)) throw new Error(`Unknown command: ${command}\n${help}`);

  const cwd = await fs.realpath(process.cwd());
  const manifest = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8'));
  const detected = await detectPackageManager(cwd, { manager: parsed.manager });
  let options = { cwd, manager: detected };
  if (command !== 'link') {
    if (detected.name === 'yarn') validateYarnArgs(rest, { ci: command === 'ci' });
    else validateNpmArgs(rest);
    options = { ...options, manager: await preparePackageManager(detected, options) };
    return detected.name === 'yarn'
      ? installYarn(command === 'i' ? 'install' : command, rest, options)
      : install(command === 'i' ? 'install' : command, rest, options);
  }

  const separator = rest.indexOf('--');
  const paths = separator < 0 ? rest : rest.slice(0, separator);
  const npmArgs = separator < 0 ? [] : rest.slice(separator + 1);
  if (!paths.length || paths.some(input => input.startsWith('-'))) {
    throw new Error('Usage: task-dev link <path> [path ...] [-- manager options]');
  }
  if (detected.name === 'npm' && manifest.workspaces) throw new Error('task-dev link supports standalone npm project roots; npm workspaces handle local packages differently.');
  if (detected.name === 'yarn') validateYarnArgs(npmArgs, { linking: true });
  else validateNpmArgs(npmArgs, true);
  options = { ...options, manager: await preparePackageManager(detected, options) };
  return detected.name === 'yarn' ? linkYarn(paths, npmArgs, options) : link(paths, npmArgs, options);
}

function validateNpmArgs(args, linking = false) {
  for (const arg of args) {
    if (/^(?:--(?:global|prefix|workspace|workspaces|location)|-[gw])(?:=|$)/.test(arg) || /^-[gw].+/.test(arg)) {
      throw new Error(`${arg} is unsupported: run task-dev from the intended standalone project root.`);
    }
    if (/^--(?:force|legacy-peer-deps)(?:=|$)/.test(arg) || arg === '-f') {
      throw new Error(`${arg} bypasses task peer checks. Let task-dev decide whether a retry is eligible.`);
    }
    if (linking && /^(?:--(?:dry-run|package-lock-only|install-strategy)|--no-(?:save|package-lock|install-links)|--(?:save|package-lock|install-links)=false)(?:=|$)/.test(arg)) {
      throw new Error(`${arg} is incompatible with installing a complete local dependency graph before linking.`);
    }
  }
}
