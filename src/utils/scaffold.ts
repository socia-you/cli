import fsExtra from 'fs-extra'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import type { ProjectAnswers } from './prompts.js'
import { colors, printSuccess, printWarning } from './theme.js'

const { copySync, ensureDirSync, existsSync, readFileSync, writeFileSync } =
	fsExtra

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// `scaffold.ts` lives in `src/utils/`. The templates folder sits at
// the package root, so we go up two levels instead of one.
const TEMPLATES_DIR = join(__dirname, '..', '..', 'templates')

/**
 * Files that contain `{{PROJECT_NAME}}` / `{{USERNAME}}` placeholders.
 * Everything else (Svelte components, TS sources) is placeholder-free.
 */
const FILES_TO_PATCH = ['package.json', 'manifest.json', 'index.html']

/**
 * Copy the template, substitute placeholders, and return the new project
 * path. Throws a readable error if anything goes wrong.
 */
export async function scaffold(answers: ProjectAnswers): Promise<void> {
	const { projectName, username, framework, targetDir } = answers

	// 1. Refuse to overwrite.
	if (existsSync(targetDir)) {
		throw new Error(
			`Directory "${projectName}" already exists. ` +
				`Pick another name or delete the folder first.`,
		)
	}

	// 2. Copy the template.
	const templateDir = join(TEMPLATES_DIR, framework)
	if (!existsSync(templateDir)) {
		throw new Error(
			`Template "${framework}" not found. ` +
				`Expected it at ${templateDir}. ` +
				`This usually means the CLI package is missing its templates folder.`,
		)
	}

	try {
		copySync(templateDir, targetDir)
		ensureDirSync(targetDir)
	} catch (e) {
		throw new Error(
			`Failed to copy template: ${e instanceof Error ? e.message : String(e)}`,
		)
	}

	// 3. Substitute placeholders.
	let patched = 0
	for (const file of FILES_TO_PATCH) {
		const filePath = join(targetDir, file)
		if (!existsSync(filePath)) {
			printWarning(`Missing expected file: ${file}`)
			continue
		}

		const content = readFileSync(filePath, 'utf-8')
			.replace(/\{\{PROJECT_NAME\}\}/g, projectName)
			.replace(/\{\{USERNAME\}\}/g, username)

		writeFileSync(filePath, content, 'utf-8')
		patched += 1
	}

	printSuccess(`Created project in ${colors.accent(targetDir)}`)
	printSuccess(`Substituted placeholders in ${patched} file(s)`)
}
