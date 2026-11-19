import fsExtra from 'fs-extra'
import { join, resolve } from 'path'
import {
	hasSigningKey,
	loadConfig,
	loadSigningKey,
	requireLogin,
} from '../utils/auth.js'
import { extractHtmlMeta } from '../utils/html-meta.js'
import { checkAssetSizes } from '../utils/image-optimizer.js'
import { logger } from '../utils/logger.js'
import { isValidNewAppUsername, loadManifest } from '../utils/manifest.js'
import {
	MAX_PACKAGE_BYTES,
	collectFiles,
	createTarBr,
} from '../utils/pack.js'
import { preflight } from '../utils/preflight.js'
import { colors } from '../utils/theme.js'
import { decodeKey, signFiles, writeSignature } from '../utils/sign.js'
import { runViteBuild } from '../utils/vite.js'
import { startDeployUI } from './deploy-ui.js'

const {
	existsSync,
	copySync,
	removeSync,
	ensureDirSync,
	statSync,
	readFileSync,
	writeFileSync,
} = fsExtra

export interface DeployOptions {
	registry?: string
}

export async function deployCommand(options: DeployOptions): Promise<void> {
	const projectDir = process.cwd()

	logger.step(1, 'Reading manifest.json')
	const manifest = loadManifest(projectDir)
	logger.success(`Manifest: @${manifest.username} v${manifest.version}`)

	logger.step(2, 'Checking account and app state')
	requireLogin()
	const remote = await preflight(manifest.username)

	if (!remote.ok) {
		throw new Error(remote.message)
	}
	logger.success(`State: ${remote.data.state}`)

	if (
		remote.data.state === 'not_found' &&
		!isValidNewAppUsername(manifest.username)
	) {
		throw new Error(
			`New app usernames need 6..32 chars, lowercase [a-z0-9_], ` +
				`and must not start or end with "_" (got "${manifest.username}").`,
		)
	}

	logger.step(3, 'Running vite build')
	await runViteBuild(projectDir)
	logger.success('Vite build finished')

	const distDir = join(projectDir, 'dist')
	if (!existsSync(distDir)) {
		throw new Error('dist/ not found after build')
	}

	checkAssetSizes(distDir)

	if (!hasSigningKey()) {
		throw new Error(
			'No signing key found in ~/.socia/signing_key. ' +
				'Run `socia keygen` first.',
		)
	}

	const signingKey = loadSigningKey()
	const privateKeyBytes = decodeKey(signingKey.privateKey)
	const publicKeyBase64 = signingKey.publicKey

	logger.step(4, 'Reading metadata from HTML')
	const htmlMeta = extractHtmlMeta(join(distDir, 'index.html'))
	logger.success(`Name: ${htmlMeta.name ?? '(empty)'}`)

	logger.step(5, 'Packing .socia package')

	const stagingDir = join(projectDir, '.socia-staging')
	if (existsSync(stagingDir)) removeSync(stagingDir)
	ensureDirSync(stagingDir)

	copySync(join(projectDir, 'manifest.json'), join(stagingDir, 'manifest.json'))
	copySync(distDir, stagingDir, { overwrite: true })

	// Embed the publisher's Ed25519 public key into the staged
	// manifest BEFORE signing.
	const stagedManifestPath = join(stagingDir, 'manifest.json')
	const stagedManifest = JSON.parse(readFileSync(stagedManifestPath, 'utf-8'))
	stagedManifest.publisher_pubkey = publicKeyBase64
	writeFileSync(
		stagedManifestPath,
		JSON.stringify(stagedManifest, null, 2),
		'utf-8',
	)

	const files = collectFiles(stagingDir)
	const signature = signFiles(files, privateKeyBytes)
	writeSignature(stagingDir, signature)
	logger.success(
		`Signature: ${Buffer.from(signature).toString('base64').slice(0, 16)}…`,
	)

	const sociaName = `${manifest.username}-${manifest.version}.socia`
	const sociaPath = resolve(projectDir, sociaName)
	await createTarBr(stagingDir, sociaPath)
	removeSync(stagingDir)

	const sizeBytes = statSync(sociaPath).size
	if (sizeBytes > MAX_PACKAGE_BYTES) {
		removeSync(sociaPath)
		throw new Error(
			`Package is too large: ${(sizeBytes / 1024 / 1024).toFixed(1)} MB ` +
				`(max ${MAX_PACKAGE_BYTES / 1024 / 1024} MB). ` +
				'Remove unused assets and rebuild.',
		)
	}

	const sizeKb = (sizeBytes / 1024).toFixed(1)
	logger.success(`Package: ${sociaName} (${sizeKb} KB)`)

	logger.step(6, 'Starting deploy UI')

	const registryDir = options.registry
		? resolve(projectDir, options.registry)
		: join(projectDir, 'published')

	ensureDirSync(registryDir)

	const config = loadConfig()

	const result = await startDeployUI({
		projectDir,
		distDir,
		sociaPath,
		registryDir,
		apiUrl: config.apiUrl,
		token: config.token,
		username: manifest.username,
		version: manifest.version,
		publisherPubkey: publicKeyBase64,
		preflight: remote.data,
		defaults: {
			name: htmlMeta.name,
			description: htmlMeta.description,
			category: htmlMeta.category,
			channelUrl: htmlMeta.channelUrl,
			icon: htmlMeta.icon,
			screenshots: htmlMeta.screenshots,
		},
	})

	if (result == null) {
		logger.warn('Publish cancelled')
		return
	}

	console.log('')
	console.log(
		`  ${colors.success('➜')}  ${colors.bold('Submitted for moderation.')}`,
	)
	console.log('')
}
