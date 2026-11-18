import fs from 'node:fs/promises';
import path from 'node:path';

export async function removeEmptyPortalRemnants(packages, output) {
  if (!output.includes('EEXIST') || !output.includes('symlink') ||
    !packages.some(pkg => output.includes(pkg.linkPath))) return false;
  let removed = false;
  for (const pkg of packages) {
    // Yarn's node-modules linker can leave empty nested directories when replacing a
    // hard copy with a portal. Only rmdir empty directories; never discard package files.
    const directories = await emptyDirectories(pkg.linkPath);
    if (!directories) continue;
    for (const directory of directories) await fs.rmdir(directory);
    removed = true;
  }
  return removed;
}

async function emptyDirectories(directory) {
  let stat;
  try { stat = await fs.lstat(directory); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
  const directories = [];
  for (const entry of await fs.readdir(directory)) {
    const nested = await emptyDirectories(path.join(directory, entry));
    if (!nested) return null;
    directories.push(...nested);
  }
  return [...directories, directory];
}
