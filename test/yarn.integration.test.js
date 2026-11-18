import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { yarnFixture } from '../test-support/yarn-fixture.js';
import { linkYarn } from '../lib/yarn.js';

for (const variant of ['classic', 'node-modules', 'pnp']) {
  test(`Yarn ${variant}: task peers, transitive installs, frozen ci and no npm lockfile`, async t => {
    const fixture = await yarnFixture(t, variant);
    fixture.pack('transitive', '1.0.0');
    fixture.pack('@fixture/sdk', '1.2.3-1234.1', { dependencies: { transitive: '1.0.0' } });
    fixture.pack('@fixture/rest', '1.0.0', { peerDependencies: { '@fixture/sdk': '^1.2.3' } });
    fixture.project({ dependencies: { '@fixture/sdk': '1.2.3-1234.1', '@fixture/rest': '1.0.0' } });
    let result = await fixture.run(['i']);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /accepted @fixture\/sdk@1.2.3-1234.1/);
    const lock = fixture.read('yarn.lock');
    assert.match(lock, /transitive/);
    assert.equal(fs.existsSync(path.join(fixture.app, 'package-lock.json')), false);
    result = await fixture.runtime("console.log(require('@fixture/sdk')); console.log(require('node:module').createRequire(require.resolve('@fixture/sdk'))('transitive'))");
    assert.equal(result.status, 0, result.output);
    assert.match(result.stdout, /transitive@1.0.0/);
    const withoutManager = JSON.parse(fixture.read('package.json'));
    delete withoutManager.packageManager;
    fs.writeFileSync(path.join(fixture.app, 'package.json'), JSON.stringify(withoutManager));
    const originalManifest = fixture.read('package.json');
    result = await fixture.run(['ci']);
    assert.equal(result.status, 0, result.output);
    assert.equal(fixture.read('yarn.lock'), lock);
    assert.equal(fixture.read('package.json'), originalManifest);
    const manifest = JSON.parse(fixture.read('package.json'));
    manifest.dependencies.transitive = '2.0.0';
    fs.writeFileSync(path.join(fixture.app, 'package.json'), JSON.stringify(manifest));
    result = await fixture.run(['ci']);
    assert.notEqual(result.status, 0, result.output);
    assert.equal(fixture.read('yarn.lock'), lock);
  });

  test(`Yarn ${variant}: relinking updates dependency metadata without changing the source checkout`, async t => {
    const fixture = await yarnFixture(t, variant);
    fixture.pack('transitive', '1.0.0');
    fixture.pack('transitive', '2.0.0');
    const sdk = fixture.source('sdk', '1.0.0', { dependencies: { transitive: '1.0.0' } });
    fixture.project({});
    let result = await fixture.run(['link', sdk]);
    assert.equal(result.status, 0, result.output);
    const manifestPath = path.join(sdk, 'package.json');
    const changed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    changed.dependencies.transitive = '2.0.0';
    const raw = JSON.stringify(changed);
    fs.writeFileSync(manifestPath, raw);
    result = await fixture.run(['link', sdk]);
    assert.equal(result.status, 0, result.output);
    assert.equal(fs.readFileSync(manifestPath, 'utf8'), raw);
    fs.writeFileSync(path.join(sdk, 'index.js'), "module.exports = require('transitive');\n");
    result = await fixture.runtime("console.log(require('sdk'))");
    assert.equal(result.status, 0, result.output);
    assert.match(result.stdout, /transitive@2.0.0/);
  });

  test(`Yarn ${variant}: local links resolve transitive dependencies and update live`, async t => {
    const fixture = await yarnFixture(t, variant);
    fixture.pack('transitive', '1.0.0', { bin: { 'fixture-tool': 'index.js' } });
    const sdk = fixture.source('@fixture/sdk', '1.2.3-1234.1', { dependencies: { transitive: '1.0.0' } });
    const rest = fixture.source('@fixture/rest', '1.0.0', { peerDependencies: { '@fixture/sdk': '^1.2.3' } });
    if (fixture.classic) {
      const ide = path.join(sdk, 'node_modules', 'ide-only');
      fs.mkdirSync(ide, { recursive: true });
      fs.writeFileSync(path.join(ide, 'package.json'), JSON.stringify({ name: 'ide-only', version: '1.0.0', peerDependencies: { absent: '^9' } }));
      fs.mkdirSync(path.join(sdk, 'node_modules', '.bin'));
      fs.writeFileSync(path.join(sdk, 'node_modules', '.bin', 'fixture-tool'), 'source IDE executable');
    }
    fixture.project({});
    const result = await fixture.run(['link', sdk, rest]);
    assert.equal(result.status, 0, result.output);
    const manifest = JSON.parse(fixture.read('package.json'));
    assert.ok(manifest.dependencies['@fixture/sdk'].startsWith(fixture.classic ? 'file:' : 'portal:'));
    assert.match(fixture.read('yarn.lock'), /transitive/);
    assert.equal(fs.existsSync(path.join(fixture.app, 'package-lock.json')), false);
    assert.equal(fs.existsSync(path.join(sdk, 'node_modules')), fixture.classic);
    if (variant === 'pnp') assert.equal(fs.existsSync(path.join(fixture.app, 'node_modules')), false);
    else assert.equal(fs.realpathSync(path.join(fixture.app, 'node_modules/@fixture/sdk')), fs.realpathSync(sdk));
    fs.writeFileSync(path.join(sdk, 'index.js'), "module.exports = require('transitive') + ':live';\n");
    const runtime = await fixture.runtime("console.log(require('@fixture/sdk'))");
    assert.equal(runtime.status, 0, runtime.output);
    assert.match(runtime.stdout, /transitive@1.0.0:live/);
    const locked = fixture.read('yarn.lock');
    const clean = await fixture.run(['ci']);
    assert.equal(clean.status, 0, clean.output);
    assert.equal(fixture.read('yarn.lock'), locked);
    assert.equal(fs.existsSync(path.join(sdk, '.yarn-metadata.json')), false);
    assert.equal(fs.existsSync(path.join(rest, '.yarn-metadata.json')), false);
    if (fixture.classic) assert.equal(fs.readFileSync(path.join(sdk, 'node_modules', '.bin', 'fixture-tool'), 'utf8'), 'source IDE executable');
  });

  test(`Yarn ${variant}: real required-peer conflicts and missing lockfiles fail`, async t => {
    const fixture = await yarnFixture(t, variant);
    fixture.project({});
    let result = await fixture.run(['ci']);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /existing yarn.lock/);
    fixture.pack('@fixture/sdk', '1.2.3-1234.1');
    fixture.pack('consumer', '1.0.0', { peerDependencies: { '@fixture/sdk': '^2.0.0' } });
    fixture.project({ dependencies: { '@fixture/sdk': '1.2.3-1234.1', consumer: '1.0.0' } });
    result = await fixture.run(['i']);
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /requires @fixture\/sdk \^2/);
    assert.equal(fs.existsSync(path.join(fixture.app, 'package-lock.json')), false);
  });
}

