import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import spawn from 'cross-spawn';

const cli = fileURLToPath(new URL('../bin/task-dev.js', import.meta.url));
const flags = ['--ignore-scripts', '--no-audit', '--no-fund'];

test('real npm: task install and ci retain transitive dependencies and freeze the lockfile', async t => {
  const fixture = await setup(t);
  const leaf = fixture.pack('transitive', '1.0.0');
  const sdk = fixture.pack('@fixture/sdk', '1.2.3-1234.1', { dependencies: { transitive: `file:${leaf}` } });
  fixture.pack('@fixture/sdk', '1.2.3');
  const rest = fixture.pack('@fixture/rest', '1.0.0', { peerDependencies: { '@fixture/sdk': '^1.2.3' } });
  const devOnly = fixture.pack('dev-only', '1.0.0');
  fixture.project({ dependencies: { '@fixture/sdk': `file:${sdk}`, '@fixture/rest': `file:${rest}` },
    devDependencies: { 'dev-only': `file:${devOnly}` } });

  const installed = await fixture.run(['i', ...flags]);
  assert.equal(installed.status, 0, installed.output);
  assert.match(installed.output, /retrying npm with --force/);
  const lockfile = fixture.read('package-lock.json');
  const lock = JSON.parse(lockfile);
  assert.equal(lock.packages['node_modules/transitive']?.version, '1.0.0', installed.output + JSON.stringify(lock));
  assert.equal(lock.packages['node_modules/@fixture/sdk'].version, '1.2.3-1234.1');
  assert.equal(JSON.parse(fixture.read('node_modules/transitive/package.json')).version, '1.0.0');

  const clean = await fixture.run(['ci', '--offline', ...flags]);
  assert.equal(clean.status, 0, clean.output);
  assert.equal(fixture.read('package-lock.json'), lockfile);
  assert.equal(JSON.parse(fixture.read('node_modules/transitive/package.json')).version, '1.0.0');

  // npm ci deletes the process's own locally installed CLI before the forced retry is validated.
  const installedCli = path.join(fixture.app, 'node_modules/@task-dev/cli');
  fs.mkdirSync(installedCli, { recursive: true });
  for (const entry of ['bin', 'lib', 'package.json', 'node_modules']) {
    fs.cpSync(fileURLToPath(new URL(`../${entry}`, import.meta.url)), path.join(installedCli, entry), { recursive: true });
  }
  const selfRemoved = await fixture.run(['ci', '--offline', '--omit=dev', ...flags], path.join(installedCli, 'bin/task-dev.js'));
  assert.equal(selfRemoved.status, 0, selfRemoved.output);
  assert.equal(fs.existsSync(installedCli), false);
  assert.equal(fs.existsSync(path.join(fixture.app, 'node_modules/dev-only')), false);
  assert.equal(fixture.read('package-lock.json'), lockfile);
});

