import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import { createHash, randomBytes } from 'crypto'
import fsExtra from 'fs-extra'

const { readFileSync, writeFileSync } = fsExtra

// `@noble/ed25519` uses SHA-512 internally but does not ship a hash
// implementation to stay 0-dependency. We supply one.
// `@noble/hashes` keeps the CLI portable to environments where
// `node:crypto` is unavailable (e.g. the browser-based `socia dev`).
ed.hashes.sha512 = sha512

/**
 * Ed25519 keypair used to sign `.socia` packages.
 *
 * - `privateKey`: 32-byte seed (Uint8Array).
 * - `publicKey`: 32-byte compressed point (Uint8Array).
 */
export interface SigningKeypair {
	privateKey: Uint8Array
	publicKey: Uint8Array
}

/**
 * Generate a fresh Ed25519 keypair.
 *
 * The private key is a 32-byte random seed. The public key is
 * derived deterministically. Both are returned as raw `Uint8Array`s —
 * the CLI stores them on disk as base64-encoded strings.
 */
export function generateKeypair(): SigningKeypair {
	const privateKey = randomBytes(32)
	const publicKey = ed.getPublicKey(privateKey)

	return { privateKey, publicKey }
}

/**
 * Compute the package digest — a SHA-256 hash over every file in
 * the package, in sorted order, with `\0` separators.
 *
 * This is what gets signed. It is NOT the signature itself.
 *
 * Format (matches the old HMAC preimage, minus the key):
 *   for each file (sorted by path):
 *     path + "\0" + bytes + "\0"
 *
 * The digest is returned as a 32-byte Uint8Array.
 */
export function computeDigest(
	files: { path: string; bytes: Buffer }[],
): Uint8Array {
	const hash = createHash('sha256')

	// Sort by UTF-16 code unit, NOT by locale. The Flutter client
	// uses Dart's String.compareTo, which is a plain code-unit
	// comparison. localeCompare() can order punctuation differently
	// (e.g. `-` vs `.`), producing a different digest and breaking
	// signature verification.
	const sorted = [...files].sort((a, b) =>
		a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
	)

	for (const file of sorted) {
		hash.update(file.path)
		hash.update('\0')
		hash.update(file.bytes)
		hash.update('\0')
	}

	return new Uint8Array(hash.digest())
}

/**
 * Sign a package with the developer's Ed25519 private key.
 *
 * Returns the 64-byte signature (Uint8Array).
 */
export function signFiles(
	files: { path: string; bytes: Buffer }[],
	privateKey: Uint8Array,
): Uint8Array {
	const digest = computeDigest(files)
	return ed.sign(digest, privateKey)
}

/**
 * Write `signature.bin` into the package staging directory.
 *
 * The signature is stored as base64-encoded text. This is the file
 * the client reads at install time to verify the package.
 */
export function writeSignature(targetDir: string, signature: Uint8Array): void {
	const encoded = Buffer.from(signature).toString('base64')
	const path = `${targetDir}/signature.bin`
	writeFileSync(path, encoded, 'utf-8')
}

/**
 * Read and verify a signature against a package.
 *
 * Used by the CLI for debugging — the real verification happens
 * in the Flutter client.
 *
 * Returns `true` if the signature is valid for the given files
 * and public key.
 */
export function verifySignature(
	files: { path: string; bytes: Buffer }[],
	publicKey: Uint8Array,
	signatureBase64: string,
): boolean {
	const signature = new Uint8Array(Buffer.from(signatureBase64, 'base64'))
	const digest = computeDigest(files)
	return ed.verify(signature, digest, publicKey)
}

/**
 * Encode a raw key (32 or 64 bytes) as base64 for storage.
 */
export function encodeKey(key: Uint8Array): string {
	return Buffer.from(key).toString('base64')
}

/**
 * Decode a base64-encoded key back to bytes.
 */
export function decodeKey(encoded: string): Uint8Array {
	return new Uint8Array(Buffer.from(encoded, 'base64'))
}

// Re-export for convenience.
export { ed as nobleEd25519 }
