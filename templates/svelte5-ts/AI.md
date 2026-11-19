# AI Context — Socia Sphere

On-ramp for a model working on a Socia mini app. Canonical docs: **https://socia.you/docs**

---

## 1. How to work with the developer

You are a **senior engineering partner**; this is a real product.

- Short and direct, answer first. Match the developer's language. No emojis in code, UI strings or docs.
- Ask **one** focused question before coding only when the request is ambiguous, spans files with an unclear boundary, or conflicts with a platform limit (e.g. direct `fetch`). Never invent an API, manifest field or config key.
- Do not ask if the answer is here, in the conversation, or you were told "just do it" — deliver and note assumptions.
- Say **"I don't know"** rather than guess an API signature, backend field or device behaviour; point to https://socia.you/docs.
- Answer shape — code: what it is, the file or a FIND/REPLACE patch, what to check; design: recommendation, why it fits, one alternative; debug: cause, one check, fix.
- No unrequested features, no refactors to taste; comments explain **why** not what; no preambles.

---

## 2. Project context

- **Mini app** — a web app inside the Socia messenger's **Sphere** section, like a Telegram Mini App: **Svelte 5 + TypeScript + Vite** static files.
- **`@username`** (`@my_notes`) is public, chosen at `socia create`, never changes; one namespace with users, channels and groups.
- **Socia** — E2EE messenger (X3DH; per-chat `chat_key` via HKDF from ECDH; AES-256-GCM; keys stay on device), non-custodial TON/Solana wallet, Sphere.
- **Stack** — host Flutter, backend Rust + Axum + PostgreSQL.

```
.socia = tar + brotli (quality 11) + Ed25519 signature

manifest.json    metadata, settings, network rules
index.html       entry point
assets/_.js      bundled application code
assets/_.css     bundled styles
signature.bin    base64-encoded Ed25519 signature
```

- **Runtime** — Flutter verifies the signature against the publisher key (cross-checked with the manifest copy), unpacks to `miniapps/<username>/`, reads `manifest.json`, loads `index.html` from a per-app loopback origin (`http://127.0.0.1:<port>/`), renders an optional native tab bar.
- Tab bar, back/settings buttons and dialogs are **Flutter-rendered**; the app drives them through the bridge.
- **Per-app origin** — each app gets a unique loopback port (persisted in `.origins.json`, retired on uninstall), so `localStorage`, `IndexedDB`, cookies and CSS are isolated. Legacy `appassets.androidplatform.net` storage is only cleared on upgrade.

---

## 3. Architecture

```
src/
├── main.ts                        # Mounts App into #app, exposes window.socia
├── app/
│   ├── App.svelte                 # Root component, tab↔route wiring
│   └── app.css                    # Global styles, CSS variables, resets
├── pages/
│   ├── home/HomePage.svelte       # "Home" tab
│   ├── note/NotePage.svelte       # Detail pages
│   └── profile/ProfilePage.svelte
├── widgets/GlowBackground.svelte  # Decorative background orbs
└── shared/
    ├── lib/
    │   ├── socia.ts               # JS bridge (api, tabs, ui, context)
    │   ├── router.ts              # Tiny hash-based router
    │   └── notes-store.ts         # App-specific storage
    └── ui/Card.svelte             # Reusable card component
```

Light **Feature-Sliced Design**: `app` (root + global styles), `pages` (one per tab/route), `widgets` (blocks reused across pages), `shared` (bridge, router, UI kit). Used by one page — keep it there; needed by two — move it down a layer.

### Router

Hash routing (`#/about`) only — `history.pushState` breaks after a reload on the loopback origin.

```ts
import { router } from '../shared/lib/router'

router.goto('/about') // navigate
router.onChange(path => console.log(path)) // subscribe
router.current // read current path
```

```svelte
onMount(() => {
  const offTabs = socia.tabs.onChange(tabId => router.goto(`/${tabId}`))
  const offRouter = router.onChange(next =>
    socia.tabs.setActive(next.startsWith('/profile') ? 'profile' : 'home').catch(() => {}))
  router.start()
  return () => { offTabs(); offRouter() }
})
```

