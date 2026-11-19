# Socia mini app

A Socia mini app for the **Sphere** section. Built with **Svelte 5**,
**TypeScript**, and **Vite**. Runs inside the Socia messenger as a
WebView on its own origin, packaged into a single `.socia` file, signed
with Ed25519, and published through the Sphere.

Identified by a public **`@username`** — like `@my_notes`. One namespace
for users, channels, groups, and mini apps.

Full documentation: **https://socia.you/docs**

---

## Quick start

Five commands from a parent folder:

```bash
# 1. install the CLI globally (once)
npm install -g @socia.you/cli

# 2. sign in — opens a browser, saves the token to ~/.socia/config.json
socia login

# 3. generate the Ed25519 signing key (once, before the first deploy)
socia keygen

# 4. scaffold a project
socia create my_notes
cd my_notes

# 5. start the preview
socia dev
```

`socia create` runs an interactive wizard — project name, app
username, install deps, start dev. Press `Enter` on each question; the
defaults are the normal flow.

`socia dev` opens a preview at `http://localhost:3003` with:

- an **iPhone frame** (matches the real device);
- a **native-looking tab bar**, rendered exactly like the one inside
  the messenger;
- a **mock API** served from `mock-api.json`, so the app works without
  a backend;
- **hot reload** on save under `src/`;
- hot reload of `manifest.json` and `mock-api.json` without a full
  page reload.

Stop with `Ctrl+C`.

When the app is ready:

```bash
socia deploy
```

The CLI builds, signs the package with the Ed25519 key, packs it into
`.socia` (tar + brotli), and opens a publish form in a browser. Fill
in the name, description, category, upload an icon and screenshots,
press **Publish**. The package goes to the backend with
`status: pending` and awaits moderation. After approval, the app
appears in the Sphere catalog. Users open it by `@my_notes`; deep links
look like `socia://sphere/my_notes`.

---

## Project layout

```
src/
├── main.ts                    # Mounts App, exposes window.socia
├── app/
│   ├── App.svelte             # Root component, tab↔route wiring
│   └── app.css                # Global styles and CSS variables
├── pages/
│   ├── home/HomePage.svelte   # "Home" tab
│   └── about/AboutPage.svelte # "About" tab
├── widgets/
│   └── GlowBackground.svelte  # Decorative background
└── shared/
    ├── lib/
    │   ├── socia.ts           # JS bridge (api, tabs, ui, context)
    │   └── router.ts          # Hash-based router
    └── ui/
        └── Card.svelte        # Reusable card component
```

We follow a light version of **Feature-Sliced Design**. Code is
grouped by role, not by file type. The public app identifier
(`@my_notes`) lives in `manifest.json → username`.

- **`app`** — the root component and global styles. Nothing else.
- **`pages`** — full screens. One per tab.
- **`widgets`** — composed UI blocks that pages reuse.
- **`shared`** — reusable primitives (JS bridge, router, UI kit).

Rule of thumb: if a piece of code is used by one page, keep it inside
that page. If a second page needs it, move it down a layer.

---

## Tabs

Tabs live in `manifest.json` under `ui.tabbar.tabs`. Each tab `id`
is also a route path: tapping "about" triggers `#/about`.

```json
"tabbar": {
  "enabled": true,
  "defaultTab": "home",
  "tabs": [
    { "id": "home", "icon": "home", "label": "Home" },
    { "id": "about", "icon": "info", "label": "About" }
  ]
}
```

The host renders the tab bar (Flutter), the mini app renders the page
(Svelte). They talk through `socia.tabs`:

- Tap on a tab → host calls `socia.tabs.onChange`.
- Internal navigation → app calls `socia.tabs.setActive`.

Wiring is already in `App.svelte`. You only touch it if you want
custom navigation.

### Adding a new tab

1. Create `src/pages/your-tab/YourTabPage.svelte`.
2. Add the tab to `manifest.json → ui.tabbar.tabs`.
3. Import the page in `App.svelte` and add a branch to `$derived.by`.

### Icons

Icons are mapped by the host. Write a simple name in the manifest —
the host renders the matching icon from its own set.

