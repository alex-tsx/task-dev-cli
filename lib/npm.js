import path from 'node:path';
import { runProcess } from './process.js';

export async function runNpm(args, { cwd, env = process.env, quiet = false } = {}) {
  // npm scripts and npx expose the exact npm CLI that launched us. Running it with Node also
  // keeps `ci` working when npm removes this locally installed CLI from node_modules.
  const npmPath = env.npm_execpath;
  const useNode = npmPath && /^npm(?:-cli)?\.js$/i.test(path.basename(npmPath));
  const command = useNode ? process.execPath : 'npm';
  const commandArgs = useNode ? [npmPath, ...args] : args;

  return runProcess(command, commandArgs, { cwd, env, quiet });
}

export function selectNpmOptions(args, names) {
  const selected = [];
  const valueOptions = new Set(['--omit', '--include', '--only', '--also', '--cache', '--userconfig', '--globalconfig', '--registry', '--loglevel']);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const name = arg.split('=')[0];
    if (!names.includes(name)) continue;
    selected.push(arg);
    if (!arg.includes('=') && valueOptions.has(name) && args[index + 1] !== undefined) selected.push(args[++index]);
  }
  return selected;
}
