import { spawn } from 'child_process'
import chokidar from 'chokidar'
import express from 'express'
import fsExtra from 'fs-extra'
import open from 'open'
import { join } from 'path'
import { LOCAL_HOST, localRequestGuard } from '../utils/local-http.js'
import { logger } from '../utils/logger.js'
import { loadManifest } from '../utils/manifest.js'
import { colors } from '../utils/theme.js'

const { existsSync, readFileSync } = fsExtra

export interface DevOptions {
	port?: number
	noOpen?: boolean
}

interface TabbarStyle {
	background?: string
	borderColor?: string
	borderWidth?: number
	borderRadius?: number
	activeColor?: string
	inactiveColor?: string
	shadow?: 'soft' | 'hard' | 'none'
}

/// Минимальный срез манифеста — только то, что нужно dev-UI.
/// Публичный идентификатор теперь `username`, не `id`.
interface Manifest {
	username: string
	name?: string
	ui?: {
		fullscreen?: boolean
		tabbar?: {
			enabled?: boolean
			tabs?: Array<{ id: string; icon: string; label?: string }>
			defaultTab?: string
			showBack?: boolean
			showSettings?: boolean
			style?: TabbarStyle
		}
	}
}

/**
 * Handle returned by `startDevServer`. The caller owns the
 * lifecycle and must call `stop()` when done.
 */
export interface DevServerHandle {
	port: number
	/** Dev UI URL (toolbar, phone frame, mock API controls). */
	url: string
	/** Raw mini-app URL served by Vite. */
	appUrl: string
	stop: () => Promise<void>
}

/**
 * `socia dev` — Vite dev server + a preview UI.
 *
 * Opens a browser and blocks until Ctrl+C.
 */
export async function devCommand(options: DevOptions): Promise<void> {
	const handle = await startDevServer(options)

	if (!options.noOpen) {
		// Fire and forget — do NOT await. On Windows `open` may
		// attach to the spawned shell and never resolve, which
		// would block the CLI before it even prints "waiting for
		// Ctrl+C".
		open(handle.url).catch(() => {
			openWithSystemCommand(handle.url)
		})
	}

	await new Promise<void>(resolve => {
		const onSignal = async () => {
			await handle.stop()
			resolve()
		}
		process.once('SIGINT', onSignal)
		process.once('SIGTERM', onSignal)
	})
}

/**
 * Start Vite + the preview Express UI without opening a browser.
 *
 * Returns a handle. Call `handle.stop()` to shut everything down.
 */
