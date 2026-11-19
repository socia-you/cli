import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'

import express from 'express'
import {
	localRequestGuard,
	requireLocalSecret,
} from '../dist/utils/local-http.js'

function startServer() {
	return new Promise(resolve => {
		let port = 0
		const app = express()
		app.use(localRequestGuard(() => port))
		app.get('/open', (_req, res) => res.json({ ok: true }))
		app.post('/secret', requireLocalSecret('local-secret'), (_req, res) =>
			res.json({ ok: true }),
		)
		const server = app.listen(0, '127.0.0.1', () => {
			port = server.address().port
			resolve({ server, port })
		})
	})
}

function getWithHost(port, host) {
	return new Promise((resolve, reject) => {
		const req = request(
			{ host: '127.0.0.1', port, path: '/open', headers: { Host: host } },
			res => {
				res.resume()
				res.on('end', () => resolve(res.statusCode))
			},
		)
		req.on('error', reject)
		req.end()
	})
}

test('local server rejects foreign hosts and cross-site writes', async () => {
	const { server, port } = await startServer()
	const base = `http://127.0.0.1:${port}`
	try {
		assert.equal((await fetch(`${base}/open`)).status, 200)
		assert.equal(await getWithHost(port, 'evil.test'), 403)
		assert.equal(
			(await fetch(`${base}/secret`, { method: 'POST' })).status,
			403,
		)
		assert.equal(
			(
				await fetch(`${base}/secret`, {
					method: 'POST',
					headers: {
						'X-Socia-Local': 'local-secret',
						Origin: 'https://evil.test',
					},
				})
			).status,
			403,
		)
		assert.equal(
			(
				await fetch(`${base}/secret`, {
					method: 'POST',
					headers: { 'X-Socia-Local': 'local-secret' },
				})
			).status,
			200,
		)
	} finally {
		await new Promise(resolve => server.close(resolve))
	}
})
