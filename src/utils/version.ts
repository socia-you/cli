/**
 * Semantic version bump helpers.
 *
 * A version is a string like `1.2.3`. This module parses it, bumps
 * one of the three segments, and re-serializes. Pre-release tags
 * (`1.2.3-beta.1`) and build metadata (`1.2.3+abc`) are NOT supported
 * — Sphere manifests use plain `X.Y.Z`.
 */

export type BumpKind = 'patch' | 'minor' | 'major'

export interface ParsedVersion {
	major: number
	minor: number
	patch: number
}

/**
 * Parse a `X.Y.Z` string. Throws on anything else.
 */
export function parseVersion(raw: string): ParsedVersion {
	const trimmed = raw.trim()
	const parts = trimmed.split('.')

	if (parts.length !== 3) {
		throw new Error(
			`Invalid version "${raw}". Expected format: MAJOR.MINOR.PATCH (e.g. 1.2.3).`,
		)
	}

	const numbers = parts.map(p => {
		if (!/^\d+$/.test(p)) {
			throw new Error(
				`Invalid version "${raw}". Each segment must be a non-negative integer.`,
			)
		}
		return parseInt(p, 10)
	})

	return {
		major: numbers[0],
		minor: numbers[1],
		patch: numbers[2],
	}
}

/**
 * Bump a parsed version.
 *
 * - `patch`: 1.2.3 → 1.2.4
 * - `minor`: 1.2.3 → 1.3.0
 * - `major`: 1.2.3 → 2.0.0
 *
 * Lower segments are reset to zero when a higher one is bumped.
 */
export function bumpVersion(v: ParsedVersion, kind: BumpKind): ParsedVersion {
	switch (kind) {
		case 'patch':
			return { major: v.major, minor: v.minor, patch: v.patch + 1 }
		case 'minor':
			return { major: v.major, minor: v.minor + 1, patch: 0 }
		case 'major':
			return { major: v.major + 1, minor: 0, patch: 0 }
	}
}

/**
 * Serialize a parsed version back to `X.Y.Z`.
 */
export function formatVersion(v: ParsedVersion): string {
	return `${v.major}.${v.minor}.${v.patch}`
}

/**
 * Convenience: parse, bump, format. Throws on invalid input.
 */
export function bumpVersionString(raw: string, kind: BumpKind): string {
	return formatVersion(bumpVersion(parseVersion(raw), kind))
}
