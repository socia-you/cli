import fsExtra from 'fs-extra'
import ora from 'ora'
import { join, resolve } from 'path'
import type { BuildOptions } from '../types.js'
import { hasSigningKey, loadSigningKey } from '../utils/auth.js'
import { checkAssetSizes } from '../utils/image-optimizer.js'
import { logger } from '../utils/logger.js'
import { loadManifest } from '../utils/manifest.js'
import {
	MAX_PACKAGE_BYTES,
	collectFiles,
	createTarBr,
} from '../utils/pack.js'
import { decodeKey, signFiles, writeSignature } from '../utils/sign.js'
import { runViteBuild } from '../utils/vite.js'

const {
	existsSync,
	copySync,
	removeSync,
	ensureDirSync,
	statSync,
	readFileSync,
	writeFileSync,
} = fsExtra

export async function buildCommand(options: BuildOptions): Promise<void> {
	const projectDir = process.cwd()

	logger.step(1, 'Reading manifest.json')
	const manifest = loadManifest(projectDir)
	logger.success(`Manifest: @${manifest.username} v${manifest.version}`)

	if (!options.skipVite) {
		logger.step(2, 'Running vite build')
		await runViteBuild(projectDir)
		logger.success('Vite build finished')

		// Refuse to build if any asset is huge.
		checkAssetSizes(join(projectDir, 'dist'))
	} else {
		logger.step(2, 'Skipping vite build (--skip-vite)')
	}

	const distDir = join(projectDir, 'dist')
	if (!existsSync(distDir)) {
		throw new Error('dist/ not found. Run vite build or remove --skip-vite')
	}

	if (!hasSigningKey()) {
		throw new Error(
			'No signing key found in ~/.socia/signing_key. ' +
				'Run `socia keygen` first.',
		)
	}

	const signingKey = loadSigningKey()
	const privateKeyBytes = decodeKey(signingKey.privateKey)
	const publicKeyBase64 = signingKey.publicKey

	const stagingDir = join(projectDir, '.socia-staging')
	if (existsSync(stagingDir)) removeSync(stagingDir)
	ensureDirSync(stagingDir)

	logger.step(3, 'Collecting files for packaging')

	copySync(join(projectDir, 'manifest.json'), join(stagingDir, 'manifest.json'))
	copySync(distDir, stagingDir, { overwrite: true })

	// Embed the publisher's Ed25519 public key into the staged
	// manifest BEFORE signing. The signature covers every file in
	// the staging dir, including manifest.json.
	const stagedManifestPath = join(stagingDir, 'manifest.json')
	const stagedManifest = JSON.parse(readFileSync(stagedManifestPath, 'utf-8'))
	stagedManifest.publisher_pubkey = publicKeyBase64
	writeFileSync(
		stagedManifestPath,
		JSON.stringify(stagedManifest, null, 2),
		'utf-8',
	)

	logger.step(4, 'Signing package (Ed25519)')
	const files = collectFiles(stagingDir)
	const signature = signFiles(files, privateKeyBytes)
	writeSignature(stagingDir, signature)
	logger.success(
		`Signature: ${Buffer.from(signature).toString('base64').slice(0, 16)}…`,
	)

	const outputName =
		options.output || `${manifest.username}-${manifest.version}.socia`
	const outputPath = resolve(projectDir, outputName)

	logger.step(5, 'Packing into .socia (tar + brotli)')
	const spinner = ora('Creating tar.br...').start()
	await createTarBr(stagingDir, outputPath)

	const stats = statSync(outputPath)
	if (stats.size > MAX_PACKAGE_BYTES) {
		removeSync(stagingDir)
		removeSync(outputPath)
		throw new Error(
			`Package is too large: ${(stats.size / 1024 / 1024).toFixed(1)} MB ` +
				`(max ${MAX_PACKAGE_BYTES / 1024 / 1024} MB). Remove unused assets and rebuild.`,
		)
	}
	spinner.succeed(`Package created: ${outputName}`)

	removeSync(stagingDir)

	const sizeKb = (stats.size / 1024).toFixed(1)

	console.log('')
	logger.success(`Done. Size: ${sizeKb} KB`)
	console.log('')
	console.log('The package is ready to publish to Sphere:')
	console.log(`  ${outputPath}`)
	console.log('')
}
