import { createHash } from 'crypto'
import express, { type ErrorRequestHandler } from 'express'
import fsExtra from 'fs-extra'
import multer from 'multer'
import open from 'open'
import { tmpdir } from 'os'
import { join } from 'path'
import { logger } from '../utils/logger.js'
import { colors } from '../utils/theme.js'
import { refreshAccessToken } from '../utils/auth.js'
import {
	LOCAL_HOST,
	createLocalSecret,
	localRequestGuard,
	requireLocalSecret,
} from '../utils/local-http.js'
import { MAX_PACKAGE_BYTES } from '../utils/pack.js'
import type { PreflightResponse } from '../utils/preflight.js'
import { DevServerHandle, startDevServer } from './dev.js'

/** Max bytes per uploaded image (before the browser compresses it). */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

const {
	ensureDirSync,
	copySync,
	removeSync,
	existsSync,
	readFileSync,
	writeFileSync,
	statSync,
	readdirSync,
} = fsExtra

export interface DeployUIPayload {
	name: string
	description: string
	category: string
	channelUrl: string | null
	version: string
	changelog: string
	iconPath: string | null
	screenshotPaths: string[]
}

export interface DeployUIOptions {
	projectDir: string
	distDir: string
	sociaPath: string
	registryDir: string
	apiUrl?: string
	token?: string
	devUrl?: string

	/** Публичный идентификатор мини-аппа: `notes`, без `@`. */
	username: string

	version: string
	publisherPubkey: string
	preflight: PreflightResponse | null
	defaults: {
		name: string | null
		description: string | null
		category: string | null
		channelUrl: string | null
		icon: string | null
		screenshots: string[]
	}
}