export async function startDevServer(
	options: DevOptions,
): Promise<DevServerHandle> {
	const projectDir = process.cwd()
	const port = options.port ?? 3003

	logger.step(1, port ? `Starting dev UI on http://${LOCAL_HOST}:${port}` : 'Starting dev UI')

	// loadManifest возвращает полноценный MiniAppManifest —
	// он структурно совместим с локальным срезом Manifest,
	// но в нём есть `username`, а не `id`.
	let manifest = loadManifest(projectDir) as Manifest
	let mockTable = loadMockTable(projectDir)

	logger.info(`Project: @${manifest.username}`)
	if (mockTable) {
		const count = Object.keys(mockTable).length
		logger.success(
			`Loaded mock-api.json (${count} endpoint${count === 1 ? '' : 's'})`,
		)
	}

	// ---- Vite ----

	const vite = spawn('npm', ['run', 'dev'], {
		cwd: projectDir,
		stdio: ['ignore', 'pipe', 'pipe'],
		shell: process.platform === 'win32',
	})

	// Capture Vite's output from the very first byte. We need it to
	//   - extract the actual dev server URL (Vite falls back to
	//     5174+ if 5173 is taken, and vite.config may override it);
	//   - surface a readable error if Vite dies before it is ready.
	let viteOutput = ''
	let viteUrl: string | null = null

	// Vite uses ANSI escapes for its banner. Strip them before
	// matching — a colour code between `http://` and `localhost`
	// would break the regex.
	const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

	// Match on the FULL accumulated buffer, not per-chunk. Node
	// stream chunks can split a URL across boundaries; matching a
	// chunk in isolation would miss it.
	const tryParseUrl = () => {
		if (viteUrl) return
		const clean = stripAnsi(viteOutput)
		const m = clean.match(/http:\/\/localhost:(\d+)/)
		if (m) viteUrl = `http://localhost:${m[1]}`
	}

	const onViteOut = (chunk: Buffer) => {
		viteOutput += chunk.toString()
		process.stdout.write(chunk)
		tryParseUrl()
	}
	const onViteErr = (chunk: Buffer) => {
		viteOutput += chunk.toString()
		process.stderr.write(chunk)
		tryParseUrl()
	}

	vite.stdout?.on('data', onViteOut)
	vite.stderr?.on('data', onViteErr)

	logger.step(2, 'Waiting for Vite to be reachable')
	const viteReady = await waitForViteUrl(vite, () => viteUrl, 30_000)
	if (!viteReady) {
		try {
			vite.kill('SIGTERM')
		} catch {
			// ignore
		}
		const tail = stripAnsi(viteOutput).trim().slice(-1500)
		throw new Error(
			'Vite did not start within 30 seconds.' +
				(tail ? `\n\nLast Vite output:\n${tail}` : ''),
		)
	}

	// Confirmation block, styled like Vite's own banner:
	// arrow, two spaces, bold label with a colon, cyan URL.
	//
	//   ───────────────────────────────
	//
	//   ➜  Vite is up at: http://localhost:5173/
	//   ➜  Dev UI: http://localhost:3003/
	console.log('')
	console.log(`  ${colors.dim('─'.repeat(30))}`)
	console.log('')
	console.log(
		`  ${colors.success('➜')}  ${colors.bold('Vite is up at:')} ${colors.accent(`${viteUrl}/`)}`,
	)

	// ---- SSE ----

	const sseClients = new Set<express.Response>()

	function broadcast(event: string, data: unknown) {
		const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
		for (const client of sseClients) {
			try {
				client.write(payload)
			} catch {
				sseClients.delete(client)
			}
		}
	}

	// ---- Express ----

	const app = express()
	let localPort = 0
	app.use(localRequestGuard(() => localPort))

	app.get('/', (_req, res) => {
		res.send(buildDevHtml(publicManifest(manifest), mockTable, viteUrl!))
	})

	app.get('/api/events', (req, res) => {
		res.setHeader('Content-Type', 'text/event-stream')
		res.setHeader('Cache-Control', 'no-cache')
		res.setHeader('Connection', 'keep-alive')
		res.flushHeaders?.()

		res.write(
			`event: init\ndata: ${JSON.stringify({
				manifest: publicManifest(manifest),
				mockTable,
			})}\n\n`,
		)

		sseClients.add(res)
		req.on('close', () => sseClients.delete(res))
	})

	const server = app.listen(port, LOCAL_HOST)

	await new Promise<void>((resolve, reject) => {
		server.once('listening', () => resolve())
		server.once('error', reject)
	})

	const address = server.address()
	const actualPort =
		typeof address === 'object' && address ? address.port : port
	localPort = actualPort

	console.log(
		`  ${colors.success('➜')}  ${colors.bold('Dev UI:')} ${colors.accent(`http://${LOCAL_HOST}:${actualPort}/`)}`,
	)

	// ---- File watchers ----

	const manifestPath = join(projectDir, 'manifest.json')
	const mockPath = join(projectDir, 'mock-api.json')

	const watcher = chokidar.watch([manifestPath, mockPath], {
		ignoreInitial: true,
		awaitWriteFinish: {
			stabilityThreshold: 150,
			pollInterval: 50,
		},
	})

	watcher.on('change', path => {
		if (path === manifestPath) {
			try {
				manifest = loadManifest(projectDir) as Manifest
				logger.info('manifest.json changed — pushing to browser')
				broadcast('manifest', publicManifest(manifest))
			} catch (e) {
				logger.warn(
					`manifest.json is invalid: ${e instanceof Error ? e.message : e}`,
				)
			}
			return
		}

		if (path === mockPath) {
			mockTable = loadMockTable(projectDir)
			const count = mockTable ? Object.keys(mockTable).length : 0
			logger.info(`mock-api.json changed (${count} endpoints)`)
			broadcast('mock', { mockTable })
		}
	})

	// ---- Handle ----

	const url = `http://${LOCAL_HOST}:${actualPort}`

	const stop = (): Promise<void> => {
		return new Promise(resolve => {
			watcher.close()
			for (const c of sseClients) {
				try {
					c.end()
				} catch {
					// ignore
				}
			}
			sseClients.clear()

			try {
				vite.kill('SIGTERM')
			} catch {
				// ignore
			}

			server.close(() => resolve())
		})
	}

	return { port: actualPort, url, appUrl: viteUrl!, stop }
}

// ============================================================
// HELPERS
// ============================================================

/**
 * The dev UI only needs presentation fields. Never send `backend` to the
 * browser: it can contain private headers for the app's backend.
 */
function publicManifest(manifest: Manifest): Manifest {
	return {
		username: manifest.username,
		name: manifest.name,
		ui: manifest.ui,
	}
}

