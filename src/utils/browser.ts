import {
	Browser,
	detectBrowserPlatform,
	install,
	resolveBuildId,
} from '@puppeteer/browsers'
import fsExtra from 'fs-extra'
import ora from 'ora'
import { homedir } from 'os'
import { join } from 'path'
import { colors } from './theme.js'

const { existsSync, ensureDirSync, readdirSync } = fsExtra

/**
 * Where we keep the browser. Shared across all mini apps.
 *
 * The first `socia shot` downloads Chromium here. Every later run
 * uses the cached copy.
 */
const BROWSER_CACHE_DIR = join(homedir(), '.socia', 'chromium')

/**
 * Chromium build channel. Stable is the safest choice — it has the
 * broadest CSS support and matches what real users have.
 */
const BUILD_CHANNEL = 'stable' as const

/**
 * Result of `ensureBrowser`.
 */
export interface BrowserInfo {
	/** Full path to the browser executable. */
	executablePath: string
	/** Version string, e.g. `120.0.6099.109`. */
	version: string
	/** Where the browser came from. */
	source: 'cache' | 'system' | 'downloaded'
}

/**
 * Common Chrome / Edge executable locations on Windows, macOS, and
 * Linux. Used as a fallback when the cached Chromium is missing and
 * the download fails.
 */
const SYSTEM_BROWSER_PATHS: Record<string, string[]> = {
	win32: [
		'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
		'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
		'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
		'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
	],
	darwin: [
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
	],
	linux: [
		'/usr/bin/google-chrome',
		'/usr/bin/google-chrome-stable',
		'/usr/bin/chromium',
		'/usr/bin/chromium-browser',
		'/usr/bin/microsoft-edge',
	],
}

/**
 * Ensure a Chromium is available.
 *
 * Resolution order:
 *   1. A cached build in `~/.socia/chromium/`.
 *   2. The `PUPPETEER_EXECUTABLE_PATH` environment variable.
 *   3. A system-installed Chrome or Edge.
 *   4. Download a fresh build into the cache directory.
 *
 * Returns a `BrowserInfo`. The `source` field tells the caller
 * where the browser came from.
 *
 * The download is a one-time cost — 100-200 MB depending on the
 * platform. Later calls return the cached executable.
 */
export async function ensureBrowser(): Promise<BrowserInfo> {
	// 1. Cached build.
	const cached = findCachedBrowser()
	if (cached) return { ...cached, source: 'cache' }

	// 2. Environment override.
	const envPath = process.env.PUPPETEER_EXECUTABLE_PATH
	if (envPath && existsSync(envPath)) {
		return {
			executablePath: envPath,
			version: 'system',
			source: 'system',
		}
	}

	// 3. System browser.
	const system = findSystemBrowser()
	if (system) return { ...system, source: 'system' }

	// 4. Download.
	return downloadBrowser()
}

/**
 * Look for an already-downloaded browser inside the cache dir.
 *
 * The cache layout is `<cacheDir>/chrome/<platform>-<buildId>/...`.
 */
function findCachedBrowser(): BrowserInfo | null {
	if (!existsSync(BROWSER_CACHE_DIR)) return null

	let entries: string[]
	try {
		entries = readdirSync(BROWSER_CACHE_DIR)
	} catch {
		return null
	}

	const chromeDir = entries.find(e => e === 'chrome')
	if (!chromeDir) return null

	const chromePath = join(BROWSER_CACHE_DIR, chromeDir)
	let platformEntries: string[]
	try {
		platformEntries = readdirSync(chromePath)
	} catch {
		return null
	}

	const build = platformEntries.find(e => /^(win|mac|linux)/.test(e))
	if (!build) return null

	const buildPath = join(chromePath, build)
	const execPath = findExecutableIn(buildPath)
	if (!execPath) return null

	return {
		executablePath: execPath,
		version: build,
		source: 'cache',
	}
}

/**
 * Walk a downloaded build directory and find the browser
 * executable.
 */