export async function startDeployUI(
	options: DeployUIOptions,
): Promise<DeployUIPayload | null> {
	const tempDir = join(tmpdir(), `socia-deploy-${Date.now()}`)
	ensureDirSync(tempDir)

	const upload = multer({
		dest: tempDir,
		limits: {
			fileSize: MAX_IMAGE_BYTES,
			files: 6,
			fields: 20,
			fieldSize: 1024 * 1024,
		},
	})

	// ---- Start the dev server for the preview ----
	const originalCwd = process.cwd()
	let devHandle: DevServerHandle | null = null

	try {
		process.chdir(options.projectDir)
		devHandle = await startDevServer({ port: 0, noOpen: true })
		options.devUrl = devHandle.appUrl
	} catch (e) {
		logger.warn(
			`Could not start preview server: ${e instanceof Error ? e.message : e}`,
		)
	} finally {
		process.chdir(originalCwd)
	}

	const localSecret = createLocalSecret()
	let localPort = 0
	const app = express()
	app.use(localRequestGuard(() => localPort))
	app.use(express.json({ limit: '1mb' }))

	let published = false

	app.get('/', (req, res) => {
		res.set('Cache-Control', 'no-store')
		res.send(buildDeployHtml(options, localSecret))
	})

	app.post(
		'/api/publish',
		requireLocalSecret(localSecret),
		upload.fields([
			{ name: 'icon', maxCount: 1 },
			{ name: 'screenshots', maxCount: 5 },
		]),
		async (req, res) => {
			try {
				const files = req.files as {
					[field: string]: Express.Multer.File[]
				}

				const iconFile = files.icon?.[0]
				if (iconFile && iconFile.size > 5 * 1024 * 1024) {
					return res.status(413).json({
						error: 'Icon is too large after compression (max 5 MB).',
					})
				}

				const keepIcon = req.body.keep_icon !== 'false'
				let keepScreenshots: string[] | undefined
				if (typeof req.body.keep_screenshots === 'string') {
					try {
						const parsed = JSON.parse(req.body.keep_screenshots)
						if (Array.isArray(parsed)) {
							keepScreenshots = parsed.filter(
								(x: unknown): x is string => typeof x === 'string',
							)
						}
					} catch {
						// ignore
					}
				}

				if (options.apiUrl) {
					if (!options.token) {
						throw new Error('Not signed in. Run `socia login` first.')
					}
					options.token = await publishToBackend({
						apiUrl: options.apiUrl,
						token: options.token,
						username: options.username,
						version: options.version,
						name: req.body.name,
						description: req.body.description ?? null,
						category: req.body.category ?? 'utilities',
						channelUrl: req.body.channelUrl || null,
						changelog: req.body.changelog || null,
						publisherPubkey: options.publisherPubkey,
						sociaPath: options.sociaPath,
						iconPath: files.icon?.[0]?.path ?? null,
						screenshotPaths: (files.screenshots ?? []).map(f => f.path),
						keepIcon,
						keepScreenshots,
					})
				}

				// Mirror to local registry for offline debug.
				const appDir = join(options.registryDir, options.username)
				ensureDirSync(appDir)

				copySync(options.sociaPath, join(appDir, `${options.version}.socia`), {
					overwrite: true,
				})

				if (files.icon?.[0]) {
					copySync(files.icon[0].path, join(appDir, 'icon.png'))
				}

				if (files.screenshots && files.screenshots.length > 0) {
					const screenshotsDir = join(appDir, 'screenshots')
					removeSync(screenshotsDir)
					ensureDirSync(screenshotsDir)

					files.screenshots.forEach((f, i) => {
						copySync(f.path, join(screenshotsDir, `screenshot-${i + 1}.png`))
					})
				}

				writeFileSync(
					join(appDir, 'metadata.json'),
					JSON.stringify(
						{
							username: options.username,
							version: options.version,
							display: {
								name: req.body.name,
								description: req.body.description,
								icon: 'icon.png',
								screenshots: (files.screenshots ?? []).map(
									(_, i) => `screenshot-${i + 1}.png`,
								),
								category: req.body.category,
								channel_url: req.body.channelUrl || null,
							},
							changelog: req.body.changelog || null,
							publishedAt: new Date().toISOString(),
							size: statSync(options.sociaPath).size,
							fileName: `${options.version}.socia`,
							status: 'pending',
						},
						null,
						2,
					),
					'utf-8',
				)

				updateRegistryIndex(options.registryDir)

				res.json({ ok: true })
				published = true
			} catch (e) {
				res.status(500).json({
					error: e instanceof Error ? e.message : String(e),
				})
			}
		},
	)

	const handleUploadError: ErrorRequestHandler = (err, _req, res, _next) => {
		const code = (err as { code?: string }).code
		const isLimit = code?.startsWith('LIMIT_') === true
		const message =
			code === 'LIMIT_FILE_SIZE'
				? `Image is too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB).`
				: code === 'LIMIT_FILE_COUNT'
					? 'Too many files.'
					: code === 'LIMIT_FIELD_VALUE' || code === 'LIMIT_FIELD_COUNT'
						? 'Form data is too large.'
						: err instanceof Error
							? err.message
							: String(err)
		res.status(isLimit ? 413 : 500).json({ error: message })
	}
	app.use(handleUploadError)

	const PORT = 0 // let the OS pick a free port (3001 may be taken)
	return new Promise<DeployUIPayload | null>((resolve, reject) => {
		const shutdown = async (result: DeployUIPayload | null) => {
			if (devHandle) {
				try {
					await devHandle.stop()
				} catch {
					// ignore
				}
			}
			server.close()
			removeSync(tempDir)
			resolve(result)
		}

		const server = app.listen(PORT, LOCAL_HOST)

		server.once('error', async err => {
			if (devHandle) {
				try {
					await devHandle.stop()
				} catch {
					// ignore
				}
			}
			removeSync(tempDir)
			reject(new Error(`Could not start the deploy UI: ${err.message}`))
		})

		server.once('listening', async () => {
			const addr = server.address()
			const port = typeof addr === 'object' && addr ? addr.port : 0
			localPort = port
			const url = `http://${LOCAL_HOST}:${port}`
			console.log('')
			console.log(`  ${colors.dim('─'.repeat(30))}`)
			console.log('')
			if (devHandle) {
				console.log(
					`  ${colors.success('➜')}  ${colors.bold('Preview:')} ${colors.accent(`${devHandle.appUrl}/`)}`,
				)
			}
			console.log(
				`  ${colors.success('➜')}  ${colors.bold('Deploy UI:')} ${colors.accent(`${url}/`)}`,
			)
			try {
				await open(url)
			} catch {
				logger.warn(`Could not open the browser. Open manually: ${url}`)
			}
		})

		const checkTimer = setInterval(() => {
			if (published) {
				clearInterval(checkTimer)
				setTimeout(() => {
					void shutdown({
						name: 'published',
						description: '',
						category: '',
						channelUrl: null,
						version: '',
						changelog: '',
						iconPath: null,
						screenshotPaths: [],
					})
				}, 500)
			}
		}, 300)

		process.once('SIGINT', () => {
			clearInterval(checkTimer)
			void shutdown(null)
		})
	})
}

// ============================================================
// BACKEND UPLOAD
// ============================================================

