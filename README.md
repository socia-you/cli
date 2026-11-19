# @socia.you/cli

Create, preview and publish [Socia](https://socia.you) Sphere mini apps.

A mini app is a small web app (Svelte 5 + TypeScript by default) that runs
inside Socia with access to the signed-in user's context. The CLI scaffolds
the project, runs a live preview, signs the bundle with your Ed25519 key and
uploads it to Sphere.

## Requirements

- Node.js **22.12 or newer**
- A Socia account (`socia login`)
- An Ed25519 signing key (`socia keygen`)

## Install

```bash
npm install -g @socia.you/cli
```

This installs two binaries:

- `socia` — the main CLI
- `create-socia-sphere` — alias for `socia create`

You can also run it without a global install:

```bash
npx --package @socia.you/cli socia create my-app
```

## Quick start

```bash
socia login
socia keygen
socia create my-app
cd my-app
npm install
socia dev
```

`socia dev` serves the mini app at `http://localhost:3003` (use `--port` to
change it) and reloads it when sources change.

## Commands

| Command | Description |
| --- | --- |
| `socia create [name]` | Scaffold a new mini app from the bundled template |
| `socia dev` | Start a live preview (`--port`, `--no-open`) |
| `socia login` | Sign in through the browser and store the token |
| `socia keygen` | Generate an Ed25519 signing key (`--force` to rotate) |
| `socia bump <kind>` | Bump `manifest.json` version (`patch`, `minor`, `major`) |
| `socia build` | Build and sign a `.socia` package |
| `socia deploy` | Build, sign and open the deploy UI |
| `socia publish` | Copy an existing `.socia` package to the local registry |
| `socia update` | Refresh framework files from the bundled template |
| `socia shot` | Capture screenshots in a phone frame |

## App usernames

The app username (`@my_app`) is public and permanent after the first deploy.

- **New apps:** 6–32 characters, lowercase `a-z`, digits and `_`.
- **Existing apps:** 3–32 characters (so short names like `notes` can still
  receive updates).
- The name must not start or end with `_`.
- The username must be unique across users, channels and apps.

## Deploying

```bash
socia deploy
```

The command checks your session, builds the project, creates a signed
`.socia` bundle and opens a local form where you can edit the app name,
description, category, icon and screenshots. On submit the package is
uploaded to Sphere and appears in the catalog after moderation.

Limits:

- Compressed package: **50 MB**; unpacked: **128 MiB**, up to 10,000 files
- Icon: **5 MB**; screenshots: **10 MB** each before compression (auto-PNG), up to 5 screenshots
- One version per semver value; published versions are immutable

## Configuration

Credentials and the signing key live in `~/.socia/`:

- `config.json` — API URL, access and refresh tokens
- `signing_key` / `signing_key.pub` — Ed25519 keys

## License

Proprietary. Copyright Socia.