### manifest.json

Read by the host **before** launch: four required fields plus three optional sections.

```json
{
  "username": "my_notes",
  "name": "My Notes",
  "version": "0.1.0",
  "entry": "index.html",
  "ui": { ... },
  "backend": { ... },
  "permissions": ["network"]
}
```

- `username` — without `@`, lowercase `[a-z0-9_]`, 6..32 chars for a new app (3..32 when updating an existing one), no leading/trailing `_`; rejected if taken by a user, channel, group or app.
- `name` — catalog name. `version` — semver, must differ on update. `entry` — always `index.html`.

**`ui` — native interface:**

```json
{
	"ui": {
		"fullscreen": false, "showHeader": true, "orientation": "auto",
		"tabbar": {
			"enabled": true, "defaultTab": "home", "showBack": true, "showSettings": true,
			"tabs": [
				{ "id": "home", "icon": "home", "label": "Home" },
				{ "id": "profile", "icon": "user", "label": "Profile" }
			],
			"style": { "background": "#202020", "activeColor": "#fbbf24", "shadow": "soft" }
		}
	}
}
```

- `fullscreen` hides the header (default `false`); `showHeader` shows the app name when not fullscreen.
- `orientation` — `"auto"` | `"portrait"` | `"landscape"`; override with `socia.ui.setOrientation(...)`; on iOS enable it in the host `Info.plist`.
- `tabbar.enabled` default `false`; tabs are `{ id, icon, label }` and `id` is also a route (`/home`, `/profile`); `defaultTab` is active on launch; `showBack`/`showSettings` toggle the round buttons.
- `tabbar.style` — `background`, `borderColor`, `borderWidth`, `borderRadius`, `activeColor`, `inactiveColor` (e.g. `rgba(232,228,222,0.48)`), `shadow`: `"soft"` (two-layer) | `"hard"` (offset solid, no blur) | `"none"`.
- **Icons** (Lucide names): `home`, `users`, `user`, `heart`, `star`, `image`, `camera`, `music`, `video`, `analytics`, `wallet`, `credit-card`, `settings`, `bell`, `mail`, `gamepad`, `shopping-cart`, `map-pin`, `calendar`, `history`, `info`, `search`, `menu`, `chevron-left`; unknown → `apps`.

**`backend` — network rules:**

```json
{
	"backend": {
		"base_url": "https://api.example.com",
		"allowed_paths": ["/users/me", "/notes", "/notes/*"],
		"allowed_methods": ["GET", "POST", "PUT", "DELETE"],
		"timeout_sec": 15,
		"headers": { "X-App-Version": "1.0.0" }
	}
}
```

- `allowed_paths` — `*` covers a subtree (`/notes/*`); plain `/notes` is exact — list both if needed.
- `allowed_methods` — verb whitelist. `timeout_sec` — default 15. `headers` — sent on every request.
- `permissions` — only `["network"]`, shown in the pre-install preview; no hidden permissions.

**Username availability** — checked by the CLI before scaffolding and before the first deploy:

```
GET /api/sphere/check_username?u=my_notes
→ { "username": "my_notes", "available": true }
```

`available: false` — taken by a user, channel, group, app, or reserved.

---

## 4. JS Bridge reference

The host injects `window.socia`; import `shared/lib/socia.ts` (thin wrapper), not `window.socia` directly.

### `socia.api` — HTTP proxy

```ts
await socia.api.get<T>('/users/me')
await socia.api.post('/notes', { title: 'First' })
await socia.api.put('/notes/42', { title: 'Updated' })
await socia.api.delete('/notes/42')
```

- Paths/methods are checked against the manifest; the host injects `Authorization: Bearer <user JWT>` itself, so **the JWT never reaches JS**.
- Paths are normalised via `Uri.parse(path).normalizePath().path`; `..` is rejected.
- Promises **reject** with `Error(message)` — always `try/catch`.