function loadMockTable(projectDir: string): Record<string, unknown> | null {
	const mockPath = join(projectDir, 'mock-api.json')
	if (!existsSync(mockPath)) return null

	try {
		return JSON.parse(readFileSync(mockPath, 'utf-8'))
	} catch (e) {
		logger.warn(
			`mock-api.json is invalid JSON: ${e instanceof Error ? e.message : e}`,
		)
		return null
	}
}

// ============================================================
// LUCIDE SVG SPRITE
// ============================================================

const LUCIDE_ICONS: Record<string, string> = {
	home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
	'chevron-left': '<polyline points="15 18 9 12 15 6"/>',
	'chevron-right': '<polyline points="9 18 15 12 9 6"/>',
	'chevron-down': '<polyline points="6 9 12 15 18 9"/>',
	'chevron-up': '<polyline points="18 15 12 9 6 15"/>',
	x: '<line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/>',
	menu: '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
	search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
	info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
	users:
		'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
	user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
	heart:
		'<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
	star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
	image:
		'<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
	camera:
		'<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
	music:
		'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
	video:
		'<path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/>',
	'bar-chart-3':
		'<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
	analytics:
		'<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
	wallet:
		'<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
	'credit-card':
		'<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
	settings:
		'<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
	bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
	mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
	'gamepad-2':
		'<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>',
	'shopping-cart':
		'<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
	'map-pin':
		'<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
	calendar:
		'<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
	history:
		'<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
}

function svgForIcon(name: string): string {
	const key = name.toLowerCase()
	const path = LUCIDE_ICONS[key] ?? LUCIDE_ICONS.info
	return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${path}</svg>`
}

// ============================================================
// HTML
// ============================================================

function buildDevHtml(
	manifest: Manifest,
	mockTable: Record<string, unknown> | null,
	viteUrl: string,
): string {
	const appName = manifest.name ?? manifest.username
	const tabbar = manifest.ui?.tabbar ?? {}
	const tabs = tabbar.tabs ?? []
	const defaultTab =
		tabbar.defaultTab ?? (tabs.length > 0 ? tabs[0].id : 'home')
	const showBack = tabbar.showBack !== false
	const showSettings = tabbar.showSettings !== false

	const tabsHtml = renderTabs(tabs, defaultTab)

	const backBtn = showBack
		? `<button class="circle" data-action="back" type="button" aria-label="Back">
				${svgForIcon('chevron-left')}
			</button>`
		: `<div class="circle-spacer"></div>`

	const settingsBtn = showSettings
		? `<button class="circle" data-action="settings" type="button" aria-label="Settings">
				${svgForIcon('settings')}
			</button>`
		: `<div class="circle-spacer"></div>`

	const mockChecked = mockTable ? 'checked' : ''
	const styleJson = JSON.stringify(tabbar.style ?? {})

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>Socia Dev — ${escapeHtml(appName)}</title>
  <style>${STYLES}</style>
</head>
<body>
  <header class="topbar">
    <span class="title">Socia Dev</span>
    <span class="app-id" id="app-id">@${escapeHtml(manifest.username)}</span>
  </header>

  <main class="stage">
    <aside class="devtools">
      <label class="switch">
        <input type="checkbox" id="mock-toggle" ${mockChecked} />
        <span class="switch__track"><span class="switch__thumb"></span></span>
        <span class="switch__label">Mock API</span>
      </label>
      <button class="devtools__btn" id="orientation-btn" type="button">
        Portrait
      </button>
      <button class="devtools__btn" id="fullscreen-btn" type="button">
        Fullscreen: OFF
      </button>
      <button class="devtools__btn" id="reload-btn" type="button">Reload</button>
    </aside>

    <div class="phone" id="phone">
      <div class="notch"></div>
      <div class="phone-statusbar">
        <span class="status-time">9:41</span>
        <div class="status-icons">
          <svg class="status-icon" viewBox="0 0 18 12" fill="currentColor">
            <rect x="0" y="8" width="3" height="4" rx="0.5"/>
            <rect x="4" y="6" width="3" height="6" rx="0.5"/>
            <rect x="8" y="3.5" width="3" height="8.5" rx="0.5"/>
            <rect x="12" y="0" width="3" height="12" rx="0.5"/>
          </svg>
          <svg class="status-icon" viewBox="0 0 16 12" fill="currentColor">
            <path d="M8 3.5C10.5 3.5 12.8 4.5 14.4 6.1L15.5 5C13.5 3 10.9 1.8 8 1.8S2.5 3 0.5 5L1.6 6.1C3.2 4.5 5.5 3.5 8 3.5Z"/>
            <path d="M8 7C9.5 7 10.9 7.6 11.9 8.5L13 7.4C11.7 6.2 9.9 5.5 8 5.5S4.3 6.2 3 7.4L4.1 8.5C5.1 7.6 6.5 7 8 7Z"/>
            <circle cx="8" cy="10.5" r="1.2"/>
          </svg>
          <svg class="status-icon status-battery" viewBox="0 0 26 12" fill="none">
            <rect x="0.5" y="1" width="22" height="10" rx="3" stroke="currentColor" opacity="0.4"/>
            <rect x="2" y="2.5" width="18" height="7" rx="1.8" fill="currentColor"/>
            <path d="M24.5 4.5V7.5C25.4 7.2 25.8 6.5 25.8 6C25.8 5.5 25.4 4.8 24.5 4.5Z" fill="currentColor" opacity="0.4"/>
          </svg>
        </div>
      </div>

      <div class="top-controls" id="top-controls">
        <div class="top-controls__pill">
          <button class="top-controls__icon" data-action="settings" type="button" aria-label="Settings">
            ${svgForIcon('settings')}
          </button>
          <span class="top-controls__divider"></span>
          <button class="top-controls__icon" data-action="close" type="button" aria-label="Close">
            ${svgForIcon('x')}
          </button>
          <span class="top-controls__divider"></span>
          <button class="top-controls__icon" data-action="toggle" type="button" aria-label="Collapse">
            ${svgForIcon('chevron-up')}
          </button>
        </div>
        <button class="top-controls__collapsed" data-action="toggle" type="button" aria-label="Expand">
          ${svgForIcon('chevron-down')}
        </button>
      </div>

     <div class="phone__screen">
  <iframe
    src="${viteUrl}"
    title="Mini app preview"
  ></iframe>
</div>

      <div class="tabbar" id="tabbar">
        <span id="back-slot">${backBtn}</span>
        <div class="pill" id="tabs-pill">${tabsHtml}</div>
        <span id="settings-slot">${settingsBtn}</span>
      </div>
    </div>

    <p class="hint">
      Edit files under <code>src/</code> — the preview reloads automatically.
    </p>
  </main>

  <script>window.__SOCIA_DEV_VITE_URL__ = ${JSON.stringify(viteUrl)};</script>
  <script>window.__SOCIA_DEV_MOCK__ = ${JSON.stringify(mockTable)};</script>
  <script>window.__SOCIA_DEV_STYLE__ = ${styleJson};</script>
  <script>${SCRIPTS}</script>
</body>
</html>`
}

