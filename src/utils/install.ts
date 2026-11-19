import { spawn } from 'child_process'
import ora from 'ora'
import { colors, printWarning } from './theme.js'

/**
 * Run `npm install` in the given directory with a spinner.
 *
 * We capture stdout but do not forward it — npm's own progress bar
 * would fight with our spinner. stderr is buffered so we can show
 * it when the install fails.
 *
 * Throws with a readable message on failure.
 */
export function installDependencies(projectDir: string): Promise<void> {
	const isWindows = process.platform === 'win32'
	const command = isWindows ? 'npm.cmd' : 'npm'

	const spinner = ora({
		text: colors.muted('Installing dependencies'),
		color: 'gray',
		spinner: 'dots',
		stream: process.stdout,
	}).start()

	return new Promise((resolve, reject) => {
		const proc = spawn(command, ['install', '--no-audit', '--no-fund'], {
			cwd: projectDir,
			shell: isWindows,
			stdio: ['ignore', 'pipe', 'pipe'],
		})

		let stderr = ''

		// Swallow stdout — we have our own spinner.
		proc.stdout?.on('data', () => {})

		proc.stderr?.on('data', (chunk: Buffer) => {
			stderr += chunk.toString()
		})

		proc.on('error', err => {
			spinner.fail(colors.error('Failed to install dependencies'))
			reject(err)
		})

		proc.on('close', code => {
			if (code === 0) {
				spinner.succeed('Installed dependencies')
				resolve()
			} else {
				spinner.fail(colors.error('Failed to install dependencies'))
				reject(
					new Error(stderr.trim() || `npm install exited with code ${code}.`),
				)
			}
		})
	})
}

/**
 * Start the dev server (`npm run dev`) and attach the terminal to it.
 *
 * The child process inherits stdio, so Vite's output appears directly.
 * Ctrl+C sends SIGINT to both the parent and the child.
 */
export function startDevServer(projectDir: string): Promise<void> {
	const isWindows = process.platform === 'win32'
	const command = isWindows ? 'npm.cmd' : 'npm'

	return new Promise((resolve, reject) => {
		const proc = spawn(command, ['run', 'dev'], {
			cwd: projectDir,
			stdio: 'inherit',
			shell: isWindows,
		})

		proc.on('error', reject)

		proc.on('close', code => {
			// 0 = normal exit, 130 = SIGINT (Ctrl+C). Both are fine.
			if (code === 0 || code === 130) {
				resolve()
			} else {
				reject(new Error(`Dev server exited with code ${code}.`))
			}
		})
	})
}

/**
 * Warn (but do not throw) if a package manager is missing.
 * Currently a stub — future versions may check for npm/pnpm/yarn.
 */
export function checkPackageManager(): void {
	// Reserved for future use.
	void printWarning
}