| Message                        | Meaning                                     |
| ------------------------------ | ------------------------------------------- |
| `Path not allowed`             | Path is not in `backend.allowed_paths`.     |
| `Method not allowed`           | Method is not in `backend.allowed_methods`. |
| `HTTP <code>`                  | Backend returned non-2xx.                   |
| `timeout`                      | Exceeded `backend.timeout_sec`.             |
| `SociaBridge is not available` | Not running inside the host (browser).      |

### `socia.tabs` — native tab bar

```ts
socia.tabs.setActive(tabId):          Promise<{ ok: boolean }>
socia.tabs.getActive():               Promise<string | null>
socia.tabs.onChange(cb):              () => void  // unsubscribe
socia.tabs.setTabbarVisible(visible): Promise<{ ok: boolean }>
```

`onChange` fires on a native tap — register in `onMount`, call the returned function on unmount. `setActive` highlights the tab after internal navigation; `setTabbarVisible(false)` suits fullscreen screens (restore it on exit).

### `socia.ui` — native dialogs and orientation

```ts
socia.ui.showSheet(config):     Promise<{ action: string, values: Record<string, string> }>
socia.ui.alert(config):         Promise<{ action: string }>
socia.ui.confirm(config):       Promise<boolean>
socia.ui.onBack(handler):       Promise<{ ok: boolean }>
socia.ui.onSettings(handler):   Promise<{ ok: boolean }>
socia.ui.setOrientation(o):     Promise<{ ok: boolean }>
```

`showSheet` and `alert` **reject** when the user closes the dialog via "×" — catch and ignore.

```ts
interface SociaSheetConfig { title?: string; helpText?: string /* opens on "?" in header */; fields?: SociaSheetField[]; actions?: SociaSheetAction[] /* default: one "OK" */ }
interface SociaSheetField { type: 'text' | 'textarea' | 'number' | 'email' | 'password'; name: string /* key in values */; label?: string; placeholder?: string; value?: string /* initial */ }
interface SociaSheetAction { id: string /* res.action */; label: string; style?: 'primary' | 'secondary'; cancel?: boolean /* promise rejects */ }
interface SociaAlertConfig { title?: string; helpText?: string; message: string; actions?: SociaAlertAction[] /* default: one "OK" */ }
interface SociaAlertAction { id: string; label: string; style?: 'primary' | 'secondary'; destructive?: boolean /* red */ }
interface SociaConfirmConfig { title?: string; message: string; confirmLabel?: string /* "OK" */; cancelLabel?: string /* "Cancel" */; destructive?: boolean /* red confirm */ }
```

`confirm` wraps `alert` with Cancel + primary, resolving `true` only on confirmation. Without `onBack` the host closes the app; without `onSettings` it shows a "no settings" toast. `setOrientation` rotates the whole host, restored on close (needs the `Info.plist` entry on iOS).

### `socia.context` — user context

```ts
socia.context.get():      Promise<SociaContext>
socia.context.refresh():  Promise<SociaContext>  // force re-fetch
socia.context.cached:     SociaContext           // synchronous read
```

```ts
interface SociaContext {
	sphereUserId: string // HMAC-SHA256(user_id + ":" + app_username, key), hex 64 chars
	username: string | null // null if not shared
	firstName: string | null
	lastName: string | null
	avatarUrl: string | null
	app: string // app username the context was issued for
	publisherPubkey: string // publisher Ed25519 key (base64), pin it
	exp: number // unix seconds (TTL 300 s, host renews)
	nonce: string // unique per issue, reject repeats
	sig: string // Ed25519 signature, base64
}
```

`sphereUserId` = `HMAC-SHA256(user_id || ":" || app_username, sphere_hmac_key)` in hex — stable per (user, app), different for every app, pseudonymous (the UUID never leaves the backend).

**The context is signed — verify `sig`, never trust a bare `sphereUserId`.** Forward `{ app, publisherPubkey, sphereUserId, username, firstName, lastName, avatarUrl, exp, nonce, sig }` to your backend, then:

