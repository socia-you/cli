import { spawn } from 'child_process'
import inquirer from 'inquirer'
import { basename } from 'path'
import { installDependencies } from '../utils/install.js'
import { runPrompts } from '../utils/prompts.js'
import { scaffold } from '../utils/scaffold.js'
import {
	blank,
	printBanner,
	printDoneBlock,
	printError,
	printInfo,
	printStep,
} from '../utils/theme.js'
import { devCommand } from './dev.js'

/**
 * `socia create [project-name]` and `create-socia-sphere [project-name]`.
 *
 * Flow:
 *   1. Banner.
 *   2. Interactive prompts.
 *   3. Scaffold (copy template + patch placeholders).
 *   4. Optional `npm install`.
 *   5. Optional `npm run dev`.
 *   6. Summary block with next steps.
 *   7. Optional: spawn a new shell inside the project folder.
 */
export async function createCommand(projectName?: string): Promise<void> {
	printBanner()

	printInfo('Welcome to Socia.')
	printInfo('Answer a few questions, and we will scaffold your mini app.')
	blank()

	// ----- 1. Prompts ----------------------------------------------------------
	const answers = await runPrompts(projectName)

	const totalSteps = answers.installDeps ? 2 : 1

	blank()

	// ----- 2. Scaffold ---------------------------------------------------------
	printStep(1, totalSteps, 'Scaffolding project')
	try {
		await scaffold(answers)
	} catch (e) {
		printError(
			'Could not scaffold the project',
			e instanceof Error ? e.message : String(e),
		)
		process.exit(1)
	}

	// ----- 3. Install ----------------------------------------------------------
	let installFailed = false
	if (answers.installDeps) {
		blank()
		printStep(2, totalSteps, 'Installing dependencies')
		try {
			await installDependencies(answers.targetDir)
		} catch (e) {
			installFailed = true
			printError(
				'Dependency install failed',
				e instanceof Error ? e.message : String(e),
			)
			printInfo('You can retry later:')
			printInfo(`  cd ${basename(answers.targetDir)}`)
			printInfo('  npm install')
		}
	}

	// ----- 4. Done block -------------------------------------------------------
	blank()
	printDoneBlock({
		headline: 'Done.',
		subtitle: 'Your Socia mini app is ready.',
		rows: [
			{ label: 'Location', value: answers.targetDir },
			{ label: 'Username', value: `@${answers.username}` },
			{ label: 'Template', value: 'Svelte 5 + TypeScript' },
		],
		sections: [
			{
				title: 'Next steps',
				lines: [
					`cd ${answers.projectName}`,
					...(installFailed
						? ['npm install   # retry, it failed earlier']
						: []),
					'npm run dev',
				],
			},
			{
				title: 'Documentation',
				lines: [
					'README.md   project workflow',
					'AI.md       architecture for you and LLMs',
				],
			},
			{
				title: 'Publish to Sphere',
				lines: ['socia login', 'socia deploy'],
			},
		],
	})

	// ----- 5. Optional dev server ---------------------------------------------
	if (answers.startDev && !installFailed) {
		blank()
		printInfo('Starting the dev server. Press Ctrl+C to stop.')
		blank()
		try {
			// `devCommand` uses `process.cwd()` to find the manifest,
			// so switch into the new project folder first.
			process.chdir(answers.targetDir)
			await devCommand({})
		} catch (e) {
			printError(
				'Dev server exited unexpectedly',
				e instanceof Error ? e.message : String(e),
			)
			process.exit(1)
		}
		return
	}

	// ----- 6. Optional: spawn a new shell inside the project ------------------
	const { openShell } = await inquirer.prompt<{ openShell: boolean }>({
		type: 'confirm',
		name: 'openShell',
		message: 'Open a new shell in the project directory?',
		default: false,
	})

	if (openShell) {
		blank()
		printInfo('Spawning a new shell. Type `exit` to return.')
		blank()
		try {
			await spawnShell(answers.targetDir)
		} catch (e) {
			printError(
				'Could not open a shell',
				e instanceof Error ? e.message : String(e),
			)
		}
	}
}

// -----------------------------------------------------------------------------
// Shell helper
// -----------------------------------------------------------------------------

/**
 * Spawn an interactive shell with `cwd` set to the project directory.
 *
 * The parent CLI stays alive until the user exits the child shell.
 * On Windows we use `cmd.exe /K`; on POSIX we launch `$SHELL` (or a
 * fallback) in interactive mode.
 */
function spawnShell(projectDir: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const isWindows = process.platform === 'win32'
		const shell = isWindows ? 'cmd.exe' : (process.env.SHELL ?? '/bin/bash')

		const args = isWindows ? ['/K'] : ['-i']

		const proc = spawn(shell, args, {
			cwd: projectDir,
			stdio: 'inherit',
			shell: false,
		})

		proc.on('error', reject)
		proc.on('close', () => resolve())
	})
}