Supported names: `home`, `users`, `user`, `heart`, `star`, `image`,
`camera`, `music`, `video`, `analytics`, `wallet`, `credit-card`,
`settings`, `bell`, `mail`, `gamepad`, `shopping-cart`, `map-pin`,
`calendar`, `history`, `info`, `search`, `menu`, `chevron-left`.

Unknown names fall back to a generic `apps` icon.

### Styling the tab bar

The tab bar is drawn by Flutter — CSS does not reach it. To change
its colors and shape, use `ui.tabbar.style` in the manifest:

```json
"style": {
  "background": "#202020",
  "borderColor": "rgba(232,228,222,0.14)",
  "borderWidth": 1.5,
  "borderRadius": 18,
  "activeColor": "#fbbf24",
  "inactiveColor": "rgba(232,228,222,0.48)",
  "shadow": "soft"
}
```

`shadow` is one of `"soft"` (two-layer soft), `"hard"` (offset solid,
no blur), `"none"`.

---

## Commands

Full CLI reference.

### `socia create [name]`

Scaffold a new project from the current template. Run once from a
parent folder.

```bash
socia create my_notes
```

The wizard asks for the project name (`my_notes`), a public app username
(`my_notes`, without `@`), whether to install dependencies, and whether
to start the dev server. If you are signed in, the CLI checks the
username against the backend and warns if it is already taken.

### `socia login`

Authenticate against the Socia backend. Opens a browser, saves the
JWT to `~/.socia/config.json`.

```bash
socia login
```

Without login, `socia build` still works — but `socia deploy` will
fail: the backend rejects unauthenticated packages. The username
availability check in `socia create` also works only when signed in.

### `socia keygen`

Generate the Ed25519 signing keypair. Run **once**, before the first
deploy.

```bash
socia keygen
```

The keypair is stored in `~/.socia/signing_key` (private) and
`~/.socia/signing_key.pub` (public, for copy-paste). The public key
is embedded into every package and registered on the backend the
first time you deploy.

**Keep the private key safe.** If you lose it, you cannot publish
updates to apps you have already signed.

### `socia dev`

Start the dev UI with a phone frame, native tab bar, and mock API.

```bash
socia dev
```

Opens `http://localhost:3003`. Do **not** confuse this with
`npm run dev` — that is a bare Vite server with no frame, no bridge,
and no mock API.

### `npm run dev`

Start a bare Vite dev server on `http://localhost:5173`. Use this
only for quick CSS tweaks outside the Socia shell.

`window.socia` is undefined in a plain browser. Calls to `socia.api`
will fail — that is expected. For bridge-backed testing, use
`socia dev` or deploy to a device.

### `npm run build`

Build a production bundle.

```bash
npm run build
```

Output: `dist/` — separate JS chunks and CSS files with relative
paths (`./assets/...`). This is what the host loads.

### `socia build`

Pack the project into a `.socia` file. Runs `vite build` first.

```bash
socia build
```

The package is a `tar.br` archive:

```
manifest.json
index.html
assets/...
signature.bin
```

`signature.bin` is a base64-encoded Ed25519 signature over the SHA-256
digest of all files in the package. The host verifies it against the
publisher's public key (stored on the backend and embedded in
`manifest.json`).

The output file is named `<username>-<version>.socia`, e.g.
`notes-0.1.0.socia`.

### `socia deploy`

Build, pack, open a browser form, upload to Sphere.

```bash
socia deploy
```

The flow:

1. Vite builds the project.
2. `<title>` and `<meta>` tags from `index.html` pre-fill the form.
3. A browser opens on a free local port; the URL is printed in the terminal.
4. Fill in name, description, category, channel URL, changelog.
5. Drag and drop an icon (256×256 PNG, ≤ 5 MB) and up to 5
   screenshots (≤ 10 MB each). The UI compresses them to PNG.
6. Press **Publish** → the signed package (≤ 50 MB) goes to the
   backend with `status: pending`.
7. After moderation, the app appears in the Sphere catalog.

### `socia bump`

Increment the version in `manifest.json`.

```bash
socia bump patch    # 0.1.2 → 0.1.3
socia bump minor    # 0.1.2 → 0.2.0
socia bump major    # 0.1.2 → 1.0.0
```

