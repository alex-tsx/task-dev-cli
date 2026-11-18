import { runNpm, selectNpmOptions } from './npm.js';
import { readLocalDependencies, validateTree } from './validate.js';
import { approvedConflict } from './versions.js';
import { readOptionalPeerBaseline } from './optional-peers.js';

export async function install(command, args, options) {
  const existingOptionalPeers = await readOptionalPeerBaseline(options.cwd);
  const declaredLocalPackages = await readLocalDependencies(options.cwd);
  const localPackages = [...new Map([...declaredLocalPackages, ...(options.localPackages ?? [])]
    .map(pkg => [pkg.name, pkg])).values()];
  const first = await runNpm([command, ...args], options);
  if (first.code === 0) return 0;
  const exception = approvedConflict(first.output, localPackages);
  if (!exception) return first.code;

  if (args.some(arg => /^(?:--dry-run|--package-lock-only)(?:=true)?$/.test(arg))) {
    console.error('task-dev: retry requires an installed tree to validate; omit --dry-run/--package-lock-only.');
    return first.code;
  }
  console.warn(`task-dev: ${exception.name}@${exception.version} satisfies ${exception.requester} ${exception.range} as ${exception.comparableVersion}.`);
  console.warn('task-dev: retrying npm with --force, then checking every reported dependency problem.');
  const forced = await runNpm([command, '--force', ...args], options);
  if (forced.code !== 0) return forced.code;

  const treeOptions = selectNpmOptions(args, ['--omit', '--include', '--production', '--only', '--also', '--dev',
    '--optional', '--no-optional', '--cache', '--userconfig', '--globalconfig', '--registry']);
  const result = await runNpm(['ls', '--json', '--all', ...treeOptions], { ...options, quiet: true });
  let tree;
  try {
    tree = JSON.parse(result.stdout);
  } catch (error) {
    console.error(new Error('task-dev: npm ls did not return valid JSON.', { cause: error }));
    if (result.stderr) process.stderr.write(result.stderr);
    return result.code || 1;
  }
  const validation = await validateTree(tree, { ...options, localPackages, existingOptionalPeers });
  if (!validation.ok || (result.code !== 0 && !validation.hasProblems)) {
    console.error('task-dev: installation finished, but dependency validation failed:');
    for (const problem of validation.rejected) console.error(`  ${problem}`);
    if (!validation.hasProblems && result.stderr) process.stderr.write(result.stderr);
    return result.code || 1;
  }
  for (const message of validation.allowed) console.warn(`task-dev: accepted ${message}`);
  return 0;
}
