import fsExtra from 'fs-extra'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { logger } from '../utils/logger.js'
import { loadManifest } from '../utils/manifest.js'

const {
	existsSync,
	ensureDirSync,
	readFileSync,
	writeFileSync,
	copySync,
	removeSync,
} = fsExtra

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const TEMPLATES_DIR = join(__dirname, '..', '..', 'templates')

/**
 * Files that belong to the *framework* — they are the same in
 * every project, and safe to overwrite on update.
 *
 * `index.html` is NOT here: it holds project-specific meta tags,
 * font links, and a `<title>` the developer has edited.
 *
 * `src/` is NOT here: it holds the mini app's own code.
 */
const FRAMEWORK_FILES = ['vite.config.ts', 'tsconfig.json', 'svelte.config.js']

/**
 * Files that are project-specific and must NEVER be overwritten
 * by `socia update`. Listed here for documentation.
 */
// 'src/'            — the mini app's own code
// 'index.html'      — title, meta tags, font links
// 'manifest.json'   — id, name, version, ui, backend
// 'package.json'    — dependencies
// 'mock-api.json'   — local mock data
// 'published/'      — local registry
// '.socia-staging/' — build staging

export interface UpdateOptions {
	/**
	 * Also refresh `AI.md` and `README.md` from the template.
	 *
	 * These are project-level docs the developer might have edited
	 * (added their own notes). Off by default — pass `--docs` to
	 * opt in.
	 */
	docs?: boolean

	/**
	 * Also overwrite `src/` and `index.html` from the template.
	 *
	 * DANGER: this wipes the mini app's own code and any custom
	 * meta tags in `index.html`. Off by default. Pass `--force`
	 * only if you know what you are doing.
	 */
	force?: boolean
}

/**
 * `socia update` — refresh framework files from the installed
 * template.
 *
 * What it does by default:
 *   1. Reads `manifest.json` for `id` and `name`.
 *   2. Replaces the framework config files (`vite.config.ts`,
 *      `tsconfig.json`, `svelte.config.js`).
 *
 * What it does NOT do by default:
 *   - Touch `src/` — that is the mini app's own code.
 *   - Touch `index.html` — it holds project-specific meta tags.
 *   - Touch `manifest.json`, `package.json`, `mock-api.json`.
 *   - Touch `AI.md`, `README.md` — unless `--docs` is passed.
 *
 * **Only runs on Svelte mini apps.** A React or Vue project is
 * rejected with a clear message — the CLI does not know how to
 * refresh a framework it did not scaffold. This prevents `socia
 * update` from silently overwriting a React `vite.config.ts` with
 * the Svelte one.
 *
 * Optional flags:
 *   --docs   also refresh `AI.md` and `README.md`.
 *   --force  ALSO refresh `src/` and `index.html` — this is
 *            destructive. Use only if you want a clean slate.
 */
export async function updateCommand(options: UpdateOptions): Promise<void> {
	const projectDir = process.cwd()

	logger.step(1, 'Reading manifest.json')
	const manifest = loadManifest(projectDir)
	const projectName = manifest.name ?? manifest.username
	const username = manifest.username
	logger.success(`Project: @${username}`)

	// ---- Framework check ----
	//
	// `socia update` ships only the `svelte5-ts` template. If the
	// project is not a Svelte mini app, refuse to touch anything.
	// Without this check, `socia update` would overwrite a React
	// `vite.config.ts` with the Svelte one and break the build.
	if (!isSvelteProject(projectDir)) {
		logger.warn(
			'This project does not look like a Svelte mini app — `socia update` only refreshes Svelte projects.',
		)
		logger.info('Nothing was modified.')
		logger.info(
			'If you need to refresh a non-Svelte project, do it manually from `packages/socia-cli/templates/`.',
		)
		return
	}

	const templateDir = join(TEMPLATES_DIR, 'svelte5-ts')
	if (!existsSync(templateDir)) {
		throw new Error(
			`Template not found at ${templateDir}. ` +
				`Reinstall socia-cli, or check the package contents.`,
		)
	}

	// ---- 1. Framework config files ----

	logger.step(2, 'Refreshing framework config')
	const refreshed: string[] = []
	for (const file of FRAMEWORK_FILES) {
		const sourcePath = join(templateDir, file)
		const targetPath = join(projectDir, file)

		if (!existsSync(sourcePath)) {
			logger.warn(`Template has no ${file}, skipping`)
			continue
		}

		copySync(sourcePath, targetPath, { overwrite: true })
		refreshed.push(file)
	}

	if (refreshed.length > 0) {
		logger.success(`Refreshed: ${refreshed.join(', ')}`)
	} else {
		logger.warn('No framework files refreshed')
	}

	// ---- 2. Optional docs ----

	if (options.docs) {
		logger.step(3, 'Refreshing docs (--docs)')
		const docsRefreshed: string[] = []
		for (const file of ['AI.md', 'README.md']) {
			const sourcePath = join(templateDir, file)
			const targetPath = join(projectDir, file)
			if (!existsSync(sourcePath)) continue

			copySync(sourcePath, targetPath, { overwrite: true })
			docsRefreshed.push(file)
		}
		logger.success(`Refreshed: ${docsRefreshed.join(', ')}`)
	} else {
		logger.info('Skipped AI.md / README.md (pass --docs to refresh)')
	}

	// ---- 3. Optional force — src/ and index.html ----

	if (options.force) {
		logger.step(4, 'Force-refreshing src/ and index.html (--force)')

		// src/
		const srcDir = join(projectDir, 'src')
		const srcTemplate = join(templateDir, 'src')
		if (!existsSync(srcTemplate)) {
			logger.warn('Template has no src/, skipping')
		} else {
			if (existsSync(srcDir)) removeSync(srcDir)
			ensureDirSync(srcDir)
			copySync(srcTemplate, srcDir)
			logger.success('Replaced: src/')
		}

		// index.html
		const indexSrc = join(templateDir, 'index.html')
		const indexTarget = join(projectDir, 'index.html')
		if (existsSync(indexSrc)) {
			copySync(indexSrc, indexTarget, { overwrite: true })
			// Patch placeholders.
			const content = readFileSync(indexTarget, 'utf-8')
				.replaceAll('{{PROJECT_NAME}}', projectName)
				.replaceAll('{{USERNAME}}', username)
			writeFileSync(indexTarget, content, 'utf-8')
			logger.success('Replaced: index.html')
		} else {
			logger.warn('Template has no index.html, skipping')
		}
	}

	// ---- Done ----

	console.log('')
	logger.success('Project updated.')
	console.log('')
	console.log('Next steps:')
	console.log('  npm install       # if package.json changed')
	console.log('  socia dev         # preview locally')
	console.log('  socia deploy      # publish a new version')
	console.log('')
}

/**
 * Detect whether the current project is a Svelte mini app.
 *
 * Reads `package.json` and looks for `svelte` in either
 * `dependencies` or `devDependencies`.
 *
 * Returns `false` when:
 *   - `package.json` is missing;
 *   - it cannot be parsed as JSON;
 *   - neither dependency block contains `svelte`.
 */
function isSvelteProject(projectDir: string): boolean {
	const pkgPath = join(projectDir, 'package.json')
	if (!existsSync(pkgPath)) return false

	let pkg: {
		dependencies?: Record<string, string>
		devDependencies?: Record<string, string>
	}

	try {
		pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
	} catch {
		return false
	}

	return Boolean(pkg.dependencies?.svelte || pkg.devDependencies?.svelte)
}