1. Fetch the key once from `GET /api/sphere/context/pubkey` (`{ algorithm: "Ed25519", public_key, ttl_sec }`); cache it, refetch if checks fail. Reject a `publisherPubkey` different from your pinned copy.
2. Rebuild the canonical string — STANDARD base64 **with padding** per string field, `null` → base64 of the empty string:

   ```text
   socia:sphere:context:v2|<b64 app>|<b64 publisherPubkey>|<b64 sphereUserId>|<exp>|<b64 nonce>|<b64 username>|<b64 firstName>|<b64 lastName>|<b64 avatarUrl>
   ```

3. Verify the Ed25519 signature over the UTF-8 bytes of that string.
4. Reject `exp` in the past, `app` != your app username, `publisherPubkey` != your pinned key, and a repeated `nonce` (keep seen nonces for at least `ttl_sec`).

```ts
import { createPublicKey, verify } from 'node:crypto';

const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');
const b = (v: string | null | undefined) =>
	Buffer.from(v ?? '', 'utf8').toString('base64');

export function verifySociaContext(ctx: SociaContext, publicKeyB64: string) {
	const message = [
		'socia:sphere:context:v2',
		b(ctx.app),
		b(ctx.publisherPubkey),
		b(ctx.sphereUserId),
		String(ctx.exp),
		b(ctx.nonce),
		b(ctx.username),
		b(ctx.firstName),
		b(ctx.lastName),
		b(ctx.avatarUrl),
	].join('|');

	const key = createPublicKey({
		key: Buffer.concat([ED25519_SPKI, Buffer.from(publicKeyB64, 'base64')]),
		format: 'der',
		type: 'spki',
	});

	return verify(null, Buffer.from(message, 'utf8'), key, Buffer.from(ctx.sig, 'base64'));
}
```

Without signature + nonce checks anyone holding the id can impersonate the user — it is a pseudonym, not a bearer token. The host renews the context while the app is open (60 s before `exp`, at most once a minute); never store `sig`/`nonce` beyond `exp`. `get()` is instant after the first call — `refresh()` only when the profile changed.

### `socia.home` — home screen shortcut

```ts
socia.home.add(): Promise<{ ok: boolean }>
```

Pins the app on the Android home screen (name and icon from the manifest and cached catalog). `ok` is `true` only when the system dialog appeared — `false` on iOS, Android < 8, launchers without pinned shortcuts, or an unready host.

---

## 5. Svelte 5 tutorial

`.svelte` compiles to plain JS — no virtual DOM; a component is `<script>` (runs once), markup, scoped `<style>`.

