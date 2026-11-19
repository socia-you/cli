import fsExtra from 'fs-extra'
import { homedir } from 'os'
import { join } from 'path'
import { decodeKey, encodeKey } from './sign.js'

const { existsSync, ensureDirSync, readFileSync, writeFileSync, chmodSync } =
	fsExtra

const CONFIG_DIR = join(homedir(), '.socia')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')
const SIGNING_KEY_FILE = join(CONFIG_DIR, 'signing_key')
const SIGNING_KEY_PUB_FILE = join(CONFIG_DIR, 'signing_key.pub')

export interface SociaConfig {
	apiUrl: string
	token?: string
	refreshToken?: string
	userId?: string
	username?: string
}

// ============================================================
// CONFIG
// ============================================================

export function loadConfig(): SociaConfig {
	if (!existsSync(CONFIG_FILE)) {
		return { apiUrl: 'https://backend.socia.you' }
	}
	try {
		return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
	} catch {
		return { apiUrl: 'https://backend.socia.you' }
	}
}

function ensureConfigDir(): void {
	ensureDirSync(CONFIG_DIR)
	if (process.platform !== 'win32') {
		try {
			chmodSync(CONFIG_DIR, 0o700)
		} catch {
			// Non-fatal: some filesystems do not support POSIX permissions.
		}
	}
}

export function saveConfig(config: SociaConfig): void {
	ensureConfigDir()
	writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), {
		encoding: 'utf-8',
		mode: 0o600,
	})
	if (process.platform !== 'win32') {
		try {
			chmodSync(CONFIG_FILE, 0o600)
		} catch {
			// Non-fatal: some filesystems do not support POSIX permissions.
		}
	}
}

export function clearToken(): void {
	const config = loadConfig()
	delete config.token
	delete config.refreshToken
	delete config.userId
	delete config.username
	saveConfig(config)
}

/** Device id used for both login and refresh (server binds refresh to it). */
export const CLI_DEVICE_ID = 'socia-cli'

/** Accept both the current backend field and the legacy snake_case one. */
export function readRefreshToken(data: {
	refreshToken?: unknown
	refresh_token?: unknown
}): string | undefined {
	const value = data.refreshToken ?? data.refresh_token
	return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Request body for `POST /api/auth/refresh` (backend expects snake_case). */
export function buildRefreshBody(refreshToken: string): {
	refresh_token: string
	device_id: string
} {
	return { refresh_token: refreshToken, device_id: CLI_DEVICE_ID }
}

/**
 * Exchange the stored refresh token for a new access token.
 *
 * Returns `null` when there is no refresh token or the server rejects
 * it (expired/revoked) — the caller should then ask the user to run
 * `socia login` again. Rotates the refresh token on success.
 */
export async function refreshAccessToken(): Promise<string | null> {
	const config = loadConfig()
	if (!config.refreshToken) return null

	try {
		const res = await fetch(`${config.apiUrl}/api/auth/refresh`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(buildRefreshBody(config.refreshToken)),
			signal: AbortSignal.timeout(30_000),
		})
		if (!res.ok) return null

		const data = (await res.json()) as {
			token?: unknown
			refreshToken?: unknown
			refresh_token?: unknown
		}
		if (typeof data.token !== 'string' || !data.token) return null

		const updated = loadConfig()
		updated.token = data.token
		const nextRefreshToken = readRefreshToken(data)
		if (nextRefreshToken) updated.refreshToken = nextRefreshToken
		saveConfig(updated)
		return data.token
	} catch {
		return null
	}
}

/** Fail fast with an actionable message when the user is not signed in. */
export function requireLogin(): SociaConfig & { token: string } {
	const config = loadConfig()
	if (!config.token) {
		throw new Error('Not signed in. Run `socia login` first.')
	}
	return config as SociaConfig & { token: string }
}

// ============================================================
// SIGNING KEY
// ============================================================

/**
 * On-disk representation of the developer's Ed25519 signing key.
 *
 * Both fields are base64-encoded raw bytes:
 *   - `privateKey`: 32-byte seed.
 *   - `publicKey`:  32-byte compressed point.
 */
export interface StoredSigningKey {
	privateKey: string
	publicKey: string
}

/**
 * Check if a signing key is present in `~/.socia/`.
 *
 * Used by `socia build` / `socia deploy` to fail fast if the
 * developer has not run `socia keygen` yet.
 */
export function hasSigningKey(): boolean {
	return existsSync(SIGNING_KEY_FILE)
}

/**
 * Load the signing key from `~/.socia/signing_key`.
 *
 * Throws if the file is missing or malformed. Callers that want
 * a soft check should use `hasSigningKey()` first.
 */
export function loadSigningKey(): StoredSigningKey {
	if (!existsSync(SIGNING_KEY_FILE)) {
		throw new Error('Signing key not found. Run `socia keygen` first.')
	}

	const raw = readFileSync(SIGNING_KEY_FILE, 'utf-8').trim()

	// The file is a single JSON object: { privateKey, publicKey }.
	let parsed: { privateKey?: string; publicKey?: string }
	try {
		parsed = JSON.parse(raw)
	} catch {
		throw new Error(
			'Signing key file is corrupted. Run `socia keygen --force` to regenerate.',
		)
	}

	if (!parsed.privateKey || !parsed.publicKey) {
		throw new Error(
			'Signing key file is incomplete. Run `socia keygen --force` to regenerate.',
		)
	}

	return {
		privateKey: parsed.privateKey,
		publicKey: parsed.publicKey,
	}
}

/**
 * Save the signing key to `~/.socia/signing_key`.
 *
 * On POSIX, chmods the file to 0600 so only the owner can read it.
 * On Windows this is a no-op — file ACLs are inherited from the
 * user's home directory.
 *
 * Writes `signing_key.pub` alongside as a convenience: the public
 * key in plain base64, for copy-pasting into the registry UI or
 * into `manifest.json` by hand.
 */
export function saveSigningKey(key: StoredSigningKey): void {
	ensureConfigDir()

	const privatePath = SIGNING_KEY_FILE
	const publicPath = SIGNING_KEY_PUB_FILE

	const payload = JSON.stringify(
		{
			privateKey: key.privateKey,
			publicKey: key.publicKey,
		},
		null,
		2,
	)

	writeFileSync(privatePath, payload, 'utf-8')
	writeFileSync(publicPath, key.publicKey, 'utf-8')

	// Best-effort chmod. Windows will throw ENOSYS / EPERM — ignore.
	if (process.platform !== 'win32') {
		try {
			chmodSync(privatePath, 0o600)
		} catch {
			// Non-fatal: some filesystems (FAT, network shares) do not
			// support POSIX permissions.
		}
	}
}

/**
 * Delete the signing key files from `~/.socia/`.
 *
 * Used by `socia keygen --force` before writing a fresh keypair.
 */
export function clearSigningKey(): void {
	for (const path of [SIGNING_KEY_FILE, SIGNING_KEY_PUB_FILE]) {
		if (existsSync(path)) {
			try {
				fsExtra.removeSync(path)
			} catch {
				// Non-fatal.
			}
		}
	}
}

// Re-export key codecs for callers that build the stored payload.
export { decodeKey, encodeKey }
