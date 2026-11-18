// Runs through `yarn node`, so PnP's filesystem and resolution hooks are active.
// Kept dependency-free: the CLI may have been removed during the install being checked.
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.TASK_DEV_PROJECT_ROOT;
const linker = process.env.TASK_DEV_YARN_LINKER;
const peers = [];

if (linker === 'pnp') collectPnp();
else collectModules();
process.stdout.write(`TASK_DEV_PEERS:${JSON.stringify(peers)}\n`);

function collectPnp() {
  const api = require(path.join(root, '.pnp.cjs'));
  const pending = api.getDependencyTreeRoots().map(locator => ({ locator, top: true, optional: false }));
  const visited = new Set();
  for (const { locator, top, optional } of pending) {
    const key = JSON.stringify(locator);
    if (visited.has(key)) continue;
    const info = api.getPackageInformation(locator);
    const manifest = readOptionalManifest(info.packageLocation);
    // PnP records optional binaries for other operating systems even when not materialized.
    if (!manifest && optional) continue;
    if (!manifest) throw new Error(`Installed Yarn package has no manifest: ${info.packageLocation}`);
    visited.add(key);
    // Yarn also stores uninstantiated physical entries for peer-dependent packages. Walk only
    // reachable instances, or those templates would look like missing peers beside valid virtuals.
    for (const [name, reference] of info.packageDependencies) {
      if (reference !== null) pending.push({ locator: dependencyLocator(name, reference), top: false,
        optional: Object.hasOwn(manifest.optionalDependencies ?? {}, name) || manifest.dependenciesMeta?.[name]?.optional === true });
    }
    for (const [name, spec] of Object.entries(top ? {} : manifest.peerDependencies ?? {})) {
      const reference = info.packageDependencies.get(name);
      const dependency = reference === null || reference === undefined ? null : api.getPackageInformation(
        dependencyLocator(name, reference),
      );
      const version = dependency ? readOptionalManifest(dependency.packageLocation)?.version ?? null : null;
      peers.push({ name, spec, version, requester: manifest.name, requesterVersion: manifest.version,
        optional: manifest.peerDependenciesMeta?.[name]?.optional === true });
    }
  }
}

function collectModules() {
  const visited = new Set();
  visitPackage(root, true);

  function visitModules(directory) {
    for (const entry of readDirectory(directory)) {
      if (entry.name.startsWith('.')) continue;
      const filename = path.join(directory, entry.name);
      if (entry.name.startsWith('@')) {
        for (const child of readDirectory(filename)) visitPackage(path.join(filename, child.name));
      } else visitPackage(filename);
    }
  }

  function visitPackage(directory, top = false) {
    const real = fs.realpathSync(directory);
    if (visited.has(real)) return;
    visited.add(real);
    const manifest = readManifest(directory);
    for (const [name, spec] of Object.entries(top ? {} : manifest.peerDependencies ?? {})) {
      const peer = resolvePeer(directory, name);
      peers.push({ name, spec, version: peer?.version ?? null, requester: manifest.name,
        requesterVersion: manifest.version, optional: manifest.peerDependenciesMeta?.[name]?.optional === true });
    }
    visitModules(path.join(directory, 'node_modules'));
  }
}

function dependencyLocator(name, reference) {
  return Array.isArray(reference) ? { name: reference[0], reference: reference[1] } : { name, reference };
}

function resolvePeer(directory, name) {
  while (true) {
    if (path.basename(directory) !== 'node_modules') {
      const file = path.join(directory, 'node_modules', name, 'package.json');
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (directory === root || path.dirname(directory) === directory) return null;
    directory = path.dirname(directory);
  }
}

function readManifest(directory) {
  return JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
}

function readOptionalManifest(directory) {
  try { return readManifest(directory); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function readDirectory(directory) {
  try { return fs.readdirSync(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