With `--git`, also commits the change and creates a tag:

```bash
socia bump patch --git
```

### `socia shot`

Capture screenshots of the app inside a phone frame. Uses the same
`socia dev` UI, so the tab bar and status bar are exactly what users
see.

```bash
socia shot
```

Interactive prompts ask which tabs to capture, which device to
emulate, and where to save the PNGs. On first run, Chromium is
downloaded into `~/.socia/chromium/`. Later runs use the cache.

### `socia publish`

Publish an existing `.socia` to the **local registry** (for
debugging). Not for production.

```bash
socia publish --file ./notes-0.1.0.socia
```

### `socia update`

Refresh framework configs from the installed template without
recreating the project.

```bash
socia update           # refresh vite.config.ts, tsconfig.json, svelte.config.js
socia update --docs    # also refresh AI.md and README.md
socia update --force   # DANGER: also overwrite src/ and index.html
```

---

## API — `socia.api`

HTTP proxy to your backend. Only paths in
`manifest.json → backend.allowed_paths` are allowed.

```ts
import { socia } from '../shared/lib/socia'

const me = await socia.api.get<{ username: string }>('/users/me')
await socia.api.post('/notes', { title: 'First' })
await socia.api.put('/notes/42', { title: 'Updated' })
await socia.api.delete('/notes/42')
```

