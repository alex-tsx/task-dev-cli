import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const cli = fileURLToPath(new URL('../bin/task-dev.js', import.meta.url));
const npm = process.env.npm_execpath;

export async function yarnFixture(t, variant) {
  // Windows TEMP can use an 8.3 alias; PnP's path map needs the same native path as Node.
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'task dev yarn ')));
  const app = path.join(root, 'app');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(app);
  fs.mkdirSync(bin);
  const classic = variant === 'classic';
  const version = classic ? '1.22.22' : '4.18.1';
  const linker = variant === 'pnp' ? 'pnp' : 'node-modules';
  const entry = require.resolve(`${classic ? 'yarn-classic' : 'yarn-modern'}/bin/yarn.js`);
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(bin, 'yarn.cmd'), `@"${process.execPath}" "${entry}" %*\r\n`);
  } else {
    fs.writeFileSync(path.join(bin, 'yarn'), `#!${process.execPath}\nrequire(${JSON.stringify(entry)});\n`, { mode: 0o755 });
  }
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    COREPACK_ENABLE_AUTO_PIN: '0', npm_config_cache: path.join(root, 'npm-cache'),
    npm_config_update_notifier: 'false', YARN_ENABLE_TELEMETRY: '0' };
  // Launch as if through npx; selection must use the project rather than its launcher.
  env.npm_config_user_agent = 'npm/11.17.0 node/test';
  const packages = new Map();
  const tarballs = new Map();
  const server = createServer((request, response) => {
    const name = decodeURIComponent(request.url.slice(1));
    if (tarballs.has(name)) response.end(fs.readFileSync(tarballs.get(name)));
    else if (packages.has(name)) {
      response.setHeader('content-type', 'application/json');
      const versions = packages.get(name);
      const time = Object.fromEntries(Object.keys(versions).map(version => [version, '2020-01-01T00:00:00.000Z']));
      response.end(JSON.stringify({ name, versions, time, 'dist-tags': { latest: Object.keys(versions).at(-1) } }));
    } else { response.writeHead(404); response.end('{}'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const registry = `http://127.0.0.1:${server.address().port}`;
  if (classic) {
    fs.writeFileSync(path.join(app, '.yarnrc'), `registry "${registry}"\ncache-folder ${JSON.stringify(path.join(root, 'yarn-cache'))}\ndisable-self-update-check true\n`);
  } else {
    fs.writeFileSync(path.join(app, '.yarnrc.yml'), `nodeLinker: ${linker}\nnpmRegistryServer: ${registry}\nunsafeHttpWhitelist:\n  - 127.0.0.1\nenableGlobalCache: false\nglobalFolder: ${JSON.stringify(path.join(root, 'yarn-global'))}\ncacheFolder: ${JSON.stringify(path.join(app, '.yarn', 'cache'))}\nenableScripts: false\nenableTelemetry: false\n`);
  }
  const source = (name, version, extra = {}) => {
    const directory = path.join(root, `${name.replaceAll('/', '-')}-${version}`);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version, ...extra }));
    fs.writeFileSync(path.join(directory, 'index.js'), `module.exports = ${JSON.stringify(`${name}@${version}`)};\n`);
    return directory;
  };
  const archiveFolder = path.join(root, 'archives');
  fs.mkdirSync(archiveFolder);
  const publishDirectory = directory => {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    const packed = spawnSync(process.execPath, [npm, 'pack', '--json', '--ignore-scripts', '--offline', '--pack-destination', archiveFolder],
      { cwd: directory, env, encoding: 'utf8', timeout: 30000 });
    assert.equal(packed.status, 0, packed.stderr);
    const tarball = path.join(archiveFolder, JSON.parse(packed.stdout)[0].filename);
    const key = `tarballs/${tarballs.size}.tgz`;
    tarballs.set(key, tarball);
    const versions = packages.get(manifest.name) ?? {};
    versions[manifest.version] = { ...manifest, dist: { tarball: `${registry}/${key}`,
      shasum: createHash('sha1').update(fs.readFileSync(tarball)).digest('hex'),
      integrity: `sha512-${createHash('sha512').update(fs.readFileSync(tarball)).digest('base64')}` } };
    packages.set(manifest.name, versions);
    return tarball;
  };
  const execute = (executable, args, extraEnv = {}) => new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: app, env: { ...env, ...extraEnv }, timeout: 60000 });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', status => resolve({ status, stdout, stderr, output: stdout + stderr }));
  });
  return {
    root, app, env, entry, source, registry, classic, version, linker, publishDirectory,
    project: extra => fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', private: true, packageManager: `yarn@${version}`, ...extra }, null, 2)),
    read: relative => fs.readFileSync(path.join(app, relative), 'utf8'),
    run: (args, extraEnv) => execute(process.execPath, [cli, ...args], extraEnv),
    yarn: args => execute(process.execPath, [entry, ...args]),
    runtime: expression => execute(process.execPath, [entry, ...(classic ? ['--silent'] : []), 'node', '--preserve-symlinks', '-e', expression]),
    pack: (name, version, extra) => {
      const directory = source(name, version, extra);
      return publishDirectory(directory);
    },
  };
}