async function publishToBackend(params: {
	apiUrl: string
	token: string
	username: string
	version: string
	name: string
	description: string | null
	category: string
	channelUrl: string | null
	changelog: string | null
	publisherPubkey: string
	sociaPath: string
	iconPath: string | null
	screenshotPaths: string[]
	keepIcon: boolean
	keepScreenshots: string[] | undefined
}): Promise<string> {
	const fs = await import('fs')
	const bytes = fs.readFileSync(params.sociaPath)

	if (bytes.length > MAX_PACKAGE_BYTES) {
		throw new Error(
			`Package is too large: ${(bytes.length / 1024 / 1024).toFixed(1)} MB ` +
				`(max ${MAX_PACKAGE_BYTES / 1024 / 1024} MB).`,
		)
	}

	const sha256 = createHash('sha256').update(bytes).digest('hex')

	const metadata: Record<string, unknown> = {
		username: params.username,
		version: params.version,
		name: params.name,
		description: params.description,
		category: params.category,
		channel_url: params.channelUrl,
		changelog: params.changelog,
		publisher_pubkey: params.publisherPubkey,
		keep_icon: params.keepIcon,
	}
	if (params.keepScreenshots !== undefined) {
		metadata.keep_screenshots = params.keepScreenshots
	}

	const buildForm = (): FormData => {
		const form = new FormData()

		form.append(
			'package',
			new Blob([new Uint8Array(bytes)], {
				type: 'application/octet-stream',
			}),
			`${params.version}.socia`,
		)
		form.append('metadata', JSON.stringify(metadata))
		form.append('sha256', sha256)

		if (params.iconPath) {
			const iconBytes = fs.readFileSync(params.iconPath)
			form.append(
				'icon',
				new Blob([new Uint8Array(iconBytes)], { type: 'image/png' }),
				'icon.png',
			)
		}

		params.screenshotPaths.forEach((path, i) => {
			const shotBytes = fs.readFileSync(path)
			form.append(
				'screenshot',
				new Blob([new Uint8Array(shotBytes)], { type: 'image/png' }),
				`screenshot-${i + 1}.png`,
			)
		})

		return form
	}

	const response = await (async (): Promise<Response> => {
		const send = (token: string): Promise<Response> =>
			fetch(`${params.apiUrl}/api/sphere/deploy`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
				},
				body: buildForm(),
				signal: AbortSignal.timeout(120_000),
			})

		let token = params.token
		let res = await send(token)

		if (res.status === 401) {
			const refreshed = await refreshAccessToken()
			if (refreshed) {
				token = refreshed
				res = await send(token)
			}
		}

		params.token = token
		return res
	})()

	if (!response.ok) {
		const data = (await response.json().catch(() => ({}))) as {
			error?: string
			code?: string
		}
		if (response.status === 401) {
			throw new Error('Session expired. Run `socia login` again.')
		}
		if (response.status === 403) {
			throw new Error('You do not have access to this app.')
		}
		if (
			response.status === 413 ||
			data.code === 'sphere_package_too_large'
		) {
			throw new Error('Package is too large. Limit: 50 MB.')
		}
		throw new Error(data.error ?? `Backend error: ${response.status}`)
	}

	console.log(`  ${colors.success('➜')}  ${colors.bold('Uploaded to backend')}`)
	return params.token
}

// ============================================================
// REGISTRY INDEX
// ============================================================

function updateRegistryIndex(registryDir: string): void {
	const apps: Array<Record<string, unknown>> = []
	const usernames = readdirSync(registryDir).filter((entry: string) => {
		const fullPath = join(registryDir, entry)
		return statSync(fullPath).isDirectory()
	})

	for (const username of usernames) {
		const metadataPath = join(registryDir, username, 'metadata.json')
		if (!existsSync(metadataPath)) continue

		try {
			const raw = readFileSync(metadataPath, 'utf-8')
			const meta = JSON.parse(raw)

			const appDir = join(registryDir, username)
			const sociaFiles = readdirSync(appDir).filter((f: string) =>
				f.endsWith('.socia'),
			)

			apps.push({
				username: meta.username ?? username,
				name: meta.display?.name ?? username,
				description: meta.display?.description ?? '',
				icon: meta.display?.icon ?? 'icon.png',
				screenshots: meta.display?.screenshots ?? [],
				category: meta.display?.category ?? 'utilities',
				channel_url: meta.display?.channel_url ?? null,
				version: meta.version,
				size: meta.size,
				publishedAt: meta.publishedAt,
				fileName: meta.fileName,
				status: meta.status,
				versions: sociaFiles.map((f: string) => f.replace('.socia', '')),
			})
		} catch {
			// Skip broken metadata.
		}
	}

	apps.sort((a, b) =>
		String(b.publishedAt).localeCompare(String(a.publishedAt)),
	)

	writeFileSync(
		join(registryDir, 'index.json'),
		JSON.stringify({ apps, updatedAt: new Date().toISOString() }, null, 2),
		'utf-8',
	)
}

// ============================================================
// HTML
// ============================================================

