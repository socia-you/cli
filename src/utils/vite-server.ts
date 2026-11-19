import { spawn, type ChildProcess } from 'child_process'
import { createServer } from 'net'

/**
 * A running Vite dev server.
 */
export interface ViteHandle {
	/** Port the server is listening on. */
	port: number
	/** Base URL, e.g. `http://localhost:5173`. */
	url: string
	/** Child process handle. */
	process: ChildProcess
	/** Stop the server gracefully. */
	stop: () => Promise<void>
}

/**
 * Find a free TCP port by asking the OS to assign one.
 *
 * Closes the probe socket immediately, then returns the port. There
 * is a small race window — another process could grab the port
 * between the probe and the actual bind — but for a local dev
 * server this is not a concern.
 */
export function findFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = createServer()
		srv.unref()
		srv.on('error', reject)
		srv.listen(0, '127.0.0.1', () => {
			const addr = srv.address()
			if (typeof addr === 'object' && addr) {
				const port = addr.port
				srv.close(() => resolve(port))
			} else {
				srv.close(() => reject(new Error('Could not allocate a port')))
			}
		})
	})
}

/**
 * Start a Vite dev server in `projectDir`.
 *
 * Picks a free port, spawns `npm run dev -- --port <port>`, and
 * waits until the server responds on `http://localhost:<port>`.
 *
 * `onProgress` is called with human-readable status lines. The
 * caller decides how to render them.
 */
export async function startViteServer(
	projectDir: string,
	onProgress?: (line: string) => void,
): Promise<ViteHandle> {
	const port = await findFreePort()
	const url = `http://localhost:${port}`

	const isWindows = process.platform === 'win32'
	const command = isWindows ? 'npm.cmd' : 'npm'

	const proc = spawn(command, ['run', 'dev', '--', '--port', String(port)], {
		cwd: projectDir,
		stdio: ['ignore', 'pipe', 'pipe'],
		shell: isWindows,
	})

	// Swallow stdout but keep a small buffer for error reporting.
	let stderr = ''
	proc.stdout?.on('data', () => {})
	proc.stderr?.on('data', chunk => {
		stderr += chunk.toString()
	})

	proc.on('error', err => {
		onProgress?.(`Vite failed to start: ${err.message}`)
	})

	// Wait for the server to accept connections.
	const ready = await waitForServer(url, 30_000, onProgress)
	if (!ready) {
		proc.kill('SIGTERM')
		throw new Error(
			`Vite did not start within 30s.${stderr ? `\n${stderr}` : ''}`,
		)
	}

	onProgress?.(`Vite ready at ${url}`)

	const stop = (): Promise<void> => {
		return new Promise(resolve => {
			if (proc.exitCode !== null || proc.killed) {
				resolve()
				return
			}

			const timer = setTimeout(() => {
				// Force kill if it does not exit in 3 seconds.
				try {
					proc.kill('SIGKILL')
				} catch {
					// ignore
				}
				resolve()
			}, 3000)

			proc.once('close', () => {
				clearTimeout(timer)
				resolve()
			})

			try {
				proc.kill('SIGTERM')
			} catch {
				clearTimeout(timer)
				resolve()
			}
		})
	}

	return { port, url, process: proc, stop }
}

/**
 * Poll `url` until it responds or the timeout runs out.
 */
async function waitForServer(
	url: string,
	timeoutMs: number,
	onProgress?: (line: string) => void,
): Promise<boolean> {
	const start = Date.now()
	let attempts = 0

	while (Date.now() - start < timeoutMs) {
		attempts++
		try {
			const res = await fetch(url, {
				method: 'GET',
				signal: AbortSignal.timeout(2000),
			})
			// Any response — even 404 — means the server is up.
			if (res.status >= 200) return true
		} catch {
			// Not ready yet.
		}

		// Log every 5th attempt to avoid noise.
		if (attempts % 5 === 0) {
			const elapsed = ((Date.now() - start) / 1000).toFixed(1)
			onProgress?.(`Waiting for Vite… (${elapsed}s)`)
		}

		await new Promise(r => setTimeout(r, 200))
	}

	return false
}
