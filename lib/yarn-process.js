import { runProcess } from './process.js';

export async function runYarn(args, { manager, ...options }) {
  const env = { ...process.env, ...options.env, COREPACK_ENABLE_AUTO_PIN: '0' };
  return manager.executable
    ? runProcess(process.execPath, [manager.executable, ...args], { ...options, env })
    : runProcess('yarn', args, { ...options, env });
}
