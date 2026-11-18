import fs from 'node:fs/promises';
import path from 'node:path';

export async function readOptionalPeerBaseline(cwd) {
  // npm can accept a tree whose installed optional peer has a different version (for example
  // redux 4 alongside react-redux 9). A task retry must preserve that existing npm behavior,
  // without introducing exceptions for new conflicts or requiring app-specific configuration.
  let lock;
  for (const filename of ['npm-shrinkwrap.json', 'package-lock.json']) {
    try {
      lock = JSON.parse(await fs.readFile(path.join(cwd, filename), 'utf8'));
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const packages = lock?.packages ?? {};
  const peers = [];
  for (const [requesterPath, manifest] of Object.entries(packages)) {
    if (!requesterPath) continue;
    for (const [name, spec] of Object.entries(manifest.peerDependencies ?? {})) {
      if (manifest.peerDependenciesMeta?.[name]?.optional !== true) continue;
      const version = resolvePeerVersion(packages, requesterPath, name);
      if (version) peers.push({ name, version, spec, requesterPath });
    }
  }
  return peers;
}

function resolvePeerVersion(packages, requesterPath, name) {
  let directory = requesterPath;
  while (true) {
    if (path.posix.basename(directory) !== 'node_modules') {
      const peer = packages[path.posix.join(directory, 'node_modules', name)];
      if (peer?.version) return peer.version;
    }
    if (directory === '.') return null;
    directory = path.posix.dirname(directory);
  }
}
