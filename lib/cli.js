import fs from 'node:fs/promises';
import path from 'node:path';
import { install } from './install.js';
import { link } from './link.js';

const help = `Usage: task-dev <command> [arguments]

Commands:
  link <path> [path ...] [-- npm options]  Install copies, then link local packages
  i | install [npm arguments]              Install task-versioned dependencies
  ci [npm options]                         Clean install from the lockfile

Examples:
  task-dev link ../sdk ../rest -- --ignore-scripts
  task-dev i --ignore-scripts
  task-dev ci --offline

Run from the project's package.json directory. npm output is streamed as it runs.
See README.md for peer validation, file: lockfile changes, and symlink resolution.
`;

export async function main(args) {
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
  const options = { cwd };
  if (command !== 'link') {
    validateNpmArgs(rest);
    return install(command === 'i' ? 'install' : command, rest, options);
  }

  const separator = rest.indexOf('--');
  const paths = separator < 0 ? rest : rest.slice(0, separator);
  const npmArgs = separator < 0 ? [] : rest.slice(separator + 1);
  if (!paths.length || paths.some(input => input.startsWith('-'))) {
    throw new Error('Usage: task-dev link <path> [path ...] [-- npm options]');
  }
  if (manifest.workspaces) throw new Error('task-dev link supports standalone project roots; npm workspaces handle local packages differently.');
  validateNpmArgs(npmArgs, true);
  return link(paths, npmArgs, options);
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
