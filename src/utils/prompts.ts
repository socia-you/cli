import inquirer from 'inquirer'
import { resolve } from 'path'
import { loadConfig } from './auth.js'
import { logger } from './logger.js'
import { isValidNewAppUsername } from './manifest.js'
import { colors } from './theme.js'

/**
 * Answers collected from the interactive CLI wizard.
 */
export interface ProjectAnswers {
	/** Folder name, e.g. `my-app`. Также дефолт для username. */
	projectName: string

	/** Публичный идентификатор мини-аппа: `notes`, без `@`. */
	username: string

	/** Template folder inside `templates/`. */
	framework: 'svelte5-ts'

	/** Absolute path to the new project folder. */
	targetDir: string

	/** Whether to run `npm install` right after scaffolding. */
	installDeps: boolean

	/** Whether to start the dev server when install finishes. */
	startDev: boolean
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

/** `my-app`, `hamster`, `my-cool-app-2` — lowercase, digits, dashes. */
const NAME_RE = /^[a-z][a-z0-9-]*$/

// -----------------------------------------------------------------------------
// Backend check
// -----------------------------------------------------------------------------

interface CheckUsernameResponse {
	username: string
	available: boolean
}

/**
 * Спрашивает у бэка, свободен ли username.
 *
 * Возвращает:
 *   - `true`  — свободно;
 *   - `false` — занято (в users / chats / sphere_apps / reserved);
 *   - `null`  — не удалось проверить (нет токена, сеть упала,
 *     эндпоинт не поднят). CLI в этом случае пропускает проверку
 *     и просто предупреждает — бэк всё равно отклонит деплой,
 *     если username занят, но лучше узнать об этом сразу.
 */
async function checkUsernameOnBackend(
	username: string,
): Promise<boolean | null> {
	const config = loadConfig()
	if (!config.token || !config.apiUrl) {
		return null
	}

	try {
		const url = `${config.apiUrl}/api/sphere/check_username?u=${encodeURIComponent(username)}`
		const res = await fetch(url, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${config.token}`,
				Accept: 'application/json',
			},
			signal: AbortSignal.timeout(10_000),
		})

		if (!res.ok) return null

		const data = (await res.json()) as CheckUsernameResponse
		return data.available === true
	} catch {
		return null
	}
}

// -----------------------------------------------------------------------------
// Runner
// -----------------------------------------------------------------------------

/**
 * Ask the user a short series of questions and return the answers.
 *
 * Если `initialName` передан — вопрос про projectName пропускается.
 * Username всё равно спрашиваем отдельно: имя папки и публичный
 * идентификатор — разные вещи.
 */
export async function runPrompts(
	initialName?: string,
): Promise<ProjectAnswers> {
	const questions: any[] = []

	// 1. Project name (folder + display default).
	if (!initialName) {
		questions.push({
			type: 'input',
			name: 'projectName',
			message: 'Project name (folder)',
			default: 'my-socia-app',
			prefix: colors.dim('›'),
			validate: (input: string) => {
				const v = input.trim()
				if (!v) return 'Project name is required.'
				if (!NAME_RE.test(v)) {
					return (
						'Use lowercase letters, digits, and dashes only. ' +
						'Must start with a letter.'
					)
				}
				if (v.length > 64) {
					return 'Keep the name under 64 characters.'
				}
				return true
			},
		})
	}

	// 2. Username — публичный @notes.
	//
	// Нельзя поменять после первого деплоя, поэтому сразу
	// объясняем и проверяем занятость на бэке (если залогинен).
	questions.push({
		type: 'input',
		name: 'username',
		message: 'App username (@notes)',
		default: (answers: any) => {
			const base = normalizeUsername(
				answers.projectName ?? initialName ?? '',
			)
			if (base.length >= 6) return base
			return `${base || 'my'}_app`.slice(0, 32)
		},
		prefix: colors.dim('›'),
		validate: (input: string) => {
			const clean = normalizeUsername(input)
			if (!isValidNewAppUsername(clean)) {
				return (
					'Expected 6..32 chars, lowercase [a-z0-9_], ' +
					'must not start or end with "_".'
				)
			}
			return true
		},
	})

	// 3. Install dependencies now?
	questions.push({
		type: 'confirm',
		name: 'installDeps',
		message: 'Install dependencies now?',
		default: true,
		prefix: colors.dim('›'),
	})

	// 4. Start the dev server when done?
	questions.push({
		type: 'confirm',
		name: 'startDev',
		message: 'Start the dev server after install?',
		default: true,
		prefix: colors.dim('›'),
		when: (answers: any) => answers.installDeps === true,
	})

	const answers = await inquirer.prompt(questions)

	const projectName =
		initialName?.trim() ?? (answers.projectName as string).trim()

	// `socia create <name>` skips inquirer validation, so validate the
	// supplied name here as well. It becomes both a directory name and a
	// value interpolated into generated JSON files.
	if (!projectName) throw new Error('Project name is required.')
	if (!NAME_RE.test(projectName)) {
		throw new Error(
			'Project name must start with a letter and contain only lowercase ' +
				'letters, digits, and dashes.',
		)
	}
	if (projectName.length > 64) {
		throw new Error('Keep the project name under 64 characters.')
	}

	const username = normalizeUsername(answers.username as string)

	// 5. Проверка занятости на бэке.
	//
	// inquirer не умеет async-validate для повторного вопроса,
	// поэтому проверяем после промптов. Если занято — просто
	// предупреждаем и даём шанс исправить manifest.json до деплоя.
	// Это не блокирует scaffold: у разработчика может не быть
	// токена, а создавать проект локально всё равно можно.
	const available = await checkUsernameOnBackend(username)

	if (available === false) {
		logger.warn(
			`Username "${username}" is already taken (user, channel, or another app).`,
		)
		logger.info('You can change it in manifest.json before the first deploy.')
	} else if (available === null) {
		logger.info(
			'Could not check username availability — not signed in or backend unreachable.',
		)
		logger.info(
			'Run `socia login` to enable the check. The backend will still reject the deploy if the username is taken.',
		)
	} else {
		logger.success(`Username "${username}" is available.`)
	}

	const targetDir = resolve(process.cwd(), projectName)

	return {
		projectName,
		username,
		framework: 'svelte5-ts',
		targetDir,
		installDeps: answers.installDeps === true,
		startDev: answers.startDev === true,
	}
}

/**
 * Нормализует username:
 *   - trim;
 *   - lower-case;
 *   - убирает ведущую `@`;
 *   - dashes → underscores (юзер мог по привычке написать `my-app`,
 *     а в username дефисы запрещены).
 */
function normalizeUsername(raw: string): string {
	return raw.trim().toLowerCase().replace(/^@/, '').replace(/-/g, '_')
}
