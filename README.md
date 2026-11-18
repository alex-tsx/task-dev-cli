# @task-dev/cli

Install task-versioned dependencies and develop a main project alongside local
packages. Requires Node.js 22.9+ and one of:

- npm 11.10+ (below npm 12).
- Yarn Classic 1.x with `node_modules`.
- Yarn 4.x with `nodeLinker: node-modules` or Plug'n'Play (the Yarn 4 default).

Run from the project's `package.json` directory. Use the project's existing package
manager installation; the CLI does not download or switch Yarn versions.

## Usage

Install with npm:

```sh
npm install --save-dev @task-dev/cli
npx task-dev i
npx task-dev link ../dep-1 ../dep-2 ../dep-3
npx task-dev ci
```

For Yarn Classic or Yarn 4:

```sh
yarn add --dev @task-dev/cli
yarn task-dev i
yarn task-dev link ../dep-1 ../dep-2 ../dep-3
yarn task-dev ci
```

For pipelines and empty checkouts, pin the CLI version:

```sh
npx --yes @task-dev/cli@0.1.1 ci
```

Yarn 4 also supports `yarn dlx @task-dev/cli@0.1.1 ci`. Yarn Classic has no `dlx`;
install the CLI in the project or invoke it with npx. Launching through npx still
selects Yarn when the project declares Yarn or has a `yarn.lock`.

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
npm run dev:link -- ../dep-1 ../dep-2 ../dep-3
npm run dev:i -- --ignore-scripts
npm run dev:ci
```

Custom scripts use `npm run dev:ci`. The executable is `task-dev`; colon names are
unsuitable for npx package resolution and Windows executable filenames.

## Package-manager selection

The CLI uses `packageManager` in `package.json`, then the project's lockfile/config,
then the launcher when the project has neither. Workspace commands find their
ancestor project root. A checked-in Yarn `yarnPath` is honored. Corepack can provide
the project's Yarn executable when enabled on the machine.

An explicit override is available:

```sh
task-dev --package-manager yarn i
task-dev ci --package-manager npm
```

Conflicting lockfiles without a declaration/override fail with an explanation.
pnpm and Bun projects are unsupported. Yarn commands write `yarn.lock` and do not
create an npm lockfile. Registry credentials, private Git policies, proxy settings,
cache settings and lifecycle-script controls belong to the selected manager.

## Link local directories

```sh
task-dev link ../dep-1 ../dep-2 ../dep-3
task-dev link "../packages with spaces/dep-1" ../dep-2
```

### npm

The npm backend follows the original BMS-UAV flow:

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

### Yarn Classic

The CLI saves `file:../sdk` references and runs Yarn's install with `--force` to
refresh local dependency metadata even when the source version has not changed.
Yarn installs the complete dependency graph and lockfile, then the CLI replaces
the installed package copies with live symlinks (junctions on Windows).

Classic can copy a source directory's existing `node_modules` along with its code.
The CLI consults Yarn's logical dependency tree and removes those files from the
installed copy only when Yarn placed no real nested dependencies there. If Yarn
needs nested dependencies in that package, linking stops and retains them.
Before reinstalling, the CLI detaches its manual links so Classic cannot write
installation metadata through them into the source checkout.
Classic linking supports standalone project roots; use Yarn workspaces for local
packages inside a Classic monorepo. Classic experimental PnP is unsupported.

### Yarn 4

The CLI saves native `portal:../sdk` references. Yarn reads the source manifest and
owns the complete dependency graph and live links. This works with both
`node_modules` and PnP; PnP uses its resolution map rather than physical package
symlinks. Relinking refreshes source dependency metadata without changing its
version. Yarn's native portal/hoisting compatibility checks remain in effect.

When switching an installed copy to a portal, Yarn's node_modules linker can leave
empty nested directories and fail to create the link. The CLI removes only empty
directory remnants at the requested package paths and retries once. Package files
and nonempty dependency directories are retained.

### Development behavior

When a linked package has its own dependencies installed for IDE IntelliSense,
rename its `node_modules` directory to `dev_node_modules` while developing through
the main app. Configure that package's IDE/TypeScript module and type lookup to
include `dev_node_modules`, so the editor can still resolve imports and types.
This keeps those dependencies available to the editor while preventing the app's
bundler/dev server from picking them up instead of the app's installed dependencies.

Run this in each linked package repo:

```sh
mv node_modules dev_node_modules