function buildDeployHtml(options: DeployUIOptions, localSecret: string): string {
	const defaults = options.defaults
	const remote = options.preflight

	const state = remote?.state ?? 'not_found'
	const remoteApp = remote?.app ?? null
	const pendingVersion = remote?.pending_version ?? null

	const initiallyFrozen = state === 'pending'

	const categories = [
		'utilities',
		'games',
		'social',
		'shopping',
		'finance',
		'productivity',
		'entertainment',
	]

	const selectedCategory =
		remoteApp?.category ?? defaults.category ?? 'utilities'

	const categoryOptions = categories
		.map(
			c =>
				`<option value="${c}" ${
					selectedCategory === c ? 'selected' : ''
				}>${c}</option>`,
		)
		.join('')

	const nameValue = remoteApp?.name ?? defaults.name ?? options.username
	const descriptionValue = remoteApp?.description ?? defaults.description ?? ''
	const channelUrlValue = remoteApp?.channel_url ?? defaults.channelUrl ?? ''

	const stateBlock = buildStateBlock(state, remoteApp, pendingVersion)
	const currentAssetsBlock = buildCurrentAssetsBlock(remoteApp)

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>Publish to Sphere — @${escapeHtml(options.username)}</title>
  <style>${STYLES}</style>
</head>
<body data-state="${state}">
  <div class="layout">
    <aside class="preview-pane">
      <iframe
        src="${options.devUrl ?? ''}"
        title="Mini app preview"
        class="preview-iframe"
      ></iframe>
    </aside>

    <main class="form-pane">
      <header class="form-header">
        <div>
          <h1>Publish to Sphere</h1>
          <p class="form-subtitle">@${escapeHtml(options.username)} <span class="dot-sep">·</span> v${escapeHtml(options.version)}</p>
        </div>
      </header>

      ${stateBlock}

      <form id="form" class="form" data-state="${state}">
        <fieldset id="form-fields" ${initiallyFrozen ? 'disabled' : ''}>
          <div class="field">
            <label class="label" for="name">App name</label>
            <input
              type="text"
              id="name"
              name="name"
              required
              autocomplete="off"
              spellcheck="false"
              value="${escapeHtml(nameValue)}"
              placeholder="My app"
            />
          </div>

          <div class="field">
            <label class="label" for="description">Description</label>
            <textarea
              id="description"
              name="description"
              required
              rows="3"
              placeholder="Short description for the catalog card."
            >${escapeHtml(descriptionValue)}</textarea>
          </div>

          <div class="field-row">
            <div class="field">
              <label class="label" for="category">Category</label>
              <select id="category" name="category">
                ${categoryOptions}
              </select>
            </div>
            <div class="field">
              <label class="label" for="version">Version</label>
              <input
                type="text"
                id="version"
                name="version"
                required
                autocomplete="off"
                spellcheck="false"
                value="${escapeHtml(options.version)}"
                readonly
              />
              <p class="hint" id="version-hint">
                Version is taken from <code>manifest.json</code>. Bump it and re-run to publish a new version.
              </p>
            </div>
          </div>

          <div class="field">
            <label class="label" for="channelUrl">Channel URL</label>
            <input
              type="url"
              id="channelUrl"
              name="channelUrl"
              autocomplete="off"
              spellcheck="false"
              placeholder="https://t.me/yourchannel"
              value="${escapeHtml(channelUrlValue)}"
            />
            <p class="hint">Optional. Shown as a button on the app page.</p>
          </div>

          <div class="field">
            <label class="label" for="changelog">Changelog</label>
            <textarea
              id="changelog"
              name="changelog"
              rows="3"
              placeholder="What changed in this version."
            >${pendingVersion?.changelog ? escapeHtml(pendingVersion.changelog) : ''}</textarea>
          </div>

          ${currentAssetsBlock}

          <div class="field-row upload-row">
            <div class="field">
              <label class="label">${
								remoteApp?.icon_url ? 'Replace icon' : 'Icon'
							}</label>
              <label class="upload-box" id="icon-box" for="icon-input">
                <input type="file" id="icon-input" name="icon" accept="image/*" />
                <div class="upload-inner">
                  <div class="upload-icon">${SVG.icon}</div>
                  <div class="upload-text">
                    <span class="upload-title">Drop or click</span>
                    <span class="upload-sub">Auto-compressed to PNG</span>
                  </div>
                  <div class="upload-file" id="icon-name"></div>
                </div>
              </label>
            </div>
            <div class="field">
              <label class="label">${
								remoteApp?.screenshots?.length
									? 'Add screenshots'
									: 'Screenshots'
							}</label>
              <label class="upload-box" id="screenshots-box" for="screenshots-input">
                <input type="file" id="screenshots-input" name="screenshots" accept="image/*" multiple />
                <div class="upload-inner">
                  <div class="upload-icon">${SVG.screenshots}</div>
                  <div class="upload-text">
                    <span class="upload-title">Drop or click</span>
                    <span class="upload-sub">Auto-compressed, up to 5</span>
                  </div>
                  <div class="upload-file" id="screenshots-name"></div>
                </div>
              </label>
            </div>
          </div>

          <div class="preview-strip" id="screenshots-preview"></div>
        </fieldset>

        <div class="actions" id="actions-primary">
          <button type="submit" id="publish-btn" class="btn-primary">
            <span class="btn-label">${
							state === 'pending' ? 'Submit again' : 'Publish'
						}</span>
            <span class="btn-spinner" aria-hidden="true"></span>
          </button>
        </div>

        <div class="actions" id="actions-frozen" ${
					initiallyFrozen ? '' : 'hidden'
				}>
          <button type="button" id="reissue-btn" class="btn-secondary">
            Reissue
          </button>
        </div>

        <div class="status" id="status" role="status" aria-live="polite"></div>
      </form>
    </main>
  </div>

  <script>${SCRIPTS.replace('__SOCIA_LOCAL_SECRET__', localSecret)}</script>
</body>
</html>`
}

// ============================================================
// STATE BLOCK
// ============================================================

function buildStateBlock(
	state: string,
	app: { name: string; updated_at: string } | null,
	pendingVersion: { version: string; uploaded_at: string } | null,
): string {
	if (state === 'not_found' || !app) {
		return ''
	}

	if (state === 'pending' && pendingVersion) {
		const when = new Date(pendingVersion.uploaded_at).toLocaleString('en-US')
		return `
			<div class="state-block state-block--warning">
				<div class="state-title">Awaiting moderation</div>
				<div class="state-subtitle">
					Version <strong>${escapeHtml(pendingVersion.version)}</strong> has been waiting for review since ${escapeHtml(when)}.
					Form is frozen. Click "Reissue" to update metadata and package before approval.
				</div>
			</div>
		`
	}

	if (state === 'published') {
		return `
			<div class="state-block state-block--success">
				<div class="state-title">App update</div>
				<div class="state-subtitle">
					Fields are pre-filled from the catalog. Publish will create a new version.
					Don't forget to bump <code>version</code> in manifest.json.
				</div>
			</div>
		`
	}

	if (state === 'rejected') {
		return `
			<div class="state-block state-block--danger">
				<div class="state-title">Previous version was rejected</div>
				<div class="state-subtitle">
					Fix the issues and submit again. Fields are pre-filled from the catalog.
				</div>
			</div>
		`
	}

	if (state === 'suspended') {
		return `
			<div class="state-block state-block--warning">
				<div class="state-title">App is suspended</div>
				<div class="state-subtitle">
					Publish will create a new version that goes through moderation again.
				</div>
			</div>
		`
	}

	return ''
}

// ============================================================
// CURRENT ASSETS
// ============================================================

function buildCurrentAssetsBlock(
	app: { icon_url: string | null; screenshots: string[] } | null,
): string {
	if (!app) return ''
	const hasIcon = !!app.icon_url
	const hasShots = (app.screenshots ?? []).length > 0
	if (!hasIcon && !hasShots) return ''

	const iconHtml = hasIcon
		? `
			<div class="asset-item" data-asset-url="${escapeHtml(app.icon_url!)}" data-asset-kind="icon">
				<img src="${escapeHtml(app.icon_url!)}" alt="icon" class="asset-thumb asset-thumb--icon" />
				<button type="button" class="asset-remove" aria-label="Remove">✕</button>
			</div>
		`
		: '<span class="asset-empty">none</span>'

	const shotsHtml = hasShots
		? app.screenshots
				.map(
					s => `
					<div class="asset-item" data-asset-url="${escapeHtml(s)}" data-asset-kind="screenshot">
						<img src="${escapeHtml(s)}" alt="screenshot" class="asset-thumb asset-thumb--shot" />
						<button type="button" class="asset-remove" aria-label="Remove">✕</button>
					</div>
				`,
				)
				.join('')
		: '<span class="asset-empty">none</span>'

	return `
		<div class="current-assets">
			<div class="current-assets__title">Currently in catalog</div>
			<div class="current-assets__row">
				<span class="current-assets__label">Icon</span>
				<div class="current-assets__thumbs">${iconHtml}</div>
			</div>
			<div class="current-assets__row">
				<span class="current-assets__label">Screenshots</span>
				<div class="current-assets__thumbs">${shotsHtml}</div>
			</div>
			<p class="current-assets__hint">
				Click ✕ to mark for removal. New uploads are added to
				the remaining ones — they do not replace them.
			</p>
		</div>
	`
}

// ============================================================
// SVG ICONS
// ============================================================

const SVG = {
	icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>`,

	screenshots: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="18" rx="2"/><rect x="14" y="3" width="7" height="18" rx="2"/></svg>`,
}

// ============================================================
// STYLES (без изменений — они от app_id/app username не зависят)
// ============================================================

const STYLES = `
:root {
  color-scheme: dark;
  --bg: #000000;
  --surface: #0a0a0a;
  --surface-2: #111111;
  --surface-3: #161616;
  --border: rgba(255,255,255,0.08);
  --border-strong: rgba(255,255,255,0.14);
  --border-focus: rgba(255,255,255,0.35);
  --text: #ffffff;
  --text-soft: rgba(255,255,255,0.65);
  --text-muted: rgba(255,255,255,0.40);
  --text-dim: rgba(255,255,255,0.28);
  --success: #4ADE80;
  --danger: #FF3B30;
  --warning: #FF9F0A;
  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 20px;
  --radius-pill: 999px;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --transition: 0.15s ease;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}
.layout { display: grid; grid-template-columns: minmax(360px, 42%) 1fr; min-height: 100vh; }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }

