import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { ensureBrowser } from './browser.js'

/**
 * Device profiles used by `socia shot`.
 *
 * Each profile controls the viewport, pixel ratio, and user agent
 * that Puppeteer emulates.
 */
export interface DeviceProfile {
	name: string
	width: number
	height: number
	scale: number
	touch: boolean
	landscape: boolean
	userAgent: string
}

export const DEVICES: Record<string, DeviceProfile> = {
	'iphone-14': {
		name: 'iPhone 14',
		width: 390,
		height: 844,
		scale: 3,
		touch: true,
		landscape: false,
		userAgent:
			'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
	},
	'iphone-15-pro': {
		name: 'iPhone 15 Pro',
		width: 393,
		height: 852,
		scale: 3,
		touch: true,
		landscape: false,
		userAgent:
			'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
	},
	'pixel-7': {
		name: 'Pixel 7',
		width: 412,
		height: 915,
		scale: 2.625,
		touch: true,
		landscape: false,
		userAgent:
			'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
	},
	'ipad-pro': {
		name: 'iPad Pro 11"',
		width: 834,
		height: 1194,
		scale: 2,
		touch: true,
		landscape: false,
		userAgent:
			'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
	},
	'desktop-1440': {
		name: 'Desktop 1440×900',
		width: 1440,
		height: 900,
		scale: 2,
		touch: false,
		landscape: true,
		userAgent:
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
	},
	'desktop-1920': {
		name: 'Desktop 1920×1080',
		width: 1920,
		height: 1080,
		scale: 1,
		touch: false,
		landscape: true,
		userAgent:
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
	},
}

/**
 * Options for `captureWebsite`.
 */
export interface CaptureOptions {
	device: DeviceProfile
	colorScheme: 'dark' | 'light' | 'no-preference'
	pageBackground: string | null
	settleMs: number
	fullPage: boolean
}

/**
 * Launch a headless browser using a locally cached Chromium.
 *
 * The browser is downloaded on first use into `~/.socia/chromium/`
 * and reused afterwards — see `ensureBrowser`.
 */
export async function launchBrowser(): Promise<Browser> {
	const info = await ensureBrowser()

	return puppeteer.launch({
		executablePath: info.executablePath,
		headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox'],
	})
}

/**
 * Capture a single page as a PNG.
 */
export async function captureWebsite(
	browser: Browser,
	url: string,
	options: CaptureOptions,
): Promise<Uint8Array> {
	const page = await browser.newPage()

	try {
		await configurePage(page, options)
		await page.goto(url, {
			waitUntil: 'networkidle2',
			timeout: 30_000,
		})

		if (options.settleMs > 0) {
			await new Promise(r => setTimeout(r, options.settleMs))
		}

		const shot = await page.screenshot({
			type: 'png',
			fullPage: options.fullPage,
			omitBackground: false,
		})

		return new Uint8Array(shot)
	} finally {
		await page.close()
	}
}

async function configurePage(
	page: Page,
	options: CaptureOptions,
): Promise<void> {
	const { device, colorScheme, pageBackground } = options

	await page.setViewport({
		width: device.width,
		height: device.height,
		deviceScaleFactor: device.scale,
		isMobile: device.touch,
		hasTouch: device.touch,
		isLandscape: device.landscape,
	})

	await page.setUserAgent(device.userAgent)

	await page.emulateMediaFeatures([
		{ name: 'prefers-color-scheme', value: colorScheme },
	])

	if (pageBackground) {
		await page.evaluateOnNewDocument((bg: string) => {
			const style = document.createElement('style')
			style.textContent = `html, body { background-color: ${bg} !important; }`
			document.documentElement.appendChild(style)
		}, pageBackground)
	}
}

/**
 * Phone frame preset used by `embedInPhone`.
 */
export interface PhoneFrame {
	background: string
	statusBar: boolean
	notch: boolean
	radiusRatio: number
	padding: number
	shadow: boolean
}

export const DEFAULT_PHONE_FRAME: PhoneFrame = {
	background: '#000000',
	statusBar: true,
	notch: true,
	radiusRatio: 0.13,
	padding: 24,
	shadow: true,
}

/**
 * Wrap a raw screenshot in an HTML "phone frame" and re-capture it.
 */
export async function embedInPhone(
	browser: Browser,
	screenshot: Uint8Array,
	frame: PhoneFrame,
): Promise<Uint8Array> {
	const page = await browser.newPage()

	try {
		const base64 = Buffer.from(screenshot).toString('base64')
		const dataUrl = `data:image/png;base64,${base64}`

		const html = buildPhoneHtml(dataUrl, frame)

		await page.setViewport({
			width: 1200,
			height: 1600,
			deviceScaleFactor: 2,
		})

		await page.setContent(html, { waitUntil: 'load' })

		await page.evaluate(async () => {
			const img = document.querySelector('img')
			if (!img) return
			if (img.complete) return
			await new Promise<void>(resolve => {
				img.addEventListener('load', () => resolve())
				img.addEventListener('error', () => resolve())
			})
		})

		const element = await page.$('#frame')
		if (!element) {
			throw new Error('Phone frame element not found')
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

function buildPhoneHtml(dataUrl: string, frame: PhoneFrame): string {
	const bodyRadius = 44 * (frame.radiusRatio / 0.13)
	const screenRadius = bodyRadius - 8

	const shadowCss = frame.shadow
		? 'box-shadow: 0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04);'
		: ''

	const notchCss = frame.notch ? `<div class="notch"></div>` : ''

	const statusBarCss = frame.statusBar
		? `
			<div class="statusbar">
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
		`
		: ''

	return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<style>
	* { margin: 0; padding: 0; box-sizing: border-box; }
	html, body {
		background: transparent;
		display: inline-block;
		padding: ${frame.padding}px;
	}
	#frame {
		position: relative;
		background: ${frame.background};
		border-radius: ${bodyRadius}px;
		padding: 8px;
		${shadowCss}
		display: inline-block;
	}
	.screen {
		position: relative;
		border-radius: ${screenRadius}px;
		overflow: hidden;
		background: #fff;
		display: block;
	}
	.screen img {
		display: block;
		max-width: 100%;
		height: auto;
	}
	.notch {
		position: absolute;
		top: 20px;
		left: 50%;
		transform: translateX(-50%);
		width: 100px;
		height: 26px;
		background: ${frame.background};
		border-radius: 999px;
		z-index: 3;
	}
	.statusbar {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 48px;
		padding: 0 32px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		z-index: 2;
		pointer-events: none;
		color: #ffffff;
		font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
		background: linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 100%);
	}
	.status-time {
		font-size: 15px;
		font-weight: 600;
		letter-spacing: 0.2px;
		margin-left: 6px;
	}
	.status-icons {
		display: flex;
		align-items: center;
		gap: 7px;
	}
	.status-icon { height: 12px; display: block; }
	.status-battery { height: 13px; }
</style>
</head>
<body>
	<div id="frame">
		<div class="screen">
			${notchCss}
			${statusBarCss}
			<img src="${dataUrl}" alt="screenshot" />
		</div>
	</div>
</body>
</html>`
}
