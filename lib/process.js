import spawn from 'cross-spawn';
import { constants } from 'node:os';

export async function runProcess(command, args, { cwd, env = process.env, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['inherit', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let output = '';
    const limit = 64 * 1024 * 1024;
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
    const onInterrupt = () => child.kill('SIGINT');
    const onTerminate = () => child.kill('SIGTERM');
    const cleanup = () => {
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
    };
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onTerminate);
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', (code, signal) => {
      cleanup();
      resolve({ code: code ?? 128 + (constants.signals[signal] ?? 1), stdout, stderr, output });
    });
  });
}
