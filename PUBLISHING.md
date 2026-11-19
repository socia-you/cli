# Publishing `@socia.you/cli`

The package is published to the public npm registry from the personal
account `socia.you` (scope `@socia.you`). The local npm registry may be a
mirror, so every publish command sets the registry explicitly (or relies
on `.npmrc` here).

Status: [`@socia.you/cli@1.0.2`](https://www.npmjs.com/package/@socia.you/cli)
was published on 2026-11-19 and is tagged `latest`. Version `1.0.1` is the
previous release.

## Prerequisites

1. The npm account `socia.you` with 2FA enabled. npm no longer allows new
   TOTP enrollment; add a security key (Windows Hello/passkey) at
   <https://www.npmjs.com/settings/socia.you/tfa>.
2. A granular access token with **Bypass two-factor authentication**,
   **Read and write (publish and stage)** and access to **All Packages**.
   Create it at <https://www.npmjs.com/settings/socia.you/tokens>; it is
   shown once. Keep it outside the repository (for example, in a private
   userconfig passed with `--userconfig`).
3. A login session for the public registry (interactive publishes):

   ```bash
   npm login --registry https://registry.npmjs.org
   npm whoami --registry https://registry.npmjs.org
   ```

## Pre-flight

```bash
cd packages/socia-cli
npm test
npm pack --dry-run
```

`npm pack --dry-run` must list `dist/`, `templates/` and `README.md`.
The package name must be `@socia.you/cli`; `publishConfig.access` is already
`public`.

## Publish

```bash
npm publish --registry https://registry.npmjs.org --access public
```

For unattended publishes, pass a userconfig that contains the granular
token with bypass 2FA:

```bash
npm publish --registry https://registry.npmjs.org --access public --userconfig <path-to-userconfig>
```

A new package is accepted with `202` and may take a few minutes to appear;
`npm view` can return `404` briefly while the registry processes it.

The current version is `1.0.2`. Every later release needs a new version:

```bash
npm version patch   # or minor / major
npm publish --registry https://registry.npmjs.org --access public
```

Do not reuse a version that is already on the registry: published
versions are immutable.

## Unpublishing

The bypass-2FA granular token cannot unpublish versions; npm returns
`403 ... may not perform this action`. Remove old versions from an
authenticated npm CLI session with the security key (`npm login`, then
`npm unpublish <pkg>@<version> --force`) or from npmjs.com. Never
unpublish the only/latest version: removing all versions blocks the
package name for 24 hours. On 2026-11-19 the registry contains `1.0.1`
(previous release) and `1.0.2` (`latest`); older versions were unpublished.

## Verify

```bash
npm view @socia.you/cli version --registry https://registry.npmjs.org
npm view @socia.you/cli dist-tags --registry https://registry.npmjs.org
npx --package @socia.you/cli socia --version
```

`create-socia-sphere` is installed as a second binary of the same
package; `npx create-socia-sphere` needs a separate wrapper package and
is not part of this release.