function renderTabs(
	tabs: Array<{ id: string; icon: string; label?: string }>,
	defaultTab: string,
): string {
	return tabs
		.map(
			t => `
				<button
					class="tab${t.id === defaultTab ? ' tab--active' : ''}"
					data-tab-id="${escapeHtml(t.id)}"
					type="button"
				>
					<span class="tab__icon">${svgForIcon(t.icon)}</span>
					<span class="tab__dot"></span>
				</button>`,
		)
		.join('')
}

// ============================================================
// SCRIPTS
// ============================================================

const SCRIPTS = `
(function () {
  // Vite's real URL, injected by the CLI at page-render time.
  // Falls back to the default only if the global is somehow missing.
  var MINIAPP_ORIGIN =
    window.__SOCIA_DEV_VITE_URL__ || 'http://localhost:5173'
  var iframe = document.querySelector('.phone iframe')
  var tabbar = document.querySelector('.tabbar')
  var tabsPill = document.getElementById('tabs-pill')
  var appId = document.getElementById('app-id')
  var mockToggle = document.getElementById('mock-toggle')
  var reloadBtn = document.getElementById('reload-btn')
  var orientationBtn = document.getElementById('orientation-btn')
  var fullscreenBtn = document.getElementById('fullscreen-btn')
  var topControls = document.getElementById('top-controls')

  if (!iframe) { console.warn('[socia dev] iframe not found'); return }
  if (!tabbar) { console.warn('[socia dev] tabbar not found'); return }

  var MOCK_TABLE = null
  var activeTabId = null
  var isLandscape = false

  // Fullscreen state — mirrors manifest ui.fullscreen.
  // null means "follow the manifest". A click on the button sets
  // an explicit override, so the dev can test both states without
  // touching the file.
  var manifestFullscreen = false
  var fullscreenOverride = null

  function applyOrientation() {
    document.body.classList.toggle('is-landscape', isLandscape)
    if (orientationBtn) {
      orientationBtn.textContent = isLandscape ? 'Landscape' : 'Portrait'
      orientationBtn.classList.toggle('devtools__btn--active', isLandscape)
    }
  }

  function applyFullscreen() {
    var effective =
      fullscreenOverride === null ? manifestFullscreen : fullscreenOverride

    // The ONLY thing that drives tabbar visibility is the body
    // class is-fs-ui. Never set inline display on the tabbar — an
    // inline display:none would override the CSS rule and stick
    // around after fullscreen is turned off.
    document.body.classList.toggle('is-fs-ui', effective)

    if (fullscreenBtn) {
      fullscreenBtn.textContent = 'Fullscreen: ' + (effective ? 'ON' : 'OFF')
      fullscreenBtn.classList.toggle('devtools__btn--active', effective)
    }
  }

  if (orientationBtn) {
    orientationBtn.addEventListener('click', function () {
      isLandscape = !isLandscape
      applyOrientation()
    })
  }

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', function () {
      var effective =
        fullscreenOverride === null ? manifestFullscreen : fullscreenOverride
      fullscreenOverride = !effective
      applyFullscreen()
    })
  }

  if (topControls) {
    topControls.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]')
      if (!btn) return
      var action = btn.dataset.action
      if (action === 'toggle') {
        topControls.classList.toggle('is-expanded')
        return
      }
      if (action === 'settings') sendToMini('ui.onSettings', {})
      else if (action === 'close') sendToMini('ui.onBack', {})
    })
  }

  applyOrientation()
  applyFullscreen()

  function applyStyle(style) {
    var root = document.documentElement
    if (!style) style = {}

    if (style.background) {
      root.style.setProperty('--tabbar-bg', style.background)
    }
    if (style.borderColor) {
      root.style.setProperty('--tabbar-border-color', style.borderColor)
    }
    if (typeof style.borderWidth === 'number') {
      root.style.setProperty('--tabbar-border-width', style.borderWidth + 'px')
    }
    if (typeof style.borderRadius === 'number') {
      root.style.setProperty('--tabbar-radius', style.borderRadius + 'px')
    }
    if (style.activeColor) {
      root.style.setProperty('--tabbar-active', style.activeColor)
    }
    if (style.inactiveColor) {
      root.style.setProperty('--tabbar-inactive', style.inactiveColor)
    }

    var shadow = style.shadow || 'soft'
    if (shadow === 'none') {
      root.style.setProperty('--tabbar-shadow', 'none')
    } else if (shadow === 'hard') {
      root.style.setProperty('--tabbar-shadow', '4px 4px 0 rgba(0,0,0,0.55)')
    } else {
      root.style.setProperty(
        '--tabbar-shadow',
        '0 10px 30px -2px rgba(0,0,0,0.55), 0 20px 60px 0 rgba(0,0,0,0.30)',
      )
    }
  }

  applyStyle(window.__SOCIA_DEV_STYLE__ || null)

  function sendToMini(action, payload) {
    try {
      iframe.contentWindow.postMessage(
        Object.assign({ type: 'socia:host', action: action }, payload || {}),
        MINIAPP_ORIGIN,
      )
    } catch (err) {
      console.warn('[socia dev] postMessage failed:', err)
    }
  }

  function pushMockTable(table) {
    try {
      iframe.contentWindow.postMessage(
        { type: 'socia:mock', table: table },
        MINIAPP_ORIGIN,
      )
    } catch (err) {
      console.warn('[socia dev] mock postMessage failed:', err)
    }
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== MINIAPP_ORIGIN) return
    var data = event.data
    if (!data || data.type !== 'socia:mini') return

    switch (data.action) {
      case 'tabs.setActive':
        if (typeof data.tabId === 'string') applyActiveTab(data.tabId)
        break
      case 'tabs.setTabbarVisible':
        console.log('[socia dev] setTabbarVisible:', data.visible)
        break
    }
  })

  function applyActiveTab(tabId) {
    activeTabId = tabId
    var nodes = document.querySelectorAll('.tab')
    for (var i = 0; i < nodes.length; i++) {
      var t = nodes[i]
      if (t.dataset.tabId === tabId) t.classList.add('tab--active')
      else t.classList.remove('tab--active')
    }
  }

  tabbar.addEventListener('click', function (e) {
    var tab = e.target.closest('.tab')
    if (tab) {
      var id = tab.dataset.tabId
      applyActiveTab(id)
      sendToMini('tabs.onHostChange', { tabId: id })
      return
    }

    var circle = e.target.closest('.circle')
    if (!circle) return
    var action = circle.dataset.action
    if (action === 'back') sendToMini('ui.onBack', {})
    else if (action === 'settings') sendToMini('ui.onSettings', {})
  })

  if (mockToggle) {
    mockToggle.addEventListener('change', function () {
      pushMockTable(mockToggle.checked ? MOCK_TABLE : null)
    })
  }

  if (reloadBtn) {
    reloadBtn.addEventListener('click', function () {
      var current = iframe.src
      iframe.src = 'about:blank'
      setTimeout(function () { iframe.src = current }, 50)
    })
  }

  function escapeAttr(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/'/g, '&#39;')
  }

  function renderTabs(tabs, defaultTab) {
    var html = ''
    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i]
      var active = t.id === (activeTabId || defaultTab) ? ' tab--active' : ''
      html += '<button class="tab' + active + '" data-tab-id="' + escapeAttr(t.id) + '" type="button">'
      html += '<span class="tab__icon">' + iconSvg(t.icon) + '</span>'
      html += '<span class="tab__dot"></span>'
      html += '</button>'
    }
    return html
  }

  function applyManifest(m) {
    if (!m) return
    if (appId) appId.textContent = m.username ? '@' + m.username : appId.textContent

    var tb = (m.ui && m.ui.tabbar) || {}
    var tabs = tb.tabs || []
    var defaultTab = tb.defaultTab || (tabs.length > 0 ? tabs[0].id : 'home')

    var stillExists = false
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].id === activeTabId) stillExists = true
    }
    if (!stillExists) activeTabId = null

    // Do NOT touch tabbar.style.display. Visibility is controlled
    // entirely by the body class is-fs-ui, which applyFullscreen
    // toggles. An inline style would override CSS and stick around
    // after fullscreen is turned off.
    tabsPill.innerHTML = renderTabs(tabs, defaultTab)

    // The manifest ui.fullscreen sets the default simulated state.
    // The toolbar button can override it without touching the file.
    var ui = m.ui || {}
    manifestFullscreen = ui.fullscreen === true
    fullscreenOverride = null
    applyFullscreen()
  }

  var es = new EventSource('/api/events')

  es.addEventListener('init', function (e) {
    try {
      var payload = JSON.parse(e.data)
      MOCK_TABLE = payload.mockTable || null
      applyManifest(payload.manifest)
      var tb = (payload.manifest && payload.manifest.ui && payload.manifest.ui.tabbar) || {}
      applyStyle(tb.style || null)
    } catch (err) { console.warn('[socia dev] init parse failed:', err) }
  })

  es.addEventListener('manifest', function (e) {
    try {
      var m = JSON.parse(e.data)
      applyManifest(m)
      var tb = (m.ui && m.ui.tabbar) || {}
      applyStyle(tb.style || null)
    } catch (err) { console.warn('[socia dev] manifest parse failed:', err) }
  })

  es.addEventListener('mock', function (e) {
    try {
      var payload = JSON.parse(e.data)
      MOCK_TABLE = payload.mockTable || null
      if (mockToggle) {
        mockToggle.checked = Boolean(MOCK_TABLE)
        pushMockTable(mockToggle.checked ? MOCK_TABLE : null)
      }
    } catch (err) { console.warn('[socia dev] mock parse failed:', err) }
  })

  es.addEventListener('error', function () {
    console.warn('[socia dev] SSE connection lost')
  })

  function syncActiveFromIframe() {
    try {
      var hash = iframe.contentWindow.location.hash.replace(/^#\\//, '')
      if (hash) applyActiveTab(hash)
    } catch (err) {
      // Cross-origin — cannot read iframe location.
    }
  }

  iframe.addEventListener('load', function () {
    setTimeout(syncActiveFromIframe, 100)
    setTimeout(function () {
      if (mockToggle) pushMockTable(mockToggle.checked ? MOCK_TABLE : null)
    }, 300)
  })
})();

function iconSvg(name) {
  var LUCIDE = ${JSON.stringify(LUCIDE_ICONS)}
  var key = String(name || '').toLowerCase()
  var path = LUCIDE[key] || LUCIDE['info']
  return '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' + path + '</svg>'
}
`

