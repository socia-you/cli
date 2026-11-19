import { randomBytes } from 'crypto'
import type { RequestHandler } from 'express'

/** All CLI development servers listen on loopback only. */
export const LOCAL_HOST = '127.0.0.1'

export function createLocalSecret(): string {
	return randomBytes(32).toString('hex')
}

/**
 * Reject requests whose Host/Origin do not belong to this local server.
 *
 * Binding to 127.0.0.1 prevents LAN access. The Host check also blocks
 * DNS-rebinding pages, while the Origin check blocks cross-site form/fetch
 * requests from pages opened in the developer's browser.
 */
export function localRequestGuard(getPort: () => number): RequestHandler {
	return (req, res, next) => {
		const port = getPort()
		if (!port) {
			res.status(503).json({ error: 'Server is starting' })
			return
		}

		const allowedHosts = new Set([
			`${LOCAL_HOST}:${port}`,
			`localhost:${port}`,
		])
		const host = (req.headers.host ?? '').toLowerCase()
		if (!allowedHosts.has(host)) {
			res.status(403).json({ error: 'Forbidden' })
			return
		}

		const origin = req.headers.origin
		if (origin) {
			try {
				const parsed = new URL(origin)
				if (
					parsed.protocol !== 'http:' ||
					(parsed.hostname !== LOCAL_HOST && parsed.hostname !== 'localhost') ||
					parsed.port !== String(port)
				) {
					res.status(403).json({ error: 'Forbidden' })
					return
				}
			} catch {
				res.status(403).json({ error: 'Forbidden' })
				return
			}
		}

		next()
	}
}

/**
 * Require a per-run secret on state-changing routes.
 *
 * The secret is rendered into the local page and sent as a custom header.
 * A cross-origin page cannot read it, so it cannot forge a publish/login
 * request even if it can reach the loopback port.
 */
export function requireLocalSecret(secret: string): RequestHandler {
	return (req, res, next) => {
		if (req.get('x-socia-local') !== secret) {
			res.status(403).json({ error: 'Forbidden' })
			return
		}
		next()
	}
}
