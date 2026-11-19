import fsExtra from 'fs-extra'
import inquirer from 'inquirer'
import ora from 'ora'
import { join, resolve } from 'path'
import type { Browser } from 'puppeteer-core'
import { loadManifest } from '../utils/manifest.js'
import {
	DEFAULT_PHONE_FRAME,
	DEVICES,
	launchBrowser,
	type DeviceProfile,
} from '../utils/screenshot.js'
import {
	blank,
	colors,
	printBannerCustom,
	printDoneBlock,
	printError,
	printInfo,
	printStep,
	printSuccess,
	printWarning,
} from '../utils/theme.js'
import { startDevServer, type DevServerHandle } from './dev.js'

const { ensureDirSync, writeFileSync } = fsExtra

/**
 * `socia shot` — capture screenshots of a mini app inside a phone
 * frame.
 *
 * Uses `socia dev` under the hood: starts Vite + the preview UI,
 * opens it in Puppeteer, clicks through the tabs, and screenshots
 * the `.phone` frame. The result is what the mini app actually
 * looks like in Socia — notch, status bar, tab bar and all.
 */
export async function shotCommand(): Promise<void> {
	printBannerCustom({
		title: 'Socia Shot',
		tagline: 'Capture your mini app inside a phone frame',
	})

	const projectDir = process.cwd()
	let manifest: ReturnType<typeof loadManifest> | null = null

	try {
		manifest = loadManifest(projectDir)
	} catch {
		manifest = null
	}

	if (!manifest) {
		printError(
			'No manifest.json found',
			'socia shot needs to run inside a mini app folder.',
		)
		process.exit(1)
	}

	printInfo(`Project: @${manifest.username}`)
	blank()

	// ---- 1. Prompts ----

	const tabs = manifest.ui?.tabbar?.tabs ?? []
	const answers = await runPrompts(tabs)

	const outputDir = resolve(projectDir, answers.output)
	ensureDirSync(outputDir)

	const device = DEVICES[answers.device]
	if (!device) {
		throw new Error(`Unknown device: ${answers.device}`)
	}

	// ---- 2. Start dev server ----

	blank()
	printStep(1, 4, 'Starting dev server')

	const devSpinner = ora('Starting Vite and preview UI...').start()

	let dev: DevServerHandle
	try {
		dev = await startDevServer({ port: 3003, noOpen: true })
		devSpinner.succeed(`Dev UI ready at ${dev.url}`)
	} catch (e) {
		devSpinner.fail('Failed to start dev server')
		printError(
			'Could not start the local dev server',
			e instanceof Error ? e.message : String(e),
		)
		process.exit(1)
	}

	// ---- 3. Launch browser ----

	blank()
	printStep(2, 4, 'Preparing browser')

	let browser: Browser
	try {
		browser = await launchBrowser()
		printSuccess('Browser ready')
	} catch (e) {
		printError(
			'Could not start a browser',
			e instanceof Error ? e.message : String(e),
		)
		await dev.stop()
		process.exit(1)
	}

	// ---- 4. Capture each page ----

	blank()
	printStep(3, 4, `Capturing ${answers.pages.length} page(s)`)
	blank()

	const results: Array<{
		label: string
		file: string
		size: number
		ok: boolean
	}> = []

	try {
		for (let i = 0; i < answers.pages.length; i++) {
			const tabId = answers.pages[i]
			const label = `[${i + 1}/${answers.pages.length}] /${tabId}`

			const spinner = ora(label).start()

			try {
				const png = await capturePage(browser, dev.url, tabId, {
					device,
					settleMs: answers.settle,
				})

				const fileName = buildFileName(i, tabId)
				const filePath = join(outputDir, fileName)
				writeFileSync(filePath, png)

				results.push({
					label,
					file: fileName,
					size: png.length,
					ok: true,
				})

				spinner.succeed(
					`${colors.accent(fileName)}  ${colors.dim(
						`(${(png.length / 1024).toFixed(0)} KB)`,
					)}`,
				)
			} catch (e) {
				results.push({ label, file: '', size: 0, ok: false })
				spinner.fail(
					`${colors.error('failed')}  ${colors.dim(
						e instanceof Error ? e.message : String(e),
					)}`,
				)
			}
		}
	} finally {
		await browser.close()
		await dev.stop()
	}

	// ---- 5. Done block ----

	const ok = results.filter(r => r.ok).length
	const failed = results.length - ok

	blank()
	printStep(4, 4, 'Done')

	if (failed > 0) {
		printWarning(`${failed} of ${results.length} screenshot(s) failed`)
	}

	blank()

	const scale =
		device.scale === Math.floor(device.scale)
			? String(device.scale)
			: device.scale.toFixed(2)

	printDoneBlock({
		headline: 'Done.',
		subtitle:
			failed === 0
				? `${ok} screenshot(s) saved.`
				: `${ok} of ${results.length} screenshot(s) saved.`,
		rows: [
			{ label: 'Location', value: outputDir },
			{
				label: 'Device',
				value: `${device.name} (${device.width}×${device.height} @${scale}x)`,
			},
			{ label: 'Frame', value: 'phone, notch, iOS status bar, tab bar' },
			{ label: 'Scheme', value: answers.colorScheme },
		],
		sections: [
			{
				title: 'Files',
				lines: results.map(r =>
					r.ok
						? `  ${r.file}   ${(r.size / 1024).toFixed(0)} KB`
						: `  ${colors.error('✗')}  ${r.label}`,
				),
			},
		],
	})

	blank()
}

