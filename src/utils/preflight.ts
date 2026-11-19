import { loadConfig, refreshAccessToken } from './auth.js'

/**
 * Состояние приложения в «Сфере» на момент открытия UI деплоя.
 *
 *   - `not_found` — приложения нет (первый деплой);
 *   - `pending`   — есть pending-версия (перевыпуск);
 *   - `published` / `rejected` / `suspended` — есть версия,
 *     можно публиковать новую.
 */
export type PreflightState =
	| 'not_found'
	| 'pending'
	| 'published'
	| 'rejected'
	| 'suspended'

export interface PreflightApp {
	/** Публичный идентификатор мини-аппа: `notes`, без `@`. */
	username: string

	name: string
	description: string | null
	category: string
	channel_url: string | null
	icon_url: string | null
	screenshots: string[]
	status: string
	developer_username: string | null
	updated_at: string
}

export interface PreflightVersion {
	version: string
	size: number
	changelog: string | null
	uploaded_at: string
}

export interface PreflightResponse {
	state: PreflightState
	app: PreflightApp | null
	pending_version: PreflightVersion | null
}

/**
 * Why a preflight request failed. Kept separate from `state` so the
 * caller can tell "app does not exist" (a normal first deploy) from
 * "token expired" or "backend is down" (actionable errors).
 */
export type PreflightFailureReason =
	| 'not_signed_in'
	| 'unauthorized'
	| 'forbidden'
	| 'not_found'
	| 'network'

export type PreflightResult =
	| { ok: true; data: PreflightResponse }
	| { ok: false; reason: PreflightFailureReason; message: string }

/**
 * Asks the backend for the app state by username.
 *
 * A 401 is retried once with a refreshed access token (the CLI stores
 * a refresh token). Anything that is not a successful JSON response
 * is surfaced to the caller instead of being silently mapped to
 * "new app" — otherwise an expired session looks like a first deploy.
 */
export async function preflight(username: string): Promise<PreflightResult> {
	const config = loadConfig()
	const apiUrl = config.apiUrl
	const clean = username.trim().toLowerCase()

	if (!config.token) {
		return {
			ok: false,
			reason: 'not_signed_in',
			message: 'Not signed in. Run `socia login` first.',
		}
	}
	if (!clean) {
		return { ok: false, reason: 'not_found', message: 'Empty username.' }
	}

	const request = async (token: string): Promise<Response> =>
		fetch(`${apiUrl}/api/sphere/preflight/${encodeURIComponent(clean)}`, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/json',
			},
			signal: AbortSignal.timeout(15_000),
		})

	try {
		let token = config.token
		let res = await request(token)

		if (res.status === 401) {
			const refreshed = await refreshAccessToken()
			if (refreshed) {
				token = refreshed
				res = await request(token)
			}
		}

		if (res.status === 401) {
			return {
				ok: false,
				reason: 'unauthorized',
				message: 'Session expired. Run `socia login` again.',
			}
		}
		if (res.status === 403) {
			return {
				ok: false,
				reason: 'forbidden',
				message: 'This app belongs to another developer.',
			}
		}
		if (res.status === 404) {
			return {
				ok: false,
				reason: 'not_found',
				message: 'Preflight endpoint returned 404 — the backend is too old.',
			}
		}
		if (!res.ok) {
			return {
				ok: false,
				reason: 'network',
				message: `Preflight failed: HTTP ${res.status}.`,
			}
		}

		const data = (await res.json()) as PreflightResponse
		return { ok: true, data }
	} catch (e) {
		return {
			ok: false,
			reason: 'network',
			message:
				e instanceof Error
					? `Cannot reach ${apiUrl}: ${e.message}`
					: `Cannot reach ${apiUrl}.`,
		}
	}
}