function findExecutableIn(dir: string): string | null {
	const isWindows = process.platform === 'win32'
	const candidates = isWindows
		? ['chrome.exe', 'chrome-headless-shell.exe']
		: ['chrome', 'chrome-headless-shell']

	try {
		const entries = readdirSync(dir)
		for (const entry of entries) {
			const sub = join(dir, entry)

			// Direct hit.
			for (const name of candidates) {
				const direct = join(sub, name)
				if (existsSync(direct)) return direct
			}

			// macOS app bundle — walk one more level.
			const macOSApp = join(
				sub,
				'Google Chrome for Testing.app',
				'Contents',
				'MacOS',
				'Google Chrome for Testing',
			)
			if (existsSync(macOSApp)) return macOSApp
		}
	} catch {
		// ignore
	}

	return null
}

/**
 * Find a system-installed Chrome or Edge. Returns `null` if none
 * are found.
 */
function findSystemBrowser(): BrowserInfo | null {
	const paths = SYSTEM_BROWSER_PATHS[process.platform] ?? []
	for (const path of paths) {
		if (existsSync(path)) {
			return {
				executablePath: path,
				version: 'system',
				source: 'system',
			}
		}
	}
	return null
}

/**
 * Download the latest stable Chrome into the cache directory.
 *
 * Shows a progress bar through the `ora` spinner. On failure, the
 * error message includes a hint about Windows Defender blocking
 * the extraction.
 */
async function downloadBrowser(): Promise<BrowserInfo> {
	const platform = detectBrowserPlatform()
	if (!platform) {
		throw new Error(
			`Unsupported platform: ${process.platform} ${process.arch}. ` +
				`Cannot download a browser. Set PUPPETEER_EXECUTABLE_PATH ` +
				`to a Chrome or Edge binary.`,
		)
	}

	ensureDirSync(BROWSER_CACHE_DIR)

	const spinner = ora({
		text: colors.muted('Preparing download…'),
		spinner: 'dots',
		stream: process.stdout,
	}).start()

	let lastPct = -1

	try {
		const buildId = await resolveBuildId(
			Browser.CHROME,
			platform,
			BUILD_CHANNEL,
		)

		const installed = await install({
			browser: Browser.CHROME,
			buildId,
			cacheDir: BROWSER_CACHE_DIR,
			platform,
			downloadProgressCallback: (downloaded, total) => {
				if (total > 0) {
					const pct = Math.floor((downloaded / total) * 100)
					// Only redraw when the percentage changes — otherwise
					// the terminal flickers.
					if (pct !== lastPct) {
						lastPct = pct
						const dlMb = (downloaded / 1024 / 1024).toFixed(1)
						const totalMb = (total / 1024 / 1024).toFixed(1)
						spinner.text = colors.muted(
							`Downloading Chromium… ${pct}%  (${dlMb} / ${totalMb} MB)`,
						)
					}
				} else {
					const dlMb = (downloaded / 1024 / 1024).toFixed(1)
					spinner.text = colors.muted(`Downloading Chromium… ${dlMb} MB`)
				}
			},
		})

		spinner.succeed(colors.success('Chromium downloaded'))

		return {
			executablePath: installed.executablePath,
			version: installed.buildId,
			source: 'downloaded',
		}
	} catch (e) {
		spinner.fail(colors.error('Failed to download Chromium'))

		const msg = e instanceof Error ? e.message : String(e)

		// Windows Defender often blocks extraction of the downloaded
		// .zip. Give the user a hint.
		if (process.platform === 'win32' && /Extraction failed|EPERM/i.test(msg)) {
			throw new Error(
				`Could not extract Chromium: ${msg}\n\n` +
					`On Windows this is usually Windows Defender blocking the ` +
					`extraction. Try one of:\n` +
					`  • Add "${BROWSER_CACHE_DIR}" to Defender's exclusions.\n` +
					`  • Temporarily disable real-time protection and rerun.\n` +
					`  • Install Chrome or Edge and set PUPPETEER_EXECUTABLE_PATH.\n`,
			)
		}

		throw new Error(
			`Could not download Chromium: ${msg}. ` +
				`Check your internet connection and try again.`,
		)
	}
}

/**
 * Path to the browser cache directory. Exposed so the `shot`
 * command can print it in the Done block.
 */
export function getBrowserCacheDir(): string {
	return BROWSER_CACHE_DIR
}
