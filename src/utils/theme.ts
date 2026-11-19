import chalk from 'chalk'

/**
 * Shared typography and color palette for the CLI.
 *
 * Design principles:
 *   - No emojis. Only common Unicode box-drawing marks and checkmarks,
 *     which every modern terminal on Windows, macOS, and Linux supports.
 *   - Muted colors. White text, gray accents, colored success/error.
 *   - Consistent spacing. Two-space outer margin, one-space inner padding.
 */

// -----------------------------------------------------------------------------
// Symbols
// -----------------------------------------------------------------------------

export const sym = {
	/** Prompt indicator. */
	arrow: '›',
	/** Success mark. */
	check: '✓',
	/** Failure mark. */
	cross: '✗',
	/** Warning mark. */
	warn: '!',
	/** Neutral bullet. */
	bullet: '•',
	/** Box-drawing pieces. */
	pipe: '│',
	tl: '╭',
	tr: '╮',
	bl: '╰',
	br: '╯',
	line: '─',
} as const

// -----------------------------------------------------------------------------
// Colors
// -----------------------------------------------------------------------------

export const colors = {
	/** Bold white — for the main title. */
	brand: chalk.bold.white,
	/** Plain bold. */
	bold: chalk.bold,
	/** Dim gray — for hints, secondary text. */
	dim: chalk.gray,
	/** Muted hex gray — for muted descriptions. */
	muted: chalk.hex('#8E8E8E'),
	/** Cyan — for commands and paths the user should copy. */
	accent: chalk.cyan,
	/** Green — for success. */
	success: chalk.green,
	/** Red — for errors. */
	error: chalk.red,
	/** Yellow — for warnings. */
	warn: chalk.yellow,
} as const

// -----------------------------------------------------------------------------
// Banner
// -----------------------------------------------------------------------------

export interface BannerOptions {
	/** Big title, shown in the middle of the box. */
	title: string
	/** Smaller tagline under the title. */
	tagline: string
	/** Inner width of the box, in characters. Default: 58. */
	width?: number
}

/**
 * Print an ASCII banner.
 *
 * The box is centered, padded, and drawn with light box-drawing
 * characters. Width defaults to 58 characters inside the borders.
 */
export function printBannerCustom(options: BannerOptions): void {
	const width = options.width ?? 58
	const border = sym.line.repeat(width)
	const blank = ' '.repeat(width)

	const titleLine = centerText(options.title, width)
	const taglineLine = centerText(options.tagline, width)

	console.log()
	console.log(`  ${colors.dim(sym.tl + border + sym.tr)}`)
	console.log(`  ${colors.dim(sym.pipe)}${blank}${colors.dim(sym.pipe)}`)
	console.log(
		`  ${colors.dim(sym.pipe)}${colors.brand(titleLine)}${colors.dim(sym.pipe)}`,
	)
	console.log(
		`  ${colors.dim(sym.pipe)}${colors.muted(taglineLine)}${colors.dim(sym.pipe)}`,
	)
	console.log(`  ${colors.dim(sym.pipe)}${blank}${colors.dim(sym.pipe)}`)
	console.log(`  ${colors.dim(sym.bl + border + sym.br)}`)
	console.log()
}

/**
 * Convenience wrapper for the `create` command's banner.
 * Keeps the old call sites working.
 */
export function printBanner(): void {
	printBannerCustom({
		title: 'Create Socia App',
		tagline: 'Scaffold a new Sphere mini app',
	})
}

/**
 * Center a plain-text string inside a fixed-width column.
 * Assumes the input has no ANSI escapes.
 */
function centerText(text: string, width: number): string {
	if (text.length >= width) return text.slice(0, width)
	const left = Math.floor((width - text.length) / 2)
	const right = width - text.length - left
	return ' '.repeat(left) + text + ' '.repeat(right)
}

// -----------------------------------------------------------------------------
// Primitives
// -----------------------------------------------------------------------------

/** Print a numbered step heading, like `[1/3] Scaffolding project`. */
export function printStep(current: number, total: number, label: string): void {
	const counter = colors.dim(`[${current}/${total}]`)
	console.log(`${counter} ${colors.bold(label)}`)
}

/** Print a success line with a green check. */
export function printSuccess(message: string): void {
	console.log(`  ${colors.success(sym.check)}  ${message}`)
}