.preview-pane {
  background: var(--bg);
  border-right: 1px solid var(--border);
  display: flex;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow: hidden;
}
@media (max-width: 900px) {
  .preview-pane {
    position: static;
    height: auto;
    border-right: none;
    border-bottom: 1px solid var(--border);
    aspect-ratio: 9 / 19;
    max-height: 80vh;
  }
}
.preview-iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: #000;
  display: block;
}

.form-pane { background: var(--bg); padding: 40px; overflow-y: auto; }
@media (max-width: 900px) { .form-pane { padding: 24px 20px 60px; } }
.form-header { margin-bottom: 24px; }
.form-header h1 { font-size: 26px; font-weight: 700; letter-spacing: -0.5px; }
.form-subtitle { margin-top: 6px; font-size: 13px; color: var(--text-muted); font-family: var(--mono); }
.dot-sep { margin: 0 4px; color: var(--text-dim); }
.form { display: flex; flex-direction: column; gap: 20px; max-width: 720px; }
.form fieldset { border: none; display: flex; flex-direction: column; gap: 20px; }
.form fieldset:disabled { opacity: 0.5; pointer-events: none; }
.field { display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 0; }
.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 600px) { .field-row { grid-template-columns: 1fr; } }
.upload-row { grid-template-columns: 1fr 1fr; gap: 16px; }
.label { font-size: 12px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; color: var(--text-muted); }
.hint { font-size: 12px; color: var(--text-dim); line-height: 1.5; }
input[type="text"], input[type="url"], textarea, select {
  width: 100%; padding: 14px 16px; font-family: inherit; font-size: 14px;
  color: var(--text); background: var(--surface-2);
  border: 1px solid var(--border); border-radius: var(--radius-md);
  outline: none; transition: border-color var(--transition), background var(--transition);
  -webkit-appearance: none; appearance: none;
}
input::placeholder, textarea::placeholder { color: var(--text-dim); }
input:hover, textarea:hover, select:hover { border-color: var(--border-strong); }
input:focus, textarea:focus, select:focus { border-color: var(--border-focus); background: var(--surface-3); }
textarea { resize: vertical; min-height: 84px; line-height: 1.5; }
select {
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.5)' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>");
  background-repeat: no-repeat; background-position: right 16px center;
  padding-right: 40px; cursor: pointer;
}
select option { background: var(--surface-2); color: var(--text); }