# Restore the usual directory name when finished with linked development.
mv dev_node_modules node_modules
```

The CLI leaves this rename to the developer and warns when a linked source still
has `node_modules`. Native package-manager lifecycle scripts and binary linking
can have their usual effects.

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
npm/Classic install and ci commands can replace live links with copies; Yarn 4
portals remain live across installs. Restore the original registry/Git specs and
run `task-dev i` when returning to published packages. Local `file:` and `portal:`
directory specs require those checkouts to exist. With npm, use
`task-dev ci --install-links` (or `.npmrc` setting `install-links=true`) for lockfiles
created using that option, as described in
[`npm ci`](https://docs.npmjs.com/cli/v11/commands/npm-ci/).

For npm/Classic, the CLI stops before replacing copies if the manager selected a
different package/version instead of the requested local prerelease. This can happen in a fresh project when
npm substitutes a stable peer candidate. Select/install the desired task specs in
the main project first, then link. The version check prevents exposing source whose
dependency graph was never installed.

It also stops if the manager installed dependencies nested inside a package being linked:
replacing that directory would discard its nested tree. Align the conflicting
versions before linking. The installed copies and lockfile remain available.

## Task versions

```sh
task-dev i
task-dev install some-package@1.2.3-6509.4
task-dev ci
```

Registry ranges and Git specs containing `#semver:` are supported. For example,
`1.2.3-6509.4` can satisfy `^1.2.3`, `~1.2`, `1.x`, or `1.0.0 - 1.9.0` by comparison
as `1.2.3`. Any valid SemVer prerelease suffix uses this rule. Actual versions and
lockfile entries retain the suffix. Explicit prerelease requirements keep normal
SemVer meaning, including exact task/revision pins. Pin your desired task versions;
the CLI does not select task releases automatically from stable ranges.

### npm install and ci

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

### Yarn install and ci

`i`/`install` runs native `yarn install`; package arguments such as
`task-dev i react@^19 --dev` run `yarn add`. `ci` requires an existing `yarn.lock`,
uses Classic's `--frozen-lockfile` or Yarn 4's `--immutable`, and verifies that the
lockfile bytes remain unchanged. Classic also checks root/workspace manifest
entries before its frozen install. Yarn `ci` does not delete `node_modules` first;
it follows Yarn's frozen-install semantics.

Yarn emits prerelease peer warnings itself. The CLI then inspects the installed
node_modules/PnP graph, accepts compatible task versions using the rule above,
and fails on installed required-peer versions with incompatible base versions or
different exact task pins. Yarn's missing and optional peers remain native
warnings; Yarn does not automatically install missing peer providers. Existing
warnings remain visible, including task-peer warnings the CLI accepts.

Native options pass through, for example:

```sh
# Classic
task-dev i --ignore-scripts
task-dev link ../sdk -- --ignore-scripts

# Yarn 4
task-dev ci --mode=skip-build
task-dev link ../sdk -- --mode=skip-build
```

Scope-changing flags, lockfile-bypassing flags during link/ci, and lockfile-only
install modes are rejected. Yarn configuration and scripts retain their native
behavior. Use `yarn node`/Yarn scripts to run a PnP application so its loader is
active. Migrating an npm app to PnP may expose missing dependency declarations;
successful installation does not verify the app's build or dev server.

## Development

Run a local CLI checkout from a consumer project without adding it as a dependency:

```sh
npx --yes --package=/absolute/path/to/task-dev-cli -- task-dev i
npx --yes --package=/absolute/path/to/task-dev-cli -- task-dev link ../dep-1 ../dep-2 ../dep-3
```

In the CLI repo:

```sh
npm ci
npm test
npm run test:yarn
npm pack --dry-run
```

Tests use a temporary registry on `127.0.0.1`, requiring no public registry or
credentials after this CLI's own dependencies are installed. They exercise real
install/ci/link operations, live edits, directory lockfile entries, dependency
updates, optional-peer baselines, substitution rejection and link-swap rollback.
Pinned Yarn 1.22.22 and 4.18.1 test tools exercise both modern linkers, workspaces,
frozen lockfiles, platform-specific optional dependencies, relinking, and the CLI
installed from a packed package. These Yarn tools are development dependencies;
users run their own Yarn installation.

Only `bin/`, `lib/`, the manifest, this README and `LICENSE` are published. No build
step is needed. Licensed under the [MIT License](LICENSE).
