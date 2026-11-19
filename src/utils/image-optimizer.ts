import { readdirSync, statSync } from 'fs'
import { extname, join } from 'path'
import { logger } from './logger.js'

/**
 * Extensions we check for size.
 *
 * SVG excluded — it is already vector.
 * GIF excluded — animated GIFs would lose frames.
 * WebP excluded — it is already the target format.
 */
const COMPRESSIBLE = new Set(['.png', '.jpg', '.jpeg'])

/**
 * Size thresholds for assets inside `dist/assets/`:
 *
 *   INFO  — just a note; not actionable.
 *   WARN  — noticeably bloats the bundle.
 *   LIMIT — hard fail; developer must fix before shipping.
 */
const INFO_BYTES = 200 * 1024
const WARN_BYTES = 500 * 1024
const LIMIT_BYTES = 2 * 1024 * 1024

/**
 * Walk `dist/assets/` and check every compressible image.
 *
 * We do NOT re-encode here — Vite already emitted these files, and
 * rewriting them could break CSS `url()` references that point to
 * exact filenames. Instead:
 *   - warn when a file crosses 500 KB;
 *   - hard-fail the build when a file crosses 2 MB.
 *
 * Icons and screenshots uploaded through the Deploy UI are handled
 * separately — those ARE compressed automatically, in the browser.
 */
export function checkAssetSizes(distDir: string): void {
	const assetsDir = join(distDir, 'assets')
	if (!exists(assetsDir)) return

	const files = walk(assetsDir)
	const oversized: Array<{ path: string; size: number }> = []

	for (const file of files) {
		const ext = extname(file).toLowerCase()
		if (!COMPRESSIBLE.has(ext)) continue

		const size = statSync(file).size
		if (size < INFO_BYTES) continue

		const rel = file.replace(distDir + '\\', '').replace(/\\/g, '/')

		if (size >= LIMIT_BYTES) {
			const mb = (size / 1024 / 1024).toFixed(1)
			logger.error(
				`Asset "${rel}" is ${mb} MB. ` +
					`Hard limit is ${LIMIT_BYTES / 1024 / 1024} MB. ` +
					`Compress it (Squoosh, ImageOptim, WebP) and rebuild.`,
			)
			oversized.push({ path: rel, size })
		} else if (size >= WARN_BYTES) {
			const kb = (size / 1024).toFixed(0)
			logger.warn(`Asset "${rel}" is ${kb} KB. Consider converting to WebP.`)
		}
	}

	if (oversized.length > 0) {
		throw new Error(
			`Build aborted: ${oversized.length} asset(s) exceed ` +
				`${LIMIT_BYTES / 1024 / 1024} MB.`,
		)
	}
}

function exists(path: string): boolean {
	try {
		statSync(path)
		return true
	} catch {
		return false
	}
}

function walk(dir: string): string[] {
	const result: string[] = []
	const entries = readdirSync(dir)

	for (const entry of entries) {
		const full = join(dir, entry)
		const stat = statSync(full)
		if (stat.isDirectory()) {
			result.push(...walk(full))
		} else {
			result.push(full)
		}
	}

	return result
}