// ============================================================
// CAPTURE
// ============================================================

/**
 * Open the dev UI, switch to `tabId`, and screenshot the phone
 * frame.
 *
 * The dev UI at `devUrl` renders an iPhone frame with the mini app
 * inside an iframe pointing at Vite (`localhost:5173`). Puppeteer
 * screenshots the `.phone` element — so the result includes the
 * notch, the iOS status bar, and the native tab bar.
 *
 * The iframe is cross-origin (3003 → 5173), so we cannot inspect
 * it. Instead we wait a fixed time for Vite to compile and for
 * the mini app to render before each capture.
 */
async function capturePage(
	browser: Browser,
	devUrl: string,
	tabId: string,
	options: {
		device: DeviceProfile
		settleMs: number
	},
): Promise<Uint8Array> {
	const page = await browser.newPage()

	try {
		// The dev UI is a fixed-size layout; give it enough room.
		await page.setViewport({
			width: 1400,
			height: 1800,
			deviceScaleFactor: 2,
		})

		await page.goto(devUrl, {
			waitUntil: 'networkidle2',
			timeout: 30_000,
		})

		// Wait for the tab bar to render.
		await page.waitForSelector('.tabbar', { timeout: 5000 })

		// Give Vite time to compile and serve the first request.
		// We cannot poll the iframe (cross-origin), so a fixed pause
		// is the only reliable option. 2.5 seconds is enough for a
		// cold start on a typical dev machine.
		await new Promise(r => setTimeout(r, 2500))

		// Switch to the requested tab by clicking it.
		await page.evaluate((id: string) => {
			const tab = document.querySelector(
				`.tab[data-tab-id="${id}"]`,
			) as HTMLElement | null
			if (tab) tab.click()
		}, tabId)

		// Let the iframe route and paint.
		await new Promise(r => setTimeout(r, options.settleMs))

		// Screenshot the whole phone frame.
		const element = await page.$('.phone')
		if (!element) {
			throw new Error('.phone element not found in dev UI')
		}

		const shot = await element.screenshot({
			type: 'png',
			omitBackground: true,
		})

		return new Uint8Array(shot)
	} finally {
		await page.close()
	}
}

// ============================================================
// PROMPTS
// ============================================================

interface PromptsResult {
	pages: string[]
	output: string
	device: string
	colorScheme: 'dark' | 'light' | 'no-preference'
	background: string
	settle: number
	framed: boolean
}

async function runPrompts(tabs: Array<{ id: string }>): Promise<PromptsResult> {
	if (tabs.length === 0) {
		throw new Error('No tabs in manifest.json — nothing to capture.')
	}

	const deviceChoices = Object.entries(DEVICES).map(([key, d]) => ({
		name: `${d.name}  ${deviceScaleLabel(d)}`,
		value: key,
	}))

	const pageAnswers = await inquirer.prompt([
		{
			type: 'checkbox',
			name: 'pages',
			message: 'Which tabs to capture?',
			choices: tabs.map(t => ({
				name: `/${t.id}`,
				value: t.id,
				checked: true,
			})),
		},
	])

	const selectedTabs: string[] =
		pageAnswers.pages && pageAnswers.pages.length > 0
			? pageAnswers.pages
			: tabs.map(t => t.id)

	const answers = await inquirer.prompt([
		{
			type: 'input',
			name: 'output',
			message: 'Output directory',
			default: 'screenshots',
		},
		{
			type: 'list',
			name: 'device',
			message: 'Device',
			choices: deviceChoices,
			default: 'iphone-15-pro',
		},
		{
			type: 'list',
			name: 'colorScheme',
			message: 'Preferred colour scheme',
			choices: [
				{ name: 'Dark', value: 'dark' },
				{ name: 'Light', value: 'light' },
				{ name: 'No preference (site default)', value: 'no-preference' },
			],
			default: 'dark',
		},
		{
			type: 'input',
			name: 'background',
			message: 'Phone frame background colour',
			default: DEFAULT_PHONE_FRAME.background,
			validate: (input: string) =>
				/^#[0-9a-fA-F]{3,8}$/.test(input.trim()) ||
				'Use a hex colour like #000000.',
		},
		{
			type: 'number',
			name: 'settle',
			message: 'Wait after load (ms)',
			default: 1500,
		},
		{
			type: 'confirm',
			name: 'framed',
			message: 'Wrap screenshots in a phone frame?',
			default: true,
		},
	])

	blank()

	return {
		pages: selectedTabs,
		output: answers.output,
		device: answers.device,
		colorScheme: answers.colorScheme,
		background: answers.background,
		settle: answers.settle ?? 1500,
		framed: answers.framed ?? true,
	}
}

// ============================================================
// HELPERS
// ============================================================

function deviceScaleLabel(d: DeviceProfile): string {
	const scale = d.scale === Math.floor(d.scale) ? d.scale : d.scale.toFixed(2)
	return colors.dim(`${d.width}×${d.height} @${scale}x`)
}

function buildFileName(index: number, tabId: string): string {
	const slug = tabId
		.replace(/[^a-z0-9-]/gi, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')

	const prefix = String(index + 1).padStart(2, '0')
	return `${prefix}-${slug || 'page'}.png`
}
