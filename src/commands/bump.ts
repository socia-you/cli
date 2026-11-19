import { spawn } from 'child_process'
import fsExtra from 'fs-extra'
import { join } from 'path'
import { logger } from '../utils/logger.js'
import { loadManifest } from '../utils/manifest.js'
import { bumpVersionString, type BumpKind } from '../utils/version.js'

const { readFileSync, writeFileSync } = fsExtra

export interface BumpOptions {
	kind: BumpKind
	/**
	 * If true, also `git add manifest.json`, commit, and tag.
	 * Requires the current directory to be inside a git repo.
	 */
	git?: boolean
}

/**
 * `socia bump patch|minor|major` — increment the version in
 * `manifest.json`.
 *
 * With `--git`, also commits the change and creates a tag.
 */
export async function bumpCommand(options: BumpOptions): Promise<void> {
	const projectDir = process.cwd()
	let step = 0

	// If `--git` was requested, verify we are inside a git repo
	// BEFORE touching manifest.json. Otherwise a missing repo would
	// leave the file bumped but uncommitted.
	if (options.git) {
		logger.step(++step, 'Checking git repository')
		const insideRepo = await isInsideGitRepo(projectDir)
		if (!insideRepo) {
			throw new Error(
				'--git was passed, but the current directory is not a git repository.',
			)
		}
		logger.success('Git repository detected')
	}

	logger.step(++step, 'Reading manifest.json')
	const manifest = loadManifest(projectDir)
	const oldVersion = manifest.version
	logger.success(`Current version: ${oldVersion}`)

	logger.step(++step, `Bumping ${options.kind}`)
	const newVersion = bumpVersionString(oldVersion, options.kind)
	logger.success(`${oldVersion} → ${newVersion}`)

	// Update manifest.json in place.
	const manifestPath = join(projectDir, 'manifest.json')
	const raw = readFileSync(manifestPath, 'utf-8')
	const parsed = JSON.parse(raw)
	parsed.version = newVersion
	writeFileSync(manifestPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8')

	logger.success('manifest.json updated')

	if (options.git) {
		logger.step(++step, 'Committing to git')
		await runGit(projectDir, ['add', 'manifest.json'])
		await runGit(projectDir, [
			'commit',
			'-m',
			`chore: bump version to ${newVersion}`,
		])
		await runGit(projectDir, ['tag', `v${newVersion}`])
		logger.success(`Committed and tagged v${newVersion}`)
	}

	console.log('')
	logger.success(`Version bumped to ${newVersion}`)
	console.log('')
}

/**
 * Check if `cwd` is inside a git working tree.
 *
 * Runs `git rev-parse --is-inside-work-tree`. Returns `true` on
 * exit code 0, `false` on any other code. Never throws — callers
 * decide what to do.
 */
function isInsideGitRepo(cwd: string): Promise<boolean> {
	return new Promise(resolve => {
		const isWindows = process.platform === 'win32'
		const command = isWindows ? 'git.exe' : 'git'

		const proc = spawn(command, ['rev-parse', '--is-inside-work-tree'], {
			cwd,
			stdio: ['ignore', 'ignore', 'ignore'],
			shell: false,
		})

		proc.on('error', () => resolve(false))
		proc.on('close', code => resolve(code === 0))
	})
}

/**
 * Run a `git` command in `cwd`, inheriting stdio.
 *
 * Throws with a readable message on non-zero exit.
 */
function runGit(cwd: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const isWindows = process.platform === 'win32'
		const command = isWindows ? 'git.exe' : 'git'

		const proc = spawn(command, args, {
			cwd,
			stdio: 'inherit',
			shell: false,
		})

		proc.on('error', reject)
		proc.on('close', code => {
			if (code === 0) resolve()
			else reject(new Error(`git ${args.join(' ')} exited with code ${code}`))
		})
	})
}
