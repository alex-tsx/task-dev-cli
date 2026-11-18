import spawn from 'cross-spawn';
import { constants } from 'node:os';
import path from 'node:path';

export async function runNpm(args, { cwd, env = process.env, quiet = false } = {}) {
  // npm scripts and npx expose the exact npm CLI that launched us. Running it with Node also
  // keeps `ci` working when npm removes this locally installed CLI from node_modules.
  const npmPath = env.npm_execpath;
  const useNode = npmPath && /^npm(?:-cli)?\.js$/i.test(path.basename(npmPath));
  const command = useNode ? process.execPath : 'npm';
  const commandArgs = useNode ? [npmPath, ...args] : args;

  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd, env, stdio: ['inherit', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let output = '';
    const limit = 16 * 1024 * 1024;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout = (stdout + chunk).slice(-limit);
      output = (output + chunk).slice(-limit);
      if (!quiet) process.stdout.write(chunk);
    });
    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk).slice(-limit);
      output = (output + chunk).slice(-limit);
      if (!quiet) process.stderr.write(chunk);
    });
    const forward = signal => child.kill(signal);
    const onInterrupt = () => forward('SIGINT');
    const onTerminate = () => forward('SIGTERM');
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onTerminate);
    child.once('error', reject);
    child.once('close', (code, signal) => {
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
      resolve({ code: code ?? 128 + (constants.signals[signal] ?? 1), stdout, stderr, output });
    });
  });
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
