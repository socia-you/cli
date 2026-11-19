import test from 'node:test'
import assert from 'node:assert/strict'

import { buildRefreshBody, readRefreshToken } from '../dist/utils/auth.js'

test('reads the backend camelCase refresh token', () => {
	assert.equal(
		readRefreshToken({ refreshToken: 'rotated-token' }),
		'rotated-token',
	)
})

test('keeps accepting the legacy snake_case field', () => {
	assert.equal(
		readRefreshToken({ refresh_token: 'legacy-token' }),
		'legacy-token',
	)
})

test('prefers camelCase when both fields are present', () => {
	assert.equal(
		readRefreshToken({
			refreshToken: 'new-token',
			refresh_token: 'old-token',
		}),
		'new-token',
	)
})

test('ignores missing or non-string refresh tokens', () => {
	assert.equal(readRefreshToken({}), undefined)
	assert.equal(readRefreshToken({ refreshToken: 42 }), undefined)
	assert.equal(readRefreshToken({ refreshToken: '' }), undefined)
})

test('sends the refresh token in the backend request field', () => {
	assert.deepEqual(buildRefreshBody('stored-token'), {
		refresh_token: 'stored-token',
		device_id: 'socia-cli',
	})
})
