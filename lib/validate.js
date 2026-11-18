import fs from 'node:fs/promises';
import path from 'node:path';
import { taskException } from './versions.js';

export async function readLocalDependencies(cwd) {
  const manifest = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8'));
  const declared = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies };
  const packages = [];
  for (const [name, spec] of Object.entries(declared)) {
    if (typeof spec !== 'string' || !spec.startsWith('file:')) continue;
    const target = path.resolve(cwd, spec.slice(5));
    try {
      if (!(await fs.stat(target)).isDirectory()) continue;
      const local = JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8'));
      packages.push({ name, version: local.version, target: await fs.realpath(target) });
    } catch (error) {
      // Leave missing file specs to npm, which reports their install error with full context.
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return packages;
}

export async function validateTree(tree, { cwd, localPackages = [], existingOptionalPeers = [] }) {
  const entries = [];
  const problems = new Set();
  const rejected = [];
  const allowed = new Set();
  visit(tree);

  for (const { name, node } of entries) {
    const sources = invalidSources(node.invalid);
    if (!sources.length) {
      rejected.push(`${name}@${node.version}: unrecognized invalid dependency ${JSON.stringify(node.invalid)}`);
      continue;
    }
    for (const { spec, requester, requesterPath } of sources) {
      const exception = taskException(node.version, spec);
      if (exception) {
        allowed.add(`${name}@${node.version} satisfies ${requester} ${spec} as ${exception.comparableVersion}`);
      } else if (requester === 'root project' && localPackages.some(pkg =>
        pkg.name === name && (!pkg.version || pkg.version === node.version) &&
        spec.startsWith('file:') && path.resolve(cwd, spec.slice(5)) === pkg.target)) {
        allowed.add(`${name}@${node.version} is a local file dependency of the root project`);
      } else if (existingOptionalPeers.some(peer => peer.name === name && peer.version === node.version &&
        peer.spec === spec && peer.requesterPath === requesterPath) &&
        await isOptionalPeer(cwd, requesterPath, name, spec)) {
        allowed.add(`${name}@${node.version} preserves an existing optional peer mismatch of ${requester}`);
      } else {
        rejected.push(`${name}@${node.version}: ${requester} requires ${spec}`);
      }
    }
  }

  for (const problem of problems) {
    const recognized = entries.some(({ name, node }) => {
      const prefix = `invalid: ${name}@${node.version}`;
      return problem === prefix || problem.startsWith(`${prefix} `);
    });
    if (!recognized) rejected.push(problem);
  }

  return { ok: rejected.length === 0, allowed: [...allowed], rejected, hasProblems: entries.length + problems.size > 0 };

  function visit(node, name) {
    if (!node || typeof node !== 'object') return;
    for (const problem of node.problems ?? []) problems.add(String(problem));
    if (node.invalid) entries.push({ name, node });
    if (node.missing || node.extraneous) rejected.push(`${node.missing ? 'missing' : 'extraneous'}: ${name}`);
    for (const [childName, child] of Object.entries(node.dependencies ?? {})) visit(child, childName);
  }
}

function invalidSources(invalid) {
  if (typeof invalid !== 'string') return [];
  const matches = [...invalid.matchAll(/"([^"]*)" from (the root project|node_modules[\\/].+?)(?=, "|$)/g)];
  // npm joins ALL invalid edges into one string. Approving only its first edge would hide real conflicts.
  if (!matches.length || matches.map(([match]) => match).join(', ') !== invalid) return [];
  return matches.map(([, spec, source]) => {
    const requesterPath = source === 'the root project' ? null : source.replaceAll('\\', '/');
    const requester = requesterPath?.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/)?.[1] ?? 'root project';
    return { spec, requester, requesterPath };
  });
}

async function isOptionalPeer(cwd, requesterPath, name, spec) {
  if (!requesterPath) return false;
  const target = path.resolve(cwd, requesterPath);
  if (!target.startsWith(`${cwd}${path.sep}`)) return false;
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8'));
    return manifest.peerDependencies?.[name] === spec && manifest.peerDependenciesMeta?.[name]?.optional === true;
  } catch (error) {
    throw new Error(`Cannot verify optional peer in ${requesterPath}`, { cause: error });
  }
}
