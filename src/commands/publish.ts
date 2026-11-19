import fsExtra from 'fs-extra'
import ora from 'ora'
import { basename, join, resolve } from 'path'
import { logger } from '../utils/logger.js'
import { loadManifest } from '../utils/manifest.js'

const {
	existsSync,
	readdirSync,
	ensureDirSync,
	copySync,
	readFileSync,
	writeFileSync,
	statSync,
} = fsExtra

export interface PublishOptions {
	file?: string
	registry?: string
}

export async function publishCommand(options: PublishOptions): Promise<void> {
	const projectDir = process.cwd()

	// 1. Manifest.
	logger.step(1, 'Reading manifest.json')
	const manifest = loadManifest(projectDir)
	logger.success(`Manifest: @${manifest.username} v${manifest.version}`)

	// 2. Find the .socia package.
	logger.step(2, 'Locating .socia package')

	const sociaFile = options.file
		? resolve(projectDir, options.file)
		: findSociaPackage(projectDir, manifest)

	if (!sociaFile || !existsSync(sociaFile)) {
		throw new Error(
			'.socia package not found. Run `socia build` or `socia deploy` first.',
		)
	}

	logger.success(`Found package: ${basename(sociaFile)}`)

	// 3. Size.
	logger.step(3, 'Inspecting package')
	const stats = statSync(sociaFile)
	const sizeKb = (stats.size / 1024).toFixed(1)
	logger.success(`Size: ${sizeKb} KB`)

	// 4. Registry.
	logger.step(4, 'Publishing to local registry')

	const registryDir = options.registry
		? resolve(projectDir, options.registry)
		: join(projectDir, 'published')

	const appDir = join(registryDir, manifest.username)
	ensureDirSync(appDir)

	const targetPath = join(appDir, `${manifest.version}.socia`)
	const spinner = ora('Copying package...').start()
	copySync(sociaFile, targetPath)
	spinner.succeed(`Copied to ${targetPath}`)

	// 5. metadata.json.
	const metadataPath = join(appDir, 'metadata.json')
	const metadata = {
		username: manifest.username,
		name: manifest.display?.name ?? manifest.name ?? manifest.username,
		description: manifest.display?.description ?? '',
		icon: manifest.display?.icon ?? 'icon.png',
		screenshots: manifest.display?.screenshots ?? [],
		category: manifest.display?.category ?? 'utilities',
		channel_url: manifest.display?.channel_url ?? null,
		version: manifest.version,
		entry: manifest.entry,
		backend: manifest.backend,
		permissions: manifest.permissions ?? [],
		publishedAt: new Date().toISOString(),
		size: stats.size,
		fileName: `${manifest.version}.socia`,
		status: 'pending',
	}

	writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8')

	logger.success(`Metadata: ${metadataPath}`)

	// 6. Update the registry index.
	updateRegistryIndex(registryDir)

	// 7. Summary.
	console.log('')
	logger.success('Package published')
	console.log('')
	console.log('Registry:')
	console.log(`  ${registryDir}`)
	console.log('')
	listPublishedApps(registryDir)
	console.log('')
}

function findSociaPackage(
	projectDir: string,
	manifest: { username: string; version: string },
): string | null {
	const expectedName = `${manifest.username}-${manifest.version}.socia`
	const expectedPath = join(projectDir, expectedName)

	if (existsSync(expectedPath)) return expectedPath

	const files = readdirSync(projectDir)
	const sociaFiles = files.filter((f: string) => f.endsWith('.socia'))

	if (sociaFiles.length > 0) {
		return join(projectDir, sociaFiles[0])
	}

	return null
}

function updateRegistryIndex(registryDir: string): void {
	const apps: Array<Record<string, unknown>> = []

	const usernames = readdirSync(registryDir).filter((entry: string) => {
		const fullPath = join(registryDir, entry)
		return statSync(fullPath).isDirectory()
	})

	for (const username of usernames) {
		const metadataPath = join(registryDir, username, 'metadata.json')
		if (!existsSync(metadataPath)) continue

		try {
			const raw = readFileSync(metadataPath, 'utf-8')
			const meta = JSON.parse(raw)

			const appDir = join(registryDir, username)
			const sociaFiles = readdirSync(appDir).filter((f: string) =>
				f.endsWith('.socia'),
			)

			apps.push({
				username: meta.username ?? username,
				name: meta.name ?? username,
				description: meta.description ?? '',
				icon: meta.icon ?? 'icon.png',
				screenshots: meta.screenshots ?? [],
				category: meta.category ?? 'utilities',
				channel_url: meta.channel_url ?? null,
				version: meta.version,
				size: meta.size,
				publishedAt: meta.publishedAt,
				fileName: meta.fileName,
				status: meta.status ?? 'pending',
				versions: sociaFiles.map((f: string) => f.replace('.socia', '')),
			})
		} catch {
			// Skip broken metadata.
		}
	}

	apps.sort((a, b) =>
		String(b.publishedAt).localeCompare(String(a.publishedAt)),
	)

	writeFileSync(
		join(registryDir, 'index.json'),
		JSON.stringify({ apps, updatedAt: new Date().toISOString() }, null, 2),
		'utf-8',
	)
}

function listPublishedApps(registryDir: string): void {
	const indexPath = join(registryDir, 'index.json')
	if (!existsSync(indexPath)) return

	try {
		const raw = readFileSync(indexPath, 'utf-8')
		const index = JSON.parse(raw)

		for (const app of index.apps) {
			const sizeKb = (app.size / 1024).toFixed(1)
			console.log(
				`  • @${app.username} v${app.version} (${sizeKb} KB) [${app.status}]`,
			)
		}
	} catch {
		// Ignore.
	}
}
