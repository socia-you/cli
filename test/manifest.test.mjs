import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
	isValidAppUsername,
	isValidManifestVersion,
	isValidNewAppUsername,
	loadManifest,
} from '../dist/utils/manifest.js'

test('new app usernames are 6..32 chars', () => {
	assert.equal(isValidNewAppUsername('notes'), false, '5 chars is too short')
	assert.equal(isValidNewAppUsername('notes_'), false, 'trailing underscore')
	assert.equal(isValidNewAppUsername('_notes'), false, 'leading underscore')
	assert.equal(isValidNewAppUsername('notes_app'), true)
	assert.equal(isValidNewAppUsername('a'.repeat(6)), true)
	assert.equal(isValidNewAppUsername('a'.repeat(32)), true)
	assert.equal(isValidNewAppUsername('a'.repeat(33)), false)
	assert.equal(isValidNewAppUsername('Notes'), false, 'uppercase is rejected')
})

test('existing short usernames still pass the general validator', () => {
	assert.equal(isValidAppUsername('notes'), true)
	assert.equal(isValidAppUsername('ab'), false)
})

test('manifest versions cannot escape paths or inject terminal output', () => {
	assert.equal(isValidManifestVersion('1.2.0'), true)
	assert.equal(isValidManifestVersion('1.2.0-beta+1'), true)
	assert.equal(isValidManifestVersion('../escape'), false)
	assert.equal(isValidManifestVersion('1.0.0\nInjected'), false)
	assert.equal(isValidManifestVersion('a/b'), false)
	assert.equal(isValidManifestVersion('.'), false)
	assert.equal(isValidManifestVersion('..'), false)
	assert.equal(isValidManifestVersion(''), false)
	assert.equal(isValidManifestVersion(123), false)
})

test('loadManifest rejects an unsafe version', () => {
	const dir = mkdtempSync(join(tmpdir(), 'socia-manifest-'))
	try {
		writeFileSync(
			join(dir, 'manifest.json'),
			JSON.stringify({
				username: 'notes_app',
				version: '..',
				entry: 'index.html',
				permissions: ['network'],
			}),
		)
		assert.throws(() => loadManifest(dir), /manifest\.version/)
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
})

test('backend requires the network permission', () => {
	const dir = mkdtempSync(join(tmpdir(), 'socia-manifest-'))
	const manifestPath = join(dir, 'manifest.json')
	const base = {
		username: 'notes_app',
		version: '0.1.0',
		entry: 'index.html',
		backend: { base_url: 'https://backend.socia.you' },
	}

	try {
		writeFileSync(manifestPath, JSON.stringify(base))
		assert.throws(() => loadManifest(dir), /network/)

		writeFileSync(
			manifestPath,
			JSON.stringify({ ...base, permissions: ['network'] }),
		)
		assert.equal(loadManifest(dir).username, 'notes_app')
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
})
