import { readFileSync } from 'node:fs';
import semver from 'semver';
import { extractRange, taskException } from './versions.js';
import { runYarn } from './yarn-process.js';

// Load before installing: ci or --production can remove this CLI's own files.
const collector = readFileSync(new URL('./yarn-peer-tree.cjs', import.meta.url), 'utf8');

export async function validateYarnPeers(options) {
  const { manager } = options;
  const prefix = manager.major === 1 ? ['--silent'] : [];
  const env = { ...process.env, ...options.env, TASK_DEV_PROJECT_ROOT: manager.projectRoot,
    TASK_DEV_YARN_LINKER: manager.linker, TASK_DEV_PEER_INSPECTOR: collector };
  const result = await runYarn([...prefix, 'node', '-e', 'eval(process.env.TASK_DEV_PEER_INSPECTOR)'], { ...options, env, quiet: true });
  if (result.code !== 0) {
    if (result.output) process.stderr.write(result.output);
    return result.code;
  }
  const serialized = result.stdout.match(/^TASK_DEV_PEERS:(.*)$/m)?.[1];
  if (!serialized) throw new Error(`Yarn peer inspection returned no dependency tree: ${result.output}`);
  const validation = checkYarnPeers(JSON.parse(serialized));
  for (const accepted of validation.accepted) console.warn(`task-dev: accepted ${accepted}`);
  if (validation.rejected.length) {
    console.error('task-dev: Yarn dependency validation failed:');
    for (const rejected of validation.rejected) console.error(`  ${rejected}`);
    return 1;
  }
  return 0;
}

export function checkYarnPeers(peers) {
  const accepted = new Set();
  const rejected = new Set();
  for (const { name, spec, version, requester, requesterVersion, optional } of peers) {
    // Optional peers retain Yarn's own non-fatal behavior, including absent integrations.
    if (optional) continue;
    const range = extractRange(spec);
    const label = `${requester}@${requesterVersion} requires ${name} ${spec}`;
    // Yarn doesn't auto-install peers and treats missing providers as native warnings. Do not
    // turn an existing Yarn warning into an install failure just to normalize task versions.
    if (!version) continue;
    else if (range !== null && semver.satisfies(version, range)) continue;
    else {
      const exception = taskException(version, spec);
      if (exception) accepted.add(`${name}@${version} satisfies ${requester} ${spec} as ${exception.comparableVersion}`);
      else rejected.add(`${label}; installed ${version}`);
    }
  }
  return { accepted: [...accepted], rejected: [...rejected] };
}
