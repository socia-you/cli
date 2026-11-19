import { spawn } from 'child_process'
import fsExtra from 'fs-extra'
import { join } from 'path'

const { existsSync } = fsExtra

/**
 * Ensure `node_modules` exists. If not, run `npm install` first.
 *
 * Without this, `vite build` fails on a freshly scaffolded project
 * with `Cannot find package 'vite'` — the user has to remember to run
 * `npm install` manually.
 */
async function ensureDependencies(projectDir: string): Promise<void> {
	const nodeModules = join(projectDir, 'node_modules')
	if (existsSync(nodeModules)) return

	console.log('')
	console.log('Installing dependencies (first run)...')
	console.log('')

	await new Promise<void>((resolve, reject) => {
		const isWindows = process.platform === 'win32'
		const command = isWindows ? 'npm.cmd' : 'npm'

		const proc = spawn(command, ['install'], {
			cwd: projectDir,
			stdio: 'inherit',
			shell: isWindows,
		})

		proc.on('close', code => {
			if (code === 0) resolve()
			else reject(new Error(`npm install exited with code ${code}`))
		})

		proc.on('error', reject)
	})
}

/**
 * Run `vite build` in the given project directory.
 *
 * If `node_modules` is missing, installs dependencies first.
 */
export async function runViteBuild(projectDir: string): Promise<void> {
	await ensureDependencies(projectDir)

	return new Promise((resolve, reject) => {
		const isWindows = process.platform === 'win32'
		const command = isWindows ? 'npx.cmd' : 'npx'

		const proc = spawn(command, ['vite', 'build'], {
			cwd: projectDir,
			stdio: 'inherit',
			shell: isWindows,
		})

		proc.on('close', code => {
			if (code === 0) resolve()
			else reject(new Error(`vite build exited with code ${code}`))
		})

		proc.on('error', reject)
	})
}
