import fsExtra from 'fs-extra'
import { join } from 'path'

const { existsSync, readFileSync } = fsExtra

export interface MiniAppDisplay {
	name: string | null
	description: string | null
	icon: string | null
	screenshots: string[]
	category: string
	channel_url: string | null
}

export interface MiniAppTab {
	id: string
	icon: string
	label?: string
}

export interface MiniAppTabbarStyle {
	background?: string
	borderColor?: string
	borderWidth?: number
	borderRadius?: number
	activeColor?: string
	inactiveColor?: string
	shadow?: 'soft' | 'hard' | 'none'
}

export interface MiniAppTabbarConfig {
	enabled?: boolean
	defaultTab?: string
	showBack?: boolean
	showSettings?: boolean
	style?: MiniAppTabbarStyle
	tabs?: MiniAppTab[]
}

/**
 * Screen orientation preference.
 *
 * - `auto`      — follow the device (default).
 * - `portrait`  — lock to portrait.
 * - `landscape` — lock to landscape.
 */
export type MiniAppOrientation = 'auto' | 'portrait' | 'landscape'

export interface MiniAppUiConfig {
	fullscreen?: boolean
	showHeader?: boolean
	orientation?: MiniAppOrientation
	tabbar?: MiniAppTabbarConfig
}

export interface MiniAppManifest {
	/**
	 * Публичный идентификатор мини-аппа. Lower-case, 3..32, `[a-z0-9_]`.
	 * Не начинается и не заканчивается на `_`.
	 *
	 * Не меняется после первого деплоя: identity приложения.
	 */
	username: string

	name?: string
	version: string
	entry: string
	display?: MiniAppDisplay
	ui?: MiniAppUiConfig
	backend?: {
		base_url: string
		allowed_paths: string[]
		allowed_methods: string[]
		timeout_sec?: number
		headers?: Record<string, string>
	}
	permissions?: string[]
}

/**
 * Username мини-аппа: только lower-case, 3..32, `[a-z0-9_]`,
 * не начинается и не заканчивается на `_`.
 *
 * Должно совпадать с `validation::is_valid_app_username` на бэке.
 */
const USERNAME_RE = /^[a-z0-9_]{3,32}$/

/** New app usernames: 6..32 chars (backend `MIN_NEW_USERNAME_LEN`). */
const NEW_USERNAME_RE = /^[a-z0-9_]{6,32}$/

export function isValidAppUsername(username: string): boolean {
	if (!USERNAME_RE.test(username)) return false
	if (username.startsWith('_') || username.endsWith('_')) return false
	return true
}

export function isValidNewAppUsername(username: string): boolean {
	if (!NEW_USERNAME_RE.test(username)) return false
	if (username.startsWith('_') || username.endsWith('_')) return false
	return true
}

/**
 * Version is used in file names, registry paths and terminal output.
 * Must match the backend's `is_valid_sphere_version` allow-list.
 */
const VERSION_RE = /^[0-9A-Za-z._+-]{1,64}$/

export function isValidManifestVersion(version: unknown): version is string {
	if (typeof version !== 'string') return false
	if (version === '.' || version === '..') return false
	return VERSION_RE.test(version)
}

export function loadManifest(projectDir: string): MiniAppManifest {
	const manifestPath = join(projectDir, 'manifest.json')

	if (!existsSync(manifestPath)) {
		throw new Error('manifest.json not found in the current folder')
	}

	const raw = readFileSync(manifestPath, 'utf-8')
	const manifest = JSON.parse(raw) as MiniAppManifest

	if (!manifest.username) {
		throw new Error(
			'manifest.username is required. ' +
				'Expected a lower-case identifier like "notes" (3..32 chars, [a-z0-9_]).',
		)
	}
	if (!isValidAppUsername(manifest.username)) {
		throw new Error(
			`manifest.username "${manifest.username}" is invalid. ` +
				'Expected 3..32 chars, lowercase [a-z0-9_], ' +
				'must not start or end with "_".',
		)
	}
	if (!manifest.version) throw new Error('manifest.version is required')
	if (!isValidManifestVersion(manifest.version)) {
		throw new Error(
			'manifest.version must be 1..64 characters: letters, digits, ".", "_", "+" or "-".',
		)
	}
	if (!manifest.entry) throw new Error('manifest.entry is required')

	if (manifest.permissions !== undefined && !Array.isArray(manifest.permissions)) {
		throw new Error('manifest.permissions must be an array')
	}
	if (manifest.backend && !manifest.permissions?.includes('network')) {
		throw new Error(
			'manifest.backend requires the "network" permission. ' +
				'Add "permissions": ["network"] to manifest.json.',
		)
	}

	return manifest
}