.current-assets {
  padding: 14px 18px;
  border-radius: 16px;
  background: var(--surface);
  border: 1px solid var(--border);
}
.current-assets__title {
  font-size: 12px; font-weight: 600; letter-spacing: 0.5px;
  text-transform: uppercase; color: var(--text-muted); margin-bottom: 12px;
}
.current-assets__row { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 10px; }
.current-assets__label { font-size: 12px; color: var(--text-muted); min-width: 90px; padding-top: 6px; }
.current-assets__thumbs { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.asset-item { position: relative; }
.asset-thumb {
  display: block; object-fit: cover;
  border: 1px solid var(--border); background: var(--surface-2);
  border-radius: 10px;
}
.asset-thumb--icon { width: 40px; height: 40px; }
.asset-thumb--shot { width: 28px; height: 48px; border-radius: 6px; }
.asset-item.is-marked .asset-thumb {
  opacity: 0.25;
  filter: grayscale(1);
}
.asset-item.is-marked::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(to bottom right, transparent calc(50% - 1px), var(--danger) calc(50% - 1px), var(--danger) calc(50% + 1px), transparent calc(50% + 1px));
  pointer-events: none; border-radius: inherit;
}
.asset-remove {
  position: absolute; top: -6px; right: -6px;
  width: 18px; height: 18px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%; border: none;
  background: rgba(255,59,48,0.9); color: #fff;
  font-size: 10px; font-weight: 700; line-height: 1;
  cursor: pointer;
  transition: transform 0.1s ease, background var(--transition);
}
.asset-remove:hover { background: var(--danger); transform: scale(1.08); }
.asset-item.is-marked .asset-remove { background: rgba(255,255,255,0.2); }
.asset-empty { font-size: 12px; color: var(--text-dim); }
.current-assets__hint {
  font-size: 12px; color: var(--text-muted); line-height: 1.5; margin-top: 8px;
}

