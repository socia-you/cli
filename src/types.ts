export interface MiniAppManifest {
	/**
	 * Публичный идентификатор мини-аппа. Lower-case, 3..32, `[a-z0-9_]`.
	 * Не начинается и не заканчивается на `_`.
	 *
	 * Единый namespace с users/chats/reserved — занятость проверяется
	 * на бэке через GET /api/sphere/check_username.
	 *
	 * Не меняется после первого деплоя: это identity приложения.
	 */
	username: string

	name: string
	version: string
	entry: string
	backend?: {
		base_url: string
		allowed_paths: string[]
		allowed_methods: string[]
		timeout_sec?: number
		headers?: Record<string, string>
	}
	permissions?: string[]
}

export interface BuildOptions {
	output?: string
	signKey?: string
	skipVite?: boolean
}