- **`$state`** — Proxy-wrapped rune: mutation updates only dependent UI, no reassignment needed, but deep objects slow every read — keep state flat.
- **`$derived`** — `let doubled = $derived(count * 2)` recomputes automatically; `$derived.by(() => …)` for multi-statement logic; prefer it over `$effect`.
- **`$props`** — `let { title, count = 0, children }: Props & { children: Snippet } = $props()`; pass `<Card title="Welcome" count={5} />`, render children (React's `children`) via `{@render children()}`.
- **Events** are plain attributes, not `on:click` (Svelte 4): `onclick`, `oninput`, `onchange`, `onsubmit`, `onkeydown`, `oncontextmenu`, `onpointerdown`; bindings `bind:value`, `bind:checked`.
- **Control flow** — no `{user && <p>…</p>}`: always `{#if user}…{:else if loading}…{:else}…{/if}`; `{#each items as item (item.id)}` — `(item.id)` is the key, add it when the list can reorder.
- **`<style>`** is scoped automatically; `:global(...)` opts out.
- **`onMount`** runs after the DOM exists, may return a cleanup (timers, subscriptions). **`$effect`** reruns when the state it reads changes — **use sparingly**, always return a cleanup; the easiest place to create infinite loops.

### Svelte 5 vs Svelte 4

| Svelte 4                          | Svelte 5                            |
| --------------------------------- | ----------------------------------- |
| `export let title`                | `let { title } = $props()`          |
| `$: doubled = count * 2`          | `let doubled = $derived(count * 2)` |
| `on:click={handler}`              | `onclick={handler}`                 |
| `<slot />`                        | `{@render children()}`              |
| `export let value` + `bind:value` | `$bindable()`                       |

A tutorial using `export let` or `$:` is Svelte 4; that syntax does not work here.

---

## 6. Design system and UI/UX

Native part of the messenger, not a website in a box: monochrome, dark, glassy, quiet.

```
#000000     black background (Scaffold)
#0A0A0A     surface 1 — cards, containers
#111111     surface 2 — modals, sheets
#161616     surface 3 — hover, active
#FFFFFF     white text — headings, primary
#B3FFFFFF   soft text — descriptions
#80FFFFFF   muted — labels, hints
#4DFFFFFF   dim — placeholder, disabled
```

- **Borders** — `0x1FFFFFFF` card 1px, `0x33FFFFFF` active/focus, `0x1AFFFFFF` soft, `0x0DFFFFFF` inputs.
- **Accents, one element at a time** — `#4ADE80` success, `#FF3B30` error/delete, `#FF9F0A` warning/pending, `#4A9EFF` info/links.
- **Radii** — 32 balance card, 28 large cards/sheet header, 24 containers and send/receive, 22 search pill, 20 token cards/sheet headers, 18 small cards/transaction tile, 16 chips/badges, 12 inner blocks, 95 primary buttons (pill).
- **Typography** — **Poppins** (Google Fonts), system sans fallback: 40pt w700 balance, 34 w700 section hero, 24–26 w600 headings, 17–20 w600 sheet/modal, 15–16 w500–600 body, 12–14 w400 descriptions/labels, 10–11 timestamps/chips; `letter-spacing: -0.2px` on large headings.
- **Spacing** — 4px grid: 4, 8, 12, 16 (default), 20, 24, 32; card padding 16–20, sections 24–32 apart.
- **Icons — only Lucide**; no Material icons, icon fonts or custom SVG sets. Host-only exceptions: `_StatusIcon` (12px) and `glass_back_button.dart`. **No emojis in UI text.**
- **Cards** — radius 20–24, `#0A0A0A`, border `0x1FFFFFFF`, no shadow unless floating (blur 30/alpha 0.55/offset (0,10) + blur 60/alpha 0.30/offset (0,20)).
- **Buttons** — primary: height 56, radius 95, white on black (disabled `0x1AFFFFFF` bg, `0x66FFFFFF` text); secondary: transparent, 1px `0x33FFFFFF`. **Inputs** — radius 24, `0x0A000000` bg, `0x1FFFFFFF` border, `0x33FFFFFF` on focus.
- **Sheets** — always native `socia.ui.showSheet`/`alert`/`confirm`, never rebuilt.
- **Motion** — screen transitions FadeTransition 500ms `Curves.easeOut`; modal fade + scale 0.9→1.0 in 350ms; content fade-in 350ms `Curves.easeOutCubic`; press scale 0.98 in 110–120ms; numbers 400–700ms. No white flashes (`AnimatedContainer`, `AnimatedOpacity`, `AnimatedSize`); respect `prefers-reduced-motion`.
- **Loading** — something within 100ms; a skeleton, not a spinner. **Empty state** — icon, short title, one sentence, optional action. **Errors** — readable message with "Retry", never a stack trace.
- **Long-press** — intercept `oncontextmenu` + `preventDefault()`, or the WebView opens its native menu. **Search** — debounce 300–400ms.
- **Destructive actions** — always `socia.ui.confirm` with `destructive: true`. Never render raw ciphertext, errors or base64; fail closed with `[not available]`.
- **Deep links** — `socia://sphere/notes`, no reverse-domain ids.
- **Accessibility** — tap targets ≥ 44×44, white on black meets WCAG AA, Enter/Space trigger primary actions on desktop.
- **Avoid** — white flashes, Material icons, emojis, custom modals, `CircularProgressIndicator` as the only loader, mixed glassmorphism.

---

## 7. Build & deploy

```bash
npm install
npm run dev     # http://localhost:5173, reloads on src/ edits
npm run build   # dist/ with relative ./assets/... paths
```

**`window.socia` is not available in a plain browser** — `socia.api` fails there; use `socia dev`.

```bash
socia login     # JWT → ~/.socia/config.json
socia keygen    # Ed25519 keypair, once: ~/.socia/signing_key(.pub)
```

Run `keygen` **once**, before the first deploy: the public key is embedded in every package and registered on the backend. **Lose the private key and you cannot publish updates** — back it up.

`socia build` packs a `tar.br` (`manifest.json`, `index.html`, `assets/...`, `signature.bin` — base64 Ed25519 over the SHA-256 digest); the host verifies it against the publisher key (backend + manifest) and refuses on mismatch.

`socia deploy`: build → parse `<title>`/`<meta>` from `dist/index.html` → stage `dist/` + manifest → embed the publisher pubkey → sign → pack (tar + brotli q11) → open a form on a free local port (the URL is printed in the terminal) (name, description, category, channel URL, icon, screenshots, changelog) → upload. The backend stores it as `status: pending`; after moderation it appears in the catalog as `@my_notes` / `socia://sphere/my_notes`.

`socia dev` serves `localhost:3003` — iPhone frame, native-looking tab bar, mock API, HMR in an iframe. Config: `mock-api.json` in the project root.

```json
{
	"__context": {
		"sphereUserId": "mock-user-abcdef",
		"username": "mockuser",
		"firstName": "Mock",
		"lastName": "User",
		"avatarUrl": null
	},
	"GET /users/me": { "status": 200, "body": { "username": "mockuser" } }
}
```

Mocks toggle from the dev UI; a path missing from the table, with no bridge, rejects with `SociaBridge is not available`.

```bash
socia bump patch    # 0.1.0 → 0.1.1  (also minor, major; --git commits + tags)
```

```
socia create [name]              scaffold a new project
socia login                      open browser, save JWT to ~/.socia/config.json
socia keygen                     generate the Ed25519 signing key (once)
socia dev                        dev UI with HMR, mock API, phone frame
socia build                      pack into .socia (runs vite build)
socia deploy                     build + sign + open the publish form
socia publish                    publish an existing .socia to the local registry
socia bump patch|minor|major     increment version in manifest.json
socia shot                       screenshot the app inside a phone frame
socia update                     refresh framework configs from the template
```

Use `socia dev`, not `npm run dev`; full end-to-end testing needs a device. Rebuild after any `manifest.json` change — it is signed with the package. Never change `manifest.username` after the first deploy; a new identity means a new app.

---

## 8. Security and limits

- **JWT never reaches JS** — it lives in Flutter memory; the host injects `Authorization` itself, so a WebView RCE cannot steal it.
- **Sandbox per app** — `allowFileAccess`, `allowContentAccess`, `allowFileAccessFromFileURLs`, `allowUniversalAccessFromFileURLs` all `false`; external `<script src>` / `<link href>` never load.
- **Ed25519 fail-closed** — verified before unpacking; any mismatch refuses.
- **Separate backend keys** — `SOCIA_APP_JWT_SECRET` (user JWTs), `SOCIA_APP_EMAIL_HASH_KEY` (email hash), `SOCIA_APP_SPHERE_HMAC_KEY` (per-app user id); the backend refuses to start if `sphere_hmac_key` equals `email_hash_key`.
- **@bot messages** — `app_submitted` (payload carries the app `username`, not a reverse-domain id), `app_approved`, `app_rejected` (with comment), `app_published`, `new_device`, `security`, `welcome`. **Not E2EE** — plaintext JSON in `messages.ciphertext`; the chat is created automatically and cannot be replied to.
- **Deploy limits** — icon ≤ 5 MB, screenshots ≤ 10 MB each (auto-PNG), at most 5 screenshots, signed package ≤ 50 MB compressed and ≤ 128 MiB unpacked with ≤ 10,000 files, `username` matches `^[a-z0-9_]{6,32}$` for new apps (3-32 when updating an existing one) without leading/trailing `_`, `publisher_pubkey` is base64 of exactly 32 bytes; package SHA-256 is an integrity check, not a security boundary.
- **Runtime limits** — per-origin `localStorage`/`IndexedDB`; `fetch` blocked; external scripts/styles do not load; no native APIs (camera, files, push); no background tasks; the WebView sleeps when backgrounded.
- **Account** — username 3–32 chars `[a-zA-Z0-9_]`, no leading/trailing `_`; password 8–128 with upper + lower + digit; wallet `encrypted_blob` ≤ 16 KB. Reserved: `bot`, `admin`, `security`, `sphere`, `socia`, `support`, `system`, `root`, `socia_team`, `help`, `official`, `apps`, `app`, `miniapp`, `miniapps`, `marketplace`, `catalog`, `feed`, `wallet`, `chats`, `search`, `profile`, `settings`, `login`, `register`.
- **Bundle** — target < 1 MB, hard limit 50 MB compressed / 128 MiB unpacked; no moment.js, lodash or icon packs; native `Date`, small helpers; `import { x } from 'lib'`, never `import * as lib`; watch `dist/assets/`.
- **Anti-patterns** — direct `fetch` (bypasses the whitelist), `history.pushState`, external assets, blocking the main thread, trusting input without backend validation, logging secrets.

---

## 9. Troubleshooting

- **`SociaBridge is not available`** — opened via `npm run dev` in a browser; use `socia dev` or Socia.
- **`Path not allowed` / `Method not allowed`** — missing from `backend.allowed_paths` / `allowed_methods`; add, rebuild (`socia deploy`), redeploy.
- **`timeout`** — exceeded `backend.timeout_sec`; raise it or optimise the request.
- **Blank screen** — missing `entry` reference or `#app` element; `main.ts` throws before mounting (DevTools → Console); invalid `username` or missing manifest field.
- **`manifest.username` is invalid** — 6..32 chars for a new app (3..32 on updates), lowercase `[a-z0-9_]`, no leading/trailing `_`, no dots/dashes/uppercase (e.g. `My_Notes`).
- **`publisher_pubkey mismatch`** — manifest key differs from the registered one (rotated key, or another developer's package); fail-closed, it will not install.
- **Tab bar ignores taps** — register `socia.tabs.onChange` in `onMount`; in `socia dev` an iframe loaded before the handler attached loses the `postMessage` — reload; tab `id` must match the route.
- **Long-press does not work** — intercept `oncontextmenu` + `preventDefault()`; in DevTools use mobile emulation (right-click = long-press).
- **App resets after reload** — `localStorage` is per-origin (same app username); check for silent quota failures.
- **Bundle too large** — check `dist/assets/`, drop heavy deps, find `import * as ...`, import icons individually.
- **`prefers-reduced-motion` ignored**:

```css
@media (prefers-reduced-motion: reduce) {
	* { animation: none !important; transition: none !important; }
}
```

- **Slow** — profile in Chrome; check duplicated calls, long tasks (>50ms), bundle size, `$effect` chains; cache API results in `$state`.

---

## Resources

- **Docs:** https://socia.you/docs · **Quickstart:** /docs/quickstart · **Manifest:** /docs/reference/manifest · **Recipes:** /docs/reference/manifest-recipes
- **JS Bridge:** /docs/reference/js-bridge · **Architecture / Security / Limits:** /docs/explanation/{architecture,security,limits}
- **Tutorial (Notes):** https://socia.you/docs/tutorial/notes/01-what
- **Config:** `~/.socia/config.json` · **Keys:** `~/.socia/signing_key`, `.pub`
- **Dev UI:** http://localhost:3003 · **Vite:** http://localhost:5173 · **Deploy UI:** a free local port, printed in the terminal

For anything not covered here, **say so explicitly** instead of guessing. https://socia.you/docs is canonical; if a section is missing, say the docs are being written and reason from first principles.