.upload-box {
  position: relative; display: flex; align-items: center; justify-content: center;
  min-height: 96px; padding: 20px;
  border: 1.5px dashed var(--border-strong); border-radius: var(--radius-md);
  background: var(--surface-2); cursor: pointer;
  transition: border-color var(--transition), background var(--transition);
  text-align: center;
}
.upload-box:hover { border-color: var(--border-focus); background: var(--surface-3); }
.upload-box.has-file { border-style: solid; border-color: rgba(74,222,128,0.4); background: rgba(74,222,128,0.05); }
.upload-box input[type="file"] { display: none; }
.upload-inner { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.upload-icon { color: var(--text-muted); display: flex; align-items: center; justify-content: center; }
.upload-box.has-file .upload-icon { color: var(--success); }
.upload-text { display: flex; flex-direction: column; gap: 2px; }
.upload-title { font-size: 13px; font-weight: 500; color: var(--text); }
.upload-sub { font-size: 11px; color: var(--text-muted); }
.upload-file { font-size: 11px; color: var(--success); font-family: var(--mono); word-break: break-all; max-width: 100%; }
.preview-strip { display: flex; gap: 8px; flex-wrap: wrap; padding: 4px 0; }
.preview-strip:empty { display: none; }
.preview-strip img { width: 56px; height: 96px; object-fit: cover; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--surface-2); }