/** Print an info line without any mark. */
export function printInfo(message: string): void {
	console.log(`  ${colors.muted(message)}`)
}

/** Print a warning line. */
export function printWarning(message: string): void {
	console.log(`  ${colors.warn(sym.warn)}  ${colors.warn(message)}`)
}

/**
 * Print an error block: a red header line, plus optional indented detail.
 */
export function printError(message: string, detail?: string): void {
	console.error()
	console.error(`  ${colors.error(sym.cross)}  ${colors.error(message)}`)
	if (detail) {
		for (const line of detail.split('\n')) {
			console.error(`     ${colors.dim(line)}`)
		}
	}
	console.error()
}

/** Print a blank line for spacing. */
export function blank(): void {
	console.log()
}

// -----------------------------------------------------------------------------
// Done block
// -----------------------------------------------------------------------------

export interface DoneBlockRow {
	/** Left column — a label. Rendered dim. */
	label: string
	/** Right column — a value. Rendered accent-colored. */
	value: string
}

export interface DoneBlockSection {
	/** Optional section title. Rendered dim. */
	title: string
	/** Lines of content. Each line is rendered as-is. */
	lines: string[]
}

export interface DoneBlockOptions {
	/** Headline, e.g. "Done." */
	headline?: string
	/** Muted line under the headline. */
	subtitle?: string
	/** Label/value rows. */
	rows?: DoneBlockRow[]
	/** Free-form sections with titles and lines. */
	sections?: DoneBlockSection[]
}

/**
 * Print a summary block in a thin gray frame.
 *
 * Structure:
 *   ┌ head
 *   ├ subtitle
 *   ├ rows: label <value>
 *   ├ sections: title + lines
 *   └ footer blank
 *
 * Rows are aligned: labels are dim, values are cyan.
 * Sections are separated by blank lines.
 */
export function printDoneBlock(options: DoneBlockOptions): void {
	const lines: string[] = []

	if (options.headline) {
		lines.push(colors.bold(options.headline))
		lines.push('')
	}

	if (options.subtitle) {
		lines.push(colors.muted(options.subtitle))
		lines.push('')
	}

	if (options.rows && options.rows.length > 0) {
		const labelWidth = Math.max(...options.rows.map(r => r.label.length))
		for (const row of options.rows) {
			const pad = ' '.repeat(labelWidth - row.label.length)
			lines.push(`${colors.dim(row.label)}${pad}   ${colors.accent(row.value)}`)
		}
		lines.push('')
	}

	if (options.sections && options.sections.length > 0) {
		for (let i = 0; i < options.sections.length; i++) {
			const section = options.sections[i]
			lines.push(colors.dim(section.title))
			lines.push('')
			for (const line of section.lines) {
				lines.push(`  ${line}`)
			}
			if (i < options.sections.length - 1) {
				lines.push('')
			}
		}
	}

	// Trim trailing blank lines so the frame fits tightly.
	while (lines.length > 0 && lines[lines.length - 1] === '') {
		lines.pop()
	}

	// Fixed outer width. Two characters of left gutter inside the
	// frame, then content, then right padding.
	const contentWidth = Math.max(...lines.map(l => stripAnsi(l).length), 0)
	const leftGutter = 2
	const rightGutter = 2
	const pad = contentWidth + leftGutter + rightGutter

	const top = `  ${colors.dim(sym.tl + sym.line.repeat(pad) + sym.tr)}`
	const bottom = `  ${colors.dim(sym.bl + sym.line.repeat(pad) + sym.br)}`
	const empty = `  ${colors.dim(sym.pipe)}${' '.repeat(pad)}${colors.dim(sym.pipe)}`

	console.log(top)
	console.log(empty)

	for (const line of lines) {
		const visible = stripAnsi(line).length
		const right = ' '.repeat(pad - leftGutter - visible)
		console.log(
			`  ${colors.dim(sym.pipe)}${' '.repeat(leftGutter)}${line}${right}${colors.dim(sym.pipe)}`,
		)
	}

	console.log(empty)
	console.log(bottom)
}

/** Strip ANSI escape codes so we can measure visible string length. */
export function stripAnsi(s: string): string {
	// eslint-disable-next-line no-control-regex
	return s.replace(/\x1b\[[0-9;]*m/g, '')
}