// ============================================================
// STYLES
// ============================================================

const STYLES = `
:root {
  color-scheme: dark;
  --bg: #000000;
  --surface: #0a0a0a;
  --border: rgba(255,255,255,0.08);
  --text: #ffffff;
  --text-muted: rgba(255,255,255,0.40);
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  --tabbar-bg: #0A0A0A;
  --tabbar-border-color: rgba(255,255,255,0.08);
  --tabbar-border-width: 1px;
  --tabbar-radius: 28px;
  --tabbar-active: #FFFFFF;
  --tabbar-inactive: rgba(255,255,255,0.40);
  --tabbar-shadow:
    0 10px 30px -2px rgba(0,0,0,0.55),
    0 20px 60px 0 rgba(0,0,0,0.30);
}
* { margin: 0; padding: 0; box-sizing: border-box; }
*,
*::before,
*::after {
  -webkit-tap-highlight-color: transparent;
}
button, input, textarea, select {
  outline: none;
}
button:focus, button:focus-visible,
input:focus, input:focus-visible,
textarea:focus, textarea:focus-visible {
  outline: none;
  box-shadow: none;
}
html, body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.title {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.3px;
  color: #ffffff;
}
.app-id {
  font-size: 12px;
  color: var(--text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 5px 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 999px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 50%;
}
.stage {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 24px;
  min-height: 0;
  overflow: hidden;
}
.phone {
  position: relative;
  width: 100%; max-width: 340px;
  aspect-ratio: 9 / 19;
  max-height: 100%;
  border-radius: 44px;
  border: 8px solid #141414;
  background: #141414;   /* ← было #fff, теперь цвет рамки */
  box-shadow: 0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04);
  overflow: hidden;
}
.notch {
  position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
  width: 96px; height: 22px; background: #141414; border-radius: 999px;
  z-index: 3;
}
.phone-statusbar {
  position: absolute; top: 0; left: 0; right: 0; height: 44px; padding: 0 28px;
  display: flex; align-items: center; justify-content: space-between;
  z-index: 2; pointer-events: none; color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
  background: linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 100%);
}
.status-time { font-size: 13px; font-weight: 600; letter-spacing: 0.2px; margin-left: 6px; }
.status-icons { display: flex; align-items: center; gap: 6px; }
.status-icon { height: 11px; display: block; }
.status-battery { height: 12px; }

.phone__screen {
  position: absolute;
  inset: 0;
  border-radius: 40px;
  overflow: hidden;
  clip-path: inset(0 round 40px);
  contain: paint;
  background: #fff;
  z-index: 0;
  isolation: isolate;
  -webkit-mask-image: -webkit-radial-gradient(white, black);
  mask-image: radial-gradient(white, black);
}
.phone iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
  display: block;
}
.hint {
  font-size: 12px; color: var(--text-muted); text-align: center;
}
.hint code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 1px 6px; border-radius: 4px;
  background: rgba(255,255,255,0.06);
}

.devtools {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 14px;
}
.switch {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
}
.switch input { display: none; }
.switch__track {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 24px;
  border-radius: 12px;
  background: rgba(255,255,255,0.10);
  transition: background 0.18s ease;
}
.switch input:checked + .switch__track {
  background: #4ADE80;
}
.switch__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.18s ease;
}
.switch input:checked + .switch__track .switch__thumb {
  transform: translateX(16px);
}
.switch__label {
  font-size: 13px;
  color: rgba(255,255,255,0.75);
  font-weight: 500;
}
.devtools__btn {
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  color: rgba(255,255,255,0.85);
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 10px;
  padding: 6px 14px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.devtools__btn:hover {
  background: rgba(255,255,255,0.12);
}
.devtools__btn:focus, .devtools__btn:focus-visible {
  outline: none;
  box-shadow: none;
}
.devtools__btn--active {
  background: rgba(255, 255, 255, 0.14);
  border-color: rgba(255, 255, 255, 0.20);
  color: #ffffff;
}

.tabbar {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 10;
  pointer-events: auto;
  will-change: transform;
  transform: translateZ(0);
  backface-visibility: hidden;
}
.circle,
.circle-spacer {
  width: 56px;
  height: 56px;
  flex-shrink: 0;
}
.circle {
  background: var(--tabbar-bg);
  border: var(--tabbar-border-width) solid var(--tabbar-border-color);
  border-radius: 50%;
  color: var(--tabbar-inactive);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: filter 0.15s ease;
  box-shadow: var(--tabbar-shadow);
  will-change: transform;
  transform: translateZ(0);
}
.circle:hover { filter: brightness(1.15); }
.circle:focus, .circle:focus-visible {
  outline: none;
  box-shadow: var(--tabbar-shadow);
}
.circle svg {
  width: 22px;
  height: 22px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.pill {
  flex: 1;
  height: 56px;
  background: var(--tabbar-bg);
  border: var(--tabbar-border-width) solid var(--tabbar-border-color);
  border-radius: var(--tabbar-radius);
  display: flex;
  align-items: center;
  box-shadow: var(--tabbar-shadow);
  will-change: transform;
  transform: translateZ(0);
}
.tab {
  flex: 1;
  height: 100%;
  background: transparent;
  border: none;
  color: var(--tabbar-inactive);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  cursor: pointer;
  transition: color 0.22s ease;
}
.tab--active { color: var(--tabbar-active); }
.tab__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
}
.tab__icon svg {
  width: 20px;
  height: 20px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.tab__dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--tabbar-active);
  transform: scale(0);
  transition: transform 0.22s ease;
}
.tab--active .tab__dot {
  transform: scale(1);
}

/* ============================================================
   TOP CONTROLS — simulated manifest ui.fullscreen: true.
   Collapsed: 36×36 circle, chevron-down.
   Expanded: pill [settings | close | chevron-up].
   ============================================================ */

.top-controls {
  position: absolute;
  /* Below the iOS status bar (44px) + Flutter SafeArea padding (10px). */
  top: 54px;
  right: 12px;
  z-index: 4;
  display: none;
  font-family: var(--font);
}

body.is-fs-ui .top-controls {
  display: block;
}

/* Flat 25% black tint. No border, no gradient.
   backdrop-filter is intentionally absent: the WebView is a
   PlatformView, Flutter cannot sample its pixels — the blur would
   only see the black Scaffold underneath and look like nothing
   happened. Same reason MiniAppTopControls is a flat tint in
   Flutter. */
.top-controls__collapsed,
.top-controls__pill {
  height: 36px;
  background: rgba(0, 0, 0, 0.25);
  border: none;
  border-radius: 18px;
  box-shadow:
    0 8px 24px -4px rgba(0, 0, 0, 0.45),
    0 16px 48px 0 rgba(0, 0, 0, 0.25);
  transition: opacity 0.15s ease, transform 0.15s ease;
  color: #ffffff;
}

.top-controls__collapsed {
  width: 36px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.top-controls__collapsed:active {
  transform: scale(0.94);
}

.top-controls__pill {
  display: none;
  align-items: center;
}

body.is-fs-ui .top-controls.is-expanded .top-controls__collapsed {
  display: none;
}

body.is-fs-ui .top-controls.is-expanded .top-controls__pill {
  display: inline-flex;
  animation: top-controls-grow 0.24s cubic-bezier(0.33, 1, 0.68, 1);
}

@keyframes top-controls-grow {
  from {
    opacity: 0;
    transform: scale(0.94);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.top-controls__icon {
  width: 36px;
  height: 36px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: #ffffff;
  cursor: pointer;
  transition: color 0.15s ease;
}

.top-controls__icon:hover {
  color: #ffffff;
}

.top-controls__icon:active {
  transform: scale(0.94);
}

/* All SVGs inside top-controls — both the collapsed circle and the
   expanded pill. Shared rule so the chevron in the collapsed state
   inherits stroke, not the browser's default black fill. */
.top-controls svg {
  width: 16px;
  height: 16px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  display: block;
}

.top-controls__divider {
  display: inline-block;
  width: 1px;
  height: 16px;
  background: rgba(255, 255, 255, 0.1);
}

/* Fullscreen mode replaces the native header AND the tab bar with
   the floating top-controls. Driven by a body class — never by an
   inline style.display, which would override this rule and stick
   around after fullscreen is turned off. */
body.is-fs-ui .tabbar {
  display: none;
}

/* ============================================================
   LANDSCAPE
   ============================================================ */

body.is-landscape .phone {
  aspect-ratio: 19 / 9;
  max-width: min(760px, 100%);
  max-height: 100%;
}

body.is-landscape .notch {
  top: 50%;
  left: 12px;
  right: auto;
  transform: translateY(-50%);
  width: 22px;   /* было 96 — теперь вертикальная */
  height: 96px;  /* было 22 */
  border-radius: 999px;
}
  
body.is-landscape .phone-statusbar {
  padding: 0 28px 0 48px;
}


`