.actions { display: flex; gap: 12px; margin-top: 8px; }
.actions[hidden] { display: none; }
.btn-primary, .btn-secondary {
  flex: 1; position: relative; height: 52px; padding: 0 24px;
  font-family: inherit; font-size: 15px; font-weight: 600;
  border: none; border-radius: var(--radius-pill); cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 10px;
  transition: opacity var(--transition), transform 0.08s ease;
}
.btn-primary { color: #000; background: #fff; box-shadow: 0 0 40px rgba(255,255,255,0.12); }
.btn-primary:hover:not(:disabled) { opacity: 0.92; }
.btn-primary:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: none; }
.btn-secondary { color: #fff; background: transparent; border: 1px solid var(--border-strong); }
.btn-secondary:hover { background: rgba(255,255,255,0.05); border-color: var(--border-focus); }
.btn-spinner {
  display: none; width: 16px; height: 16px;
  border-radius: 50%; border: 2px solid rgba(0,0,0,0.2);
  border-top-color: #000; animation: spin 0.7s linear infinite;
}
.btn-primary.loading .btn-spinner { display: inline-block; }
@keyframes spin { to { transform: rotate(360deg); } }
.status {
  display: none; padding: 14px 16px; border-radius: var(--radius-md);
  font-size: 13px; line-height: 1.5; font-weight: 500;
}
.status.show { display: block; }
.status.success { background: rgba(74,222,128,0.08); border: 1px solid rgba(74,222,128,0.25); color: var(--success); }
.status.error { background: rgba(255,59,48,0.08); border: 1px solid rgba(255,59,48,0.25); color: var(--danger); }
.state-block {
  padding: 14px 18px; border-radius: var(--radius-md);
  border-left: 3px solid; margin-bottom: 20px; max-width: 720px;
}
.state-block--info { background: rgba(74,158,255,0.06); border-left-color: #4A9EFF; }
.state-block--success { background: rgba(74,222,128,0.06); border-left-color: var(--success); }
.state-block--warning { background: rgba(255,159,10,0.06); border-left-color: var(--warning); }
.state-block--danger { background: rgba(255,59,48,0.06); border-left-color: var(--danger); }
.state-title { font-size: 14px; font-weight: 600; color: var(--text); margin-bottom: 4px; }
.state-subtitle { font-size: 13px; color: var(--text-soft); line-height: 1.5; }
.state-subtitle strong { color: var(--text); }
.state-subtitle code { font-family: var(--mono); background: rgba(255,255,255,0.06); padding: 1px 6px; border-radius: 4px; font-size: 12px; }
`

// ============================================================
// SCRIPTS
// ============================================================

const SCRIPTS = `
(function () {
  const LOCAL_SECRET = '__SOCIA_LOCAL_SECRET__';
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
  const form = document.getElementById('form');
  const fields = document.getElementById('form-fields');
  const publishBtn = document.getElementById('publish-btn');
  const reissueBtn = document.getElementById('reissue-btn');
  const actionsPrimary = document.getElementById('actions-primary');
  const actionsFrozen = document.getElementById('actions-frozen');
  const status = document.getElementById('status');
  const iconInput = document.getElementById('icon-input');
  const iconBox = document.getElementById('icon-box');
  const iconName = document.getElementById('icon-name');
  const screenshotsInput = document.getElementById('screenshots-input');
  const screenshotsBox = document.getElementById('screenshots-box');
  const screenshotsName = document.getElementById('screenshots-name');
  const screenshotsPreview = document.getElementById('screenshots-preview');
  const versionInput = document.getElementById('version');
  const currentAssets = document.querySelector('.current-assets');

  let frozen = form.dataset.state === 'pending';

  iconInput.addEventListener('change', () => {
    const file = iconInput.files[0];
    if (file) {
      iconBox.classList.add('has-file');
      iconName.textContent = file.name + ' (' + (file.size / 1024).toFixed(0) + ' KB)';
    } else {
      iconBox.classList.remove('has-file');
      iconName.textContent = '';
    }
  });

  screenshotsInput.addEventListener('change', () => {
    const files = screenshotsInput.files;
    screenshotsPreview.innerHTML = '';
    if (files.length > 0) {
      screenshotsBox.classList.add('has-file');
      screenshotsName.textContent = files.length + ' file' + (files.length > 1 ? 's' : '');
      for (let i = 0; i < files.length; i++) {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(files[i]);
        screenshotsPreview.appendChild(img);
      }
    } else {
      screenshotsBox.classList.remove('has-file');
      screenshotsName.textContent = '';
    }
  });

  reissueBtn?.addEventListener('click', () => {
    frozen = false;
    fields.disabled = false;
    actionsPrimary.hidden = false;
    actionsFrozen.hidden = true;
    versionInput.setAttribute('readonly', '');
    status.className = 'status';
    status.textContent = '';
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.asset-remove');
    if (!btn) return;
    const item = btn.closest('.asset-item');
    if (!item) return;
    item.classList.toggle('is-marked');
  });

  function collectKeepState() {
    if (!currentAssets) {
         return { keepIcon: true, keepScreenshots: undefined };
    }
    const items = currentAssets.querySelectorAll('.asset-item');
    let keepIcon = true;
    const keepScreenshots = [];
    items.forEach((el) => {
      const kind = el.dataset.assetKind;
      const url = el.dataset.assetUrl;
      const marked = el.classList.contains('is-marked');
      if (kind === 'icon') {
        keepIcon = !marked;
      } else if (kind === 'screenshot' && !marked) {
        keepScreenshots.push(url);
      }
    });
    return { keepIcon, keepScreenshots };
  }

  async function compressToPng(file, maxDim) {
    if (!file.type.startsWith('image/')) {
      throw new Error('Only image files are supported.');
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error('Image is too large (max 10 MB).');
    }
    const bitmap = await createImageBitmap(file);
    let { width, height } = bitmap;
    if (width * height > 40_000_000) {
      bitmap.close();
      throw new Error('Image dimensions are too large (max 40 megapixels).');
    }
    if (width > maxDim || height > maxDim) {
      const scale = maxDim / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const name = file.name.replace(/\\.[^.]+$/, '') + '.png';
    return new File([blob], name, { type: 'image/png' });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (frozen) return;

    publishBtn.disabled = true;
    publishBtn.classList.add('loading');

    status.className = 'status';
    status.textContent = 'Compressing images...';

    const formData = new FormData(form);

    try {
      const { keepIcon, keepScreenshots } = collectKeepState();
      formData.append('keep_icon', keepIcon ? 'true' : 'false');
      if (keepScreenshots !== undefined) {
        formData.append('keep_screenshots', JSON.stringify(keepScreenshots));
      }

      const iconFile = iconInput.files[0];
      if (iconFile) {
        const compressed = await compressToPng(iconFile, 512);
        if (compressed.size > 5 * 1024 * 1024) {
          throw new Error('Icon is too large after compression (max 5 MB).');
        }
        formData.delete('icon');
        formData.append('icon', compressed, 'icon.png');
      }

      const screenshotFiles = Array.from(screenshotsInput.files);
      if (screenshotFiles.length > 0) {
        formData.delete('screenshots');
        for (const file of screenshotFiles) {
          const compressed = await compressToPng(file, 1080);
          formData.append('screenshots', compressed, compressed.name);
        }
      }

      status.textContent = 'Uploading...';

      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'X-Socia-Local': LOCAL_SECRET },
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Publish failed');

      status.className = 'status success show';
      status.textContent = 'Submitted for moderation. Please wait.';
      publishBtn.classList.remove('loading');
      publishBtn.querySelector('.btn-label').textContent = 'Pending review';
    } catch (err) {
      status.className = 'status error show';
      status.textContent = err.message;
      publishBtn.disabled = false;
      publishBtn.classList.remove('loading');
    }
  });
})();
`

// ============================================================
// UTILS
// ============================================================

function escapeHtml(s: string): string {
	return s
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
}