test('Yarn Classic never discards genuine nested dependencies while filtering copied IDE modules', async t => {
  const fixture = await yarnFixture(t, 'classic');
  fixture.pack('transitive', '1.0.0');
  fixture.pack('transitive', '2.0.0');
  const sdk = fixture.source('sdk', '1.0.0', { dependencies: { transitive: '2.0.0' } });
  fs.mkdirSync(path.join(sdk, 'node_modules', 'ide-only'), { recursive: true });
  fs.writeFileSync(path.join(sdk, 'node_modules', 'ide-only', 'package.json'), '{"name":"ide-only","version":"1.0.0"}');
  fixture.project({ dependencies: { transitive: '1.0.0' } });
  const result = await fixture.run(['link', sdk]);
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /nested dependencies/);
  assert.equal(JSON.parse(fixture.read('node_modules/sdk/node_modules/transitive/package.json')).version, '2.0.0');
  assert.equal(fs.readFileSync(path.join(sdk, 'node_modules', 'ide-only', 'package.json'), 'utf8'), '{"name":"ide-only","version":"1.0.0"}');
});

for (const variant of ['classic', 'pnp']) {
  test(`Yarn ${variant}: the installed published CLI runs through Yarn`, async t => {
    const fixture = await yarnFixture(t, variant);
    const root = fileURLToPath(new URL('../', import.meta.url));
    const pending = [root];
    const visited = new Set();
    for (const directory of pending) {
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
      if (visited.has(manifest.name)) continue;
      visited.add(manifest.name);
      fixture.publishDirectory(directory);
      for (const name of Object.keys(manifest.dependencies ?? {})) pending.push(path.join(root, 'node_modules', name));
    }
    fixture.project({ devDependencies: { '@task-dev/cli': '0.1.0' } });
    const bootstrap = await fixture.yarn(['install']);
    assert.equal(bootstrap.status, 0, bootstrap.output);
    let result = await fixture.yarn(['task-dev', '--version']);
    assert.equal(result.status, 0, result.output);
    assert.match(result.stdout, /0.1.0/);
    const lock = fixture.read('yarn.lock');
    result = await fixture.yarn(['task-dev', 'ci']);
    assert.equal(result.status, 0, result.output);
    assert.equal(fixture.read('yarn.lock'), lock);
    assert.equal(fs.existsSync(path.join(fixture.app, 'package-lock.json')), false);
  });
}