function escapeHtml(s: string): string {
	return s
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
}

/**
 * Wait until Vite is up.
 *
 * "Up" here means Vite has printed its `Local: http://...` banner —
 * that line means the server is listening and ready to accept
 * requests. We do NOT additionally probe with `fetch`: on some
 * Windows setups the probe resolves `localhost` to `::1` while
 * Vite binds to `127.0.0.1`, and every probe times out even though
 * the server is fine.
 *
 * Bails out early if the Vite process dies.
 */
async function waitForViteUrl(
	vite: ReturnType<typeof spawn>,
	getUrl: () => string | null,
	timeoutMs: number,
): Promise<boolean> {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		if (vite.exitCode !== null) return false
		if (getUrl()) return true
		await new Promise(r => setTimeout(r, 100))
	}
	return false
}

/**
 * Fallback browser opener for cases where the `open` package fails
 * silently on Windows — usually because it cannot resolve the
 * default browser through the registry.
 *
 * Uses `cmd /c start "" <url>` on Windows, `open` on macOS, and
 * `xdg-open` on Linux. Best-effort: any error is swallowed.
 */
function openWithSystemCommand(url: string): void {
	try {
		if (process.platform === 'win32') {
			spawn('cmd', ['/c', 'start', '', url], {
				detached: true,
				stdio: 'ignore',
			}).unref()
			return
		}
		if (process.platform === 'darwin') {
			spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
			return
		}
		spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
	} catch {
		logger.warn(`Open manually: ${url}`)
	}
}
