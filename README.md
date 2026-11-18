# @task-dev/cli

Install task-versioned npm dependencies and develop a main project alongside local
packages. Requires Node.js 22.9+ and npm 11.10+ (below npm 12). Run from the main project's
`package.json` directory. macOS/Linux use symlinks; Windows uses junctions.

## Usage

After publication:

```sh
npm install --save-dev @task-dev/cli
npx task-dev i
npx task-dev link ../sdk ../map
npx task-dev ci
```

For pipelines and empty checkouts, pin the CLI version:

```sh
npx --yes @task-dev/cli@0.1.0 ci
```

Before publication, point npx at the CLI repo without adding it to the main project:

```sh
npx --yes --package=/absolute/path/to/task-dev-cli -- task-dev i
npx --yes --package=/absolute/path/to/task-dev-cli -- task-dev link ../sdk ../map
```

Optional npm-script aliases in the main project:

```json
{
  "scripts": {
    "dev:link": "task-dev link",
    "dev:i": "task-dev i",
    "dev:ci": "task-dev ci"
  }
}
```

```sh
npm run dev:link -- ../sdk ../map
npm run dev:i -- --ignore-scripts
npm run dev:ci
```

Custom scripts use `npm run dev:ci`. The executable is `task-dev`; colon names are
unsuitable for npx package resolution and Windows executable filenames.

## Link local directories

```sh
task-dev link ../sdk ../map
task-dev link "../packages with spaces/sdk" ../map -- --ignore-scripts
```

The command follows the original BMS-UAV flow:

1. Read each local directory's package name and version.
2. Run `npm install --save --package-lock --install-links <all source directories>`
   through the task-aware installer. npm installs ordinary copies and their
   dependencies into its normal tree, recording the complete graph in its lockfile.
3. Verify those copies, then replace them with live links to the source repos.
   A failed link swap restores the installed copies.

The main project's manifest and lockfile save directory references such as
`file:../sdk`. There is no separate packing command, archive cache, or manual
lockfile rewriting. `--no-save` would also disable lockfile writes and is rejected.
See npm's [`--install-links`](https://docs.npmjs.com/cli/v11/commands/npm-install/#install-links)
and [`--save`](https://docs.npmjs.com/cli/v11/commands/npm-install/#save) documentation.

Source checkouts stay unchanged. An existing source `node_modules` produces a
warning instead of blocking the link. Move it aside (for example to
`ide_node_modules`) during development so its dependencies cannot shadow the app's
dependencies; restore it when finished.

Keep module resolution in the app's dependency tree, for example with webpack:

```js
export default {
  resolve: { symlinks: false }
};
```

[Node.js](https://nodejs.org/api/cli.html#--preserve-symlinks) has
`--preserve-symlinks`; [Vite](https://vite.dev/config/shared-options#resolve-preservesymlinks)
has `resolve.preserveSymlinks: true`. Restart the dev server after linking. Package
`main`/`exports` still need files produced by the package's own build/watch task.

Rerun linking with all desired local packages after dependency changes. Ordinary
install/ci commands can replace live links with copies. Restore the original
registry/Git specs and run `task-dev i` when returning to published packages. Local
`file:` directory specs require those checkouts to exist. Use
`task-dev ci --install-links` (or `.npmrc` setting `install-links=true`) for lockfiles
created using that option, as described in
[`npm ci`](https://docs.npmjs.com/cli/v11/commands/npm-ci/).

The CLI stops before replacing copies if npm selected a different package/version
instead of the requested local prerelease. This can happen in a fresh project when
npm substitutes a stable peer candidate. Select/install the desired task specs in
the main project first, then link. The version check prevents exposing source whose
dependency graph was never installed.

It also stops if npm installed dependencies nested inside a package being linked:
replacing that directory would discard its nested tree. Align the conflicting
versions before linking. The installed copies and lockfile remain available.

## Task-aware install and clean install

```sh
task-dev i
task-dev install some-package@1.2.3-6509.4 --ignore-scripts
task-dev ci --offline
```

Registry ranges and Git specs containing `#semver:` are supported. For example,
`1.2.3-6509.4` can satisfy `^1.2.3`, `~1.2`, `1.x`, or `1.0.0 - 1.9.0` by comparison
as `1.2.3`. Any valid SemVer prerelease suffix uses this rule. Actual versions and
lockfile entries retain the suffix. Explicit prerelease requirements keep normal
SemVer meaning, including exact task/revision pins. Pin your desired task versions;
the CLI does not select task releases automatically from stable ranges.

The CLI first runs ordinary npm, streaming its output. An unambiguous ERESOLVE peer
conflict caused by a compatible prerelease triggers a retry with `--force`, then
`npm ls --json --all` validation. Every invalid edge is checked. Incompatible base
versions, missing/extraneous packages, and unrecognized problems fail validation.
Network, authentication, lifecycle, and lockfile errors are not retried as peer
exceptions. Successful ordinary npm commands retain npm's own behavior.

Before installing, the CLI records optional peer versions, ranges, and locations
from the existing v2/v3 `package-lock.json` (or `npm-shrinkwrap.json`). Validation can
preserve those same optional mismatches after verifying the installed requester's
manifest still marks the edge optional. This handles BMS-UAV's existing
Redux/react-redux mismatch without app-specific configuration or hardcoded names.
New/changed optional mismatches and required-peer conflicts still fail. Clean
installs use the lockfile baseline even without an existing `node_modules`.

The initial ERESOLVE stays visible when retrying succeeds. Running `npm ls` directly
may still report task peers as invalid; the CLI does not patch npm. Failed
validation leaves npm's installed tree and any install-time manifest/lockfile
changes available for inspection. `ci` keeps npm's frozen-lockfile checks, and can
finish even when it deletes the CLI's own locally installed files.

Most npm arguments pass through, including omission settings used during
validation. Global/prefix/workspace scopes and explicit `--force`/
`--legacy-peer-deps` bypasses are unsupported. Linking also rejects dry-run,
lockfile-only, no-save and alternative install-strategy modes. A forced retry
requires an installed tree, so dry-run/lockfile-only failures return without retry.
npm configuration and lifecycle scripts still apply.

## Development

```sh
npm ci
npm test
npm pack --dry-run
```

Tests use a temporary registry on `127.0.0.1`, requiring no public registry or
credentials after this CLI's own dependencies are installed. They exercise real
install/ci/link operations, live edits, directory lockfile entries, dependency
updates, optional-peer baselines, substitution rejection and link-swap rollback.

Only `bin/`, `lib/`, the manifest and this README are published. No build step is
needed. No open-source license has been selected (`UNLICENSED`).