test('real npm: multiple local packages keep the graph and expose live source edits', async t => {
  const fixture = await setup(t);
  const leaf = fixture.pack('transitive', '1.0.0');
  const sdk = fixture.source('@fixture/sdk', '1.2.3-1234.1', { dependencies: { transitive: `file:${leaf}` } });
  fixture.pack('@fixture/sdk', '1.2.3');
  const rest = fixture.source('@fixture/rest', '1.0.0', { peerDependencies: { '@fixture/sdk': '1.2.3-1234.1' } });
  const sdkArchive = fixture.pack('@fixture/sdk', '1.2.3-1234.1', { dependencies: { transitive: `file:${leaf}` } });
  const restArchive = fixture.pack('@fixture/rest', '1.0.0', { peerDependencies: { '@fixture/sdk': '1.2.3-1234.1' } });
  const viewer = fixture.pack('viewer', '1.0.0', { peerDependencies: { '@fixture/sdk': '^1.2.3' } });
  fixture.project({ dependencies: { '@fixture/sdk': `file:${sdkArchive}`, '@fixture/rest': `file:${restArchive}`, viewer: `file:${viewer}` } });
  const initial = await fixture.run(['i', ...flags]);
  assert.equal(initial.status, 0, initial.output);
  const installed = await fixture.run(['link', sdk, rest, '--', ...flags]);
  assert.equal(installed.status, 0, installed.output);
  for (const [name, source] of [['@fixture/sdk', sdk], ['@fixture/rest', rest]]) {
    const installedPath = path.join(fixture.app, 'node_modules', name);
    assert.ok(fs.lstatSync(installedPath).isSymbolicLink());
    assert.equal(fs.realpathSync.native(installedPath), fs.realpathSync.native(source));
  }
  const lock = JSON.parse(fixture.read('package-lock.json'));
  assert.equal(lock.packages['node_modules/transitive']?.version, '1.0.0', installed.output + JSON.stringify(lock));
  assert.equal(lock.packages['node_modules/@fixture/sdk'].link, undefined);
  assert.ok(JSON.parse(fixture.read('package.json')).dependencies['@fixture/sdk'].startsWith('file:'));
  assert.equal(path.resolve(fixture.app, JSON.parse(fixture.read('package.json')).dependencies['@fixture/sdk'].slice(5)), sdk);
  assert.equal(fs.existsSync(path.join(fixture.app, '.task-dev')), false);
  fs.writeFileSync(path.join(sdk, 'index.js'), "module.exports = require('transitive') + ':edited';\n");
  const runtime = spawnSync(process.execPath, ['--preserve-symlinks', '-e', "console.log(require('@fixture/sdk'))"], {
    cwd: fixture.app, encoding: 'utf8',
  });
  assert.equal(runtime.status, 0, runtime.stderr);
  assert.equal(runtime.stdout.trim(), 'transitive:edited');
  assert.equal(fs.existsSync(path.join(sdk, 'node_modules')), false);
  const lockfile = fixture.read('package-lock.json');
  const ci = await fixture.run(['ci', '--install-links', '--offline', ...flags]);
  assert.equal(ci.status, 0, ci.output);
  assert.equal(fixture.read('package-lock.json'), lockfile);
  assert.equal(fs.lstatSync(path.join(fixture.app, 'node_modules/@fixture/sdk')).isSymbolicLink(), false);
});

test('a fresh directory install that substitutes a stable peer is rejected before linking', async t => {
  const fixture = await setup(t);
  const sdk = fixture.source('@fixture/sdk', '1.2.3-1234.1');
  fixture.pack('@fixture/sdk', '1.2.3');
  const rest = fixture.source('rest', '1.0.0', { peerDependencies: { '@fixture/sdk': '^1.2.3' } });
  fixture.project({});
  const result = await fixture.run(['link', sdk, rest, '--', ...flags]);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /different package in place of @fixture\/sdk/);
  assert.equal(fs.lstatSync(path.join(fixture.app, 'node_modules/@fixture/sdk')).isSymbolicLink(), false);
});

test('real npm: nested dependencies remain intact when the layout cannot be symlinked', async t => {
  const fixture = await setup(t);
  const oldLeaf = fixture.pack('transitive', '1.0.0');
  const newLeaf = fixture.pack('transitive', '2.0.0');
  const sdk = fixture.source('@fixture/sdk', '1.0.0', { dependencies: { transitive: `file:${newLeaf}` } });
  fixture.project({ dependencies: { transitive: `file:${oldLeaf}` } });
  const result = await fixture.run(['link', sdk, '--', ...flags]);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /nested dependencies/);
  assert.equal(JSON.parse(fixture.read('node_modules/@fixture/sdk/node_modules/transitive/package.json')).version, '2.0.0');
  assert.equal(JSON.parse(fixture.read('node_modules/transitive/package.json')).version, '1.0.0');
  assert.equal(fs.lstatSync(path.join(fixture.app, 'node_modules/@fixture/sdk')).isSymbolicLink(), false);
});

test('link preflight catches duplicate names and warns without altering source node_modules', async t => {
  const fixture = await setup(t);
  const source = fixture.source('sdk', '1.0.0');
  fixture.project({});
  let result = await fixture.run(['link', source, source]);
  assert.equal(result.status, 1);
  assert.match(result.output, /Duplicate local package/);
  assert.equal(fs.existsSync(path.join(fixture.app, 'package-lock.json')), false);
  fs.mkdirSync(path.join(source, 'node_modules'));
  fs.writeFileSync(path.join(source, 'node_modules', 'keep.txt'), 'do not delete');
  result = await fixture.run(['link', source]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /has its own node_modules/);
  assert.equal(fs.readFileSync(path.join(source, 'node_modules', 'keep.txt'), 'utf8'), 'do not delete');
});