for (const variant of ['classic', 'node-modules', 'pnp']) {
  test(`Yarn ${variant}: package arguments use native add and workspaces have frozen installs`, async t => {
    const fixture = await yarnFixture(t, variant);
    fixture.pack('transitive', '1.0.0');
    fixture.project({ workspaces: ['packages/*'] });
    const workspace = path.join(fixture.app, 'packages', 'client');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'client', version: '1.0.0', dependencies: { transitive: '1.0.0' } }));
    if (fixture.classic) {
      const source = fixture.source('external', '1.0.0');
      const manifest = fs.readFileSync(path.join(workspace, 'package.json'), 'utf8');
      await assert.rejects(linkYarn([source], [], { cwd: workspace, manager: { major: 1, projectRoot: fixture.app } }), /standalone project roots/);
      assert.equal(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8'), manifest);
    }
    let result = await fixture.run(['i']);
    assert.equal(result.status, 0, result.output);
    const lock = fixture.read('yarn.lock');
    result = await fixture.run(['ci']);
    assert.equal(result.status, 0, result.output);
    assert.equal(fixture.read('yarn.lock'), lock);
    fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'client', version: '1.0.0', dependencies: { transitive: '^2' } }));
    result = await fixture.run(['ci']);
    assert.notEqual(result.status, 0, result.output);
    assert.equal(fixture.read('yarn.lock'), lock);
    fs.rmSync(path.join(fixture.app, 'packages'), { recursive: true });
    fixture.project({});
    result = await fixture.run(['i', 'transitive@1.0.0', '--dev']);
    assert.equal(result.status, 0, result.output);
    assert.equal(JSON.parse(fixture.read('package.json')).devDependencies.transitive, '1.0.0');
  });
}

test('Yarn PnP skips optional binaries for other operating systems', async t => {
  const fixture = await yarnFixture(t, 'pnp');
  fixture.pack('platform-binary', '1.0.0', { os: [process.platform === 'win32' ? 'darwin' : 'win32'] });
  fixture.pack('portable', '1.0.0', { optionalDependencies: { 'platform-binary': '1.0.0' } });
  fixture.project({ dependencies: { portable: '1.0.0' } });
  const result = await fixture.run(['i']);
  assert.equal(result.status, 0, result.output);
});

test('Yarn node-modules replaces an installed copy with a portal after nested dependencies move', async t => {
  const fixture = await yarnFixture(t, 'node-modules');
  fixture.pack('transitive', '1.0.0');
  fixture.pack('transitive', '2.0.0');
  fixture.pack('sdk', '0.9.0', { dependencies: { transitive: '2.0.0' } });
  fixture.project({ dependencies: { sdk: '0.9.0', transitive: '1.0.0' } });
  let result = await fixture.run(['i']);
  assert.equal(result.status, 0, result.output);
  const sdk = fixture.source('sdk', '1.0.0', { dependencies: { transitive: '1.0.0' } });
  result = await fixture.run(['link', sdk]);
  assert.equal(result.status, 0, result.output);
  assert.equal(fs.realpathSync(path.join(fixture.app, 'node_modules/sdk')), sdk);
});

test('Classic experimental PnP is rejected before changing project files', async t => {
  const fixture = await yarnFixture(t, 'classic');
  fixture.project({ installConfig: { pnp: true } });
  const manifest = fixture.read('package.json');
  let result = await fixture.run(['i']);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /Classic experimental PnP is unsupported/);
  assert.equal(fixture.read('package.json'), manifest);
  assert.equal(fs.existsSync(path.join(fixture.app, 'yarn.lock')), false);
  fixture.project({});
  fs.appendFileSync(path.join(fixture.app, '.yarnrc'), 'plugnplay-override true\n');
  result = await fixture.run(['i']);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /Classic experimental PnP is unsupported/);
});