The user's JWT never leaves the host. Flutter injects `Authorization:
Bearer <jwt>` on its own side. You never see the token and you never
need to.

To add a new endpoint, list it in `manifest.json` first:

```json
"backend": {
  "base_url": "https://api.example.com",
  "allowed_paths": ["/api/users/me", "/notes", "/notes/*"],
  "allowed_methods": ["GET", "POST", "PUT", "DELETE"],
  "timeout_sec": 15
}
```

`*` is supported: `/notes/*` allows everything under `/notes/`. A
plain `/notes` allows an exact match only. List both if you need the
list and the individual records.

Errors — always wrap in `try/catch`:

| Message                        | Meaning                                  |
| ------------------------------ | ---------------------------------------- |
| `Path not allowed`             | Path not in `backend.allowed_paths`.     |
| `Method not allowed`           | Method not in `backend.allowed_methods`. |
| `HTTP <code>`                  | Backend returned non-2xx.                |
| `timeout`                      | Exceeded `backend.timeout_sec`.          |
| `SociaBridge is not available` | Not running inside the host (browser).   |

---

## Tabs — `socia.tabs`

Control the native tab bar.

```ts
socia.tabs.setActive(tabId) // highlight a tab
socia.tabs.getActive() // → string | null
socia.tabs.onChange(cb) // fires on tab tap, returns unsubscribe
socia.tabs.setTabbarVisible(visible) // hide/show the bar
```

Register `onChange` in `onMount` and unsubscribe on unmount.

Hide the tab bar for fullscreen screens (onboarding, focus mode, modal
editor), then bring it back.

---

## Dialogs — `socia.ui`

Native dialogs drawn by Flutter. Use these instead of HTML modals —
they match the rest of the app, handle the keyboard and safe areas,
and animate correctly.

### `showSheet` — form

```ts
try {
	const res = await socia.ui.showSheet({
		title: 'New note',
		helpText: 'Both fields are optional.',
		fields: [
			{ type: 'text', name: 'title', label: 'Title' },
			{ type: 'textarea', name: 'body', label: 'Body' },
		],
		actions: [{ id: 'save', label: 'Save', style: 'primary' }],
	})
	// res.action === 'save', res.values === { title, body }
} catch {
	// user closed via "×" — silent
}
```

Field types: `text`, `textarea`, `number`, `email`, `password`.
`textarea` grows with content.

Action styles: `primary` (white), `secondary` (transparent). If
`cancel: true`, picking this action rejects the promise.

### `alert` — message with buttons

```ts
const res = await socia.ui.alert({
	title: 'Storage full',
	message: 'Could not save your note. Free up space and try again.',
	actions: [{ id: 'ok', label: 'OK', style: 'primary' }],
})
```

`destructive: true` renders the button in red.

### `confirm` — yes/no

```ts
const ok = await socia.ui.confirm({
	title: 'Delete note?',
	message: 'This cannot be undone.',
	confirmLabel: 'Delete',
	destructive: true,
})
if (ok) {
	// ...
}
```

### `onBack` / `onSettings` — round buttons

```ts
socia.ui.onBack(() => router.goto('/home'))
socia.ui.onSettings(() => router.goto('/settings'))
```

If `onBack` is not registered, the host **closes the mini app**. If
`onSettings` is not registered, the host shows a "no settings" toast.

### `setOrientation` — screen orientation

```ts
await socia.ui.setOrientation('landscape') // for a game, video player
await socia.ui.setOrientation('portrait') // back
await socia.ui.setOrientation('auto') // follow the manifest default
```

Affects the whole host app, not just the WebView. When the mini app
closes, the host restores its own default (portrait for Socia).

On iOS, the requested orientation must be enabled in the host's
`Info.plist` — otherwise iOS silently ignores it.

---

## User context — `socia.context`

The current user's profile inside your mini app.

```ts
const ctx = await socia.context.get()
// {
//   sphereUserId: 'f6403fbb…',
//   username: 'mark',
//   firstName: 'Mark',
//   lastName: 'Winton',
//   avatarUrl: null,
// }
```

`sphereUserId` is a per-app pseudonymous identifier —
`HMAC-SHA256(user_id + ":" + app_username, sphere_hmac_key)` on the
backend. Properties:

- **Stable** for the (user, app) pair. Reinstall, device change — the
  value stays the same.
- **Different** for every mini app. Two apps cannot correlate their
  users — by design.
- **Pseudonymous.** The real `user_id` (UUID) never leaves the
  backend.

Use it to authenticate the user against **your own** backend.

`username`, `firstName`, `lastName`, `avatarUrl` are public profile
fields. `username` may be `null` if the user chose not to share it.

The context is cached for the session by the host, so `get()` is
instant after the first call. Call `socia.context.refresh()` if you
know the profile changed.

---

## Home screen - `socia.home`

Pin the mini app to the Android home screen. The host takes the name
and icon from the catalog, so the shortcut looks like a normal app.

```ts
const res = await socia.home.add()
// res.ok === true -> the system "Add to home screen?" dialog is open
```

The user still has to confirm in the OS dialog - Android never pins
silently. `ok` is `false` on iOS, on Android < 8, or when the launcher
does not support pinned shortcuts. The shortcut opens
`socia://miniapp/<username>` straight into your app.

A typical entry point is the host settings button:

```ts
socia.ui.onSettings(async () => {
	const res = await socia.ui.showSheet({
		title: 'Settings',
		actions: [{ id: 'home', label: 'Add to home screen' }],
	})
	if (res.action === 'home') await socia.home.add()
})
```

---

## Manifest — `manifest.json`

Read by the host **before** the app launches.

### Required fields

```json
{
	"username": "my_notes",
	"name": "My Notes",
	"version": "0.1.0",
	"entry": "index.html"
}
```

- `username` — public identifier, without `@`. Lowercase, 6..32 for a
  new app (3..32 when updating an existing one), `[a-z0-9_]`, must not
  start or end with `_`. Chosen once at `socia create`; do not change
  it after the first publish. The backend rejects a deploy if the
  username is already taken.
- `name` — display name in the catalog.
- `version` — semver. On update, it must differ from the previous.
- `entry` — always `index.html`.

### `ui` section

Controls the native interface drawn by Flutter above the WebView.

```json
"ui": {
  "fullscreen": false,
  "showHeader": true,
  "orientation": "auto",
  "tabbar": {
    "enabled": true,
    "defaultTab": "home",
    "showBack": true,
    "showSettings": true,
    "tabs": [
      { "id": "home", "icon": "home", "label": "Home" }
    ],
    "style": { ... }
  }
}
```

- `fullscreen` — hide the host header. Default `false`.
- `showHeader` — show the app name. Only when `fullscreen: false`.
- `orientation` — `"auto"` | `"portrait"` | `"landscape"`.
- `tabbar.enabled` — show the bottom tab bar.
- `tabbar.defaultTab` — active tab on launch.
- `tabbar.showBack` / `showSettings` — toggle the round buttons.
- `tabbar.style` — color and shape overrides (see **Tabs** section).

### `backend` section

Network rules for `socia.api`.

```json
"backend": {
  "base_url": "https://api.example.com",
  "allowed_paths": ["/users/me", "/notes", "/notes/*"],
  "allowed_methods": ["GET", "POST", "PUT", "DELETE"],
  "timeout_sec": 15,
  "headers": { "X-App-Version": "1.0.0" }
}
```

- `headers` — optional extra headers the host adds to every request.

### `permissions` section

A declaration shown to the user in the pre-install preview.

```json
"permissions": ["network"]
```

Currently only `network` is supported. There are no hidden permissions.

---

## Mock API — `mock-api.json`

Used by `socia dev`. Serves mock responses without a backend, so the
app works standalone during development.

```json
{
	"__context": {
		"sphereUserId": "mock-user-abcdef",
		"username": "mockuser",
		"firstName": "Mock",
		"lastName": "User",
		"avatarUrl": null
	},
	"GET /users/me": {
		"status": 200,
		"body": { "username": "mockuser" }
	},
	"POST /notes": {
		"status": 201,
		"body": { "id": "1" },
		"delayMs": 300
	}
}
```

Keys are `<METHOD> <path>`. The `__context` key is reserved for the
user context returned by `socia.context.get()`.

Toggle mock responses on and off from the dev UI.

---

## Design and UI/UX

The app should feel like a native part of the messenger, not like a
website in a box.

### Colors

Base palette — monochrome, dark:

```
#000000     background
#0A0A0A     cards, containers
#111111     modals, sheets
#161616     hover, active
#FFFFFF     primary text
#B3FFFFFF   secondary text
#80FFFFFF   muted labels
#4DFFFFFF   placeholder, disabled
```

Borders: `0x1FFFFFFF` for cards, `0x33FFFFFF` for focus.

Accents — use **one at a time**:

```
#4ADE80     success, approved
#FF3B30     error, delete
#FF9F0A     warning, pending
#4A9EFF     info, links
```

### Typography

Font: **Poppins** (Google Fonts). Fallback: system sans.

Heading sizes: 34, 26, 24, 22, 20, 17. Body: 15. Small: 13. Hint: 11.
Timestamp: 10.

Tighten large headings with `letter-spacing: -0.2px`.

### Radii

```
32    wallet balance card
28    large cards, sheet header
24    containers
22    search pill
20    token cards
18    small cards
16    chips, badges
12    inner blocks
95    primary buttons (pill)
```

### Icons

**Only Lucide icons.** No Material, no icon fonts, no custom sets.

**No emojis in UI text.** Only in logs.

### Motion

- Screen transitions: **FadeTransition**, 500ms, `easeOut`.
- Modal open: fade + scale 0.9 → 1.0, 350ms.
- Fade-in of content: 350ms.
- Press feedback: scale 0.98 over 110–120ms.

**No white flashes. No sudden jumps.** Always animate with
`AnimatedContainer`, `AnimatedOpacity`, `AnimatedSize`.

**Respect `prefers-reduced-motion`** — wrap keyframe animations in a
media query.

### Patterns

- **Loading.** Show something within 100ms. Prefer a skeleton (soft
  grey blocks) over a spinner.
- **Empty states.** Always have one. Icon + short title + one
  sentence + a primary action.
- **Errors.** Readable message, not a stack trace. Always a "Retry"
  action if the operation is retryable.
- **Long-press on mobile = `contextmenu`.** Intercept
  `oncontextmenu`, call `event.preventDefault()`, route to your
  handler. Otherwise the WebView shows its native menu.
- **Debounce text input.** Search fields should not fire a request
  per keystroke. Use 300–400ms.
- **Confirm destructive actions.** Never delete or overwrite without
  a `socia.ui.confirm` with `destructive: true`.

### Deep links

A mini app is opened by username:

```
socia://sphere/notes
```

No `com.example.notes`, no reverse-domain. The username is what shows
up in the catalog, in the URL, and in shared links.

### Avoid

- White flashes between screens.
- Material icons in the mini app UI.
- Emojis in UI text.
- Custom modals that duplicate native Socia sheets.
- Heterogeneous "glassmorphism" gradients.