test('real npm: local relative file dependencies keep their source resolution', async t => {
  const fixture = await setup(t);
  const leaf = fixture.source('transitive', '1.0.0');
  const sdk = fixture.source('sdk', '1.0.0', { dependencies: { transitive: `file:../${path.basename(leaf)}` } });
  fixture.project({});
  const result = await fixture.run(['link', sdk, '--', ...flags]);
  assert.equal(result.status, 0, result.output);
  assert.equal(JSON.parse(fixture.read('node_modules/transitive/package.json')).version, '1.0.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(sdk, 'package.json'), 'utf8')).dependencies.transitive,
    `file:../${path.basename(leaf)}`);
});

test('real npm: relinking a changed manifest refreshes directory dependencies', async t => {
  const fixture = await setup(t);
  const oldLeaf = fixture.pack('transitive', '1.0.0');
  const newLeaf = fixture.pack('transitive', '2.0.0');
  const sdk = fixture.source('sdk', '1.0.0', { dependencies: { transitive: `file:${oldLeaf}` } });
  fixture.project({});
  let result = await fixture.run(['link', sdk, '--', ...flags]);
  assert.equal(result.status, 0, result.output);
  const oldSpec = JSON.parse(fixture.read('package.json')).dependencies.sdk;
  const manifestPath = path.join(sdk, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.dependencies.transitive = `file:${newLeaf}`;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  result = await fixture.run(['link', sdk, '--', ...flags]);
  assert.equal(result.status, 0, result.output);
  assert.equal(JSON.parse(fixture.read('package.json')).dependencies.sdk, oldSpec);
  assert.equal(JSON.parse(fixture.read('node_modules/transitive/package.json')).version, '2.0.0');
  assert.equal(JSON.parse(fixture.read('package-lock.json')).packages['node_modules/transitive'].version, '2.0.0');
});

async function setup(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'task dev integration ')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'app');
  fs.mkdirSync(app);
  const packages = new Map();
  const tarballs = new Map();
  // A private test registry makes npm's peer-candidate lookup realistic without public network access.
  const server = createServer((request, response) => {
    const key = decodeURIComponent(request.url.slice(1));
    if (tarballs.has(key)) {
      response.end(fs.readFileSync(tarballs.get(key)));
    } else if (packages.has(key)) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ name: key, versions: packages.get(key), 'dist-tags': { latest: Object.keys(packages.get(key)).at(-1) } }));
    } else {
      response.writeHead(404);
      response.end('{}');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const registry = `http://127.0.0.1:${server.address().port}/`;
  const env = { ...process.env, npm_config_cache: path.join(root, 'cache'), npm_config_update_notifier: 'false',
    npm_config_userconfig: path.join(root, 'empty.npmrc'), npm_config_registry: registry };
  fs.writeFileSync(env.npm_config_userconfig, '');
  const source = (name, version, extra = {}) => {
    const directory = path.join(root, `${name.replaceAll('/', '-')}-${version}`);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version, ...extra }));
    fs.writeFileSync(path.join(directory, 'index.js'), `module.exports = ${JSON.stringify(name)};\n`);
    return directory;
  };
  return {
    app, source,
    project: extra => fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', ...extra })),
    read: relative => fs.readFileSync(path.join(app, relative), 'utf8'),
    run: (args, executable = cli, extraEnv = {}) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [executable, ...args], { cwd: app, env: { ...env, ...extraEnv }, timeout: 60000 });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { output += chunk; });
      child.once('error', reject);
      child.once('close', status => resolve({ status, output }));
    }),
    pack: (name, version, extra) => {
      const directory = source(name, version, extra);
      const args = ['pack', '--json', '--ignore-scripts', '--offline'];
      const result = env.npm_execpath
        ? spawnSync(process.execPath, [env.npm_execpath, ...args], { cwd: directory, env, encoding: 'utf8' })
        : spawn.sync('npm', args, { cwd: directory, env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const tarball = path.join(directory, JSON.parse(result.stdout)[0].filename);
      const key = `tarballs/${tarballs.size}.tgz`;
      tarballs.set(key, tarball);
      const versions = packages.get(name) ?? {};
      versions[version] = { name, version, ...extra, dist: { tarball: registry + key,
        integrity: `sha512-${createHash('sha512').update(fs.readFileSync(tarball)).digest('base64')}` } };
      packages.set(name, versions);
      return tarball;
    },
  };
}
