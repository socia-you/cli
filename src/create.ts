#!/usr/bin/env node

/**
 * Entry point for the `create-socia-sphere` binary.
 *
 * This is what `npx create-socia-sphere my-app` runs. It is a thin
 * wrapper — the actual work lives in `commands/create.ts`.
 *
 * Kept separate from `index.ts` (the `socia` binary) so that both
 * binaries can ship from the same npm package.
 */

import { Command } from 'commander'
import { createCommand } from './commands/create.js'
import { updateCommand } from './commands/update.js'
import { colors, printError } from './utils/theme.js'
import { CLI_VERSION } from './utils/package-info.js'

const program = new Command()

program
	.name('create-socia-sphere')
	.description('Scaffold a new Socia mini app')
	.version(CLI_VERSION)
	.argument('[project-name]', 'Name of the project')
	.action(async (projectName?: string) => {
		try {
			await createCommand(projectName)
		} catch (error) {
			printError(
				'Something went wrong',
				error instanceof Error ? error.message : String(error),
			)
			process.exit(1)
		}
	})

// Ctrl+C — print a short farewell and exit cleanly.
process.on('SIGINT', () => {
	console.log()
	console.log(`  ${colors.muted('Cancelled.')}`)
	console.log()
	process.exit(130)
})

// ===== UPDATE =====
program
	.command('update')
	.description('Refresh framework files from the installed template')
	.option('--docs', 'Also refresh AI.md and README.md')
	.option(
		'--force',
		'Also refresh src/ and index.html — DESTRUCTIVE, wipes your code',
	)
	.action(async options => {
		try {
			await updateCommand({
				docs: options.docs,
				force: options.force,
			})
		} catch (error) {
			console.error('Error:', error instanceof Error ? error.message : error)
			process.exit(1)
		}
	})

program.parse()
