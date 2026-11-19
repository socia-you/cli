#!/usr/bin/env node

import { Command } from 'commander'
import { buildCommand } from './commands/build.js'
import { bumpCommand } from './commands/bump.js'
import { createCommand } from './commands/create.js'
import { deployCommand } from './commands/deploy.js'
import { devCommand } from './commands/dev.js'
import { keygenCommand } from './commands/keygen.js'
import { loginCommand } from './commands/login.js'
import { publishCommand } from './commands/publish.js'
import { shotCommand } from './commands/shot.js'
import { updateCommand } from './commands/update.js'
import { BumpKind } from './utils/version.js'
import { CLI_VERSION } from './utils/package-info.js'

const program = new Command()

program.name('socia').description('Socia mini-app CLI').version(CLI_VERSION)

// ===== CREATE =====
program
	.command('create')
	.description('Scaffold a new mini app (same as create-socia-sphere)')
	.argument('[project-name]', 'Name of the project')
	.action(async (projectName?: string) => {
		try {
			await createCommand(projectName)
		} catch (error) {
			console.error('Error:', error instanceof Error ? error.message : error)
			process.exit(1)
		}
	})

// ===== LOGIN =====
program
	.command('login')
	.description('Sign in to your Socia account (opens the browser)')
	.action(async () => {
		try {
			await loginCommand()
		} catch (error) {
			console.error('Error:', error instanceof Error ? error.message : error)
			process.exit(1)
		}
	})

// ===== KEYGEN =====
program
	.command('keygen')
	.description('Generate an Ed25519 signing key for publishing apps')
	.option('-f, --force', 'Overwrite an existing signing key')
	.action(async options => {
		try {
			await keygenCommand({ force: options.force })
		} catch (error) {
			console.error('Error:', error instanceof Error ? error.message : error)
			process.exit(1)
		}
	})

// ===== DEV =====
program
	.command('dev')
	.description('Start a live preview with HMR')
	.option('-p, --port <port>', 'UI port (default: 3003)')
	.option('--no-open', 'Do not open the browser automatically')
	.action(async options => {
		try {
			await devCommand({
				port: options.port ? parseInt(options.port, 10) : undefined,
				noOpen: options.open === false,
			})
		} catch (error) {
			console.error('Error:', error instanceof Error ? error.message : error)
			process.exit(1)
		}
	})

// ===== BUMP =====
program
	.command('bump')
	.description('Increment the version in manifest.json')
	.argument('<kind>', 'One of: patch, minor, major')
	.option('--git', 'Also commit and tag in git')
	.action(async (kind: string, options) => {
		if (kind !== 'patch' && kind !== 'minor' && kind !== 'major') {
			console.error(
				`Error: invalid bump kind "${kind}". Expected: patch, minor, or major.`,
			)
			process.exit(1)
		}
		try {
			await bumpCommand({
				kind: kind as BumpKind,
				git: options.git,
			})
		} catch (error) {
			console.error('Error:', error instanceof Error ? error.message : error)
			process.exit(1)
		}
	})

// ===== BUILD =====
program
	.command('build')
	.description('Build the project into a signed .socia package')
	.option('-o, --output <name>', 'Output file name')
	.option('--skip-vite', 'Skip the vite build step')
	.action(async options => {
		try {
			await buildCommand({
				output: options.output,
				skipVite: options.skipVite,
			})
		} catch (error) {
			console.error('Error:', error instanceof Error ? error.message : error)
			process.exit(1)
		}
	})

// ===== DEPLOY =====
program
	.command('deploy')
	.description('Build, sign with Ed25519, and open the deploy UI')
	.option('-r, --registry <dir>', 'Registry folder (default: ./published)')
	.action(async options => {
		try {
			await deployCommand({
				registry: options.registry,
			})
		} catch (error) {
			console.error('Error:', error instanceof Error ? error.message : error)
			process.exit(1)
		}
	})

// ===== PUBLISH =====
program
	.command('publish')
	.description('Publish an existing .socia package to the local registry')
	.option('-f, --file <path>', 'Path to the .socia file')
	.option('-r, --registry <dir>', 'Registry folder')
	.action(async options => {
		try {
			await publishCommand({
				file: options.file,
				registry: options.registry,
			})
		} catch (error) {
			console.error('Error:', error instanceof Error ? error.message : error)
			process.exit(1)
		}
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

// ===== SHOT =====
program
	.command('shot')
	.description('Capture web page screenshots inside a phone frame')
	.action(async () => {
		try {
			await shotCommand()
		} catch (error) {
			console.error('Error:', error instanceof Error ? error.message : error)
			process.exit(1)
		}
	})

program.parse()
