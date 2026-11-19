import fsExtra from 'fs-extra'

const { readFileSync } = fsExtra

export interface HtmlMeta {
	name: string | null
	description: string | null
	icon: string | null
	screenshots: string[]
	category: string | null
	channelUrl: string | null
}

/**
 * Extract metadata from a built index.html.
 *
 * Sources:
 *   - `<title>` → name
 *   - `<meta name="description">` → description
 *   - `<meta name="category">` → category
 *   - `<meta name="channel_url">` → channelUrl
 *   - `<link rel="icon">` → icon path
 *   - `<meta property="og:image">` → screenshots
 *
 * Used by the deploy UI to pre-fill the publish form.
 */
export function extractHtmlMeta(htmlPath: string): HtmlMeta {
	const html = readFileSync(htmlPath, 'utf-8')

	const titleMatch = html.match(/<title>([^<]+)<\/title>/i)
	const name = titleMatch ? titleMatch[1].trim() : null

	const descMatch = html.match(
		/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i,
	)
	const description = descMatch ? descMatch[1].trim() : null

	const catMatch = html.match(
		/<meta\s+name=["']category["']\s+content=["']([^"']+)["']/i,
	)
	const category = catMatch ? catMatch[1].trim() : null

	const chanMatch = html.match(
		/<meta\s+name=["']channel_url["']\s+content=["']([^"']+)["']/i,
	)
	const channelUrl = chanMatch ? chanMatch[1].trim() : null

	const iconMatch = html.match(
		/<link\s+[^>]*rel=["'](?:icon|shortcut icon)["'][^>]*href=["']([^"']+)["']/i,
	)
	const icon = iconMatch ? normalizeAssetPath(iconMatch[1]) : null

	const screenshots: string[] = []
	const ogImageRegex =
		/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/gi
	let match: RegExpExecArray | null
	while ((match = ogImageRegex.exec(html)) !== null) {
		screenshots.push(normalizeAssetPath(match[1]))
	}

	return { name, description, icon, screenshots, category, channelUrl }
}

function normalizeAssetPath(path: string): string {
	let p = path.trim()
	if (p.startsWith('/')) p = p.slice(1)
	if (p.startsWith('./')) p = p.slice(2)
	return p
}
