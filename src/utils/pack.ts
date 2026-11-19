import { createWriteStream } from 'fs'
import fsExtra from 'fs-extra'
import { join, relative } from 'path'
import { pipeline } from 'stream/promises'
import * as tar from 'tar'
import { createBrotliCompress, constants as zlibConstants } from 'zlib'

const { readdirSync, lstatSync, readFileSync } = fsExtra

/** Product and server-side limits; checked before any file is read. */
export const MAX_PACKAGE_BYTES = 50 * 1024 * 1024
export const MAX_UNPACKED_BYTES = 128 * 1024 * 1024
export const MAX_FILES = 10_000

/**
 * Collect every file under `dir` (recursively).
 *
 * Returns each file's relative POSIX path plus its raw bytes. Used
 * both for building the tar stream and for computing the HMAC signature
 * over the exact same data.
 *
 * Symlinks are rejected: following one could read files outside the
 * project or turn a small manifest into an arbitrary local file upload.
 * The file count and unpacked size are capped before reading bytes so a
 * malicious or accidental `dist` cannot exhaust memory.
 */
export function collectFiles(
	dir: string,
	baseDir: string = dir,
): { path: string; bytes: Buffer }[] {
	const result: { path: string; bytes: Buffer }[] = []
	let fileCount = 0
	let totalBytes = 0

	const walk = (currentDir: string): void => {
		for (const entry of readdirSync(currentDir)) {
			const fullPath = join(currentDir, entry)
			const stat = lstatSync(fullPath)

			if (stat.isSymbolicLink()) {
				throw new Error(
					`Symlinks are not allowed in a Socia package: ${relative(baseDir, fullPath)}`,
				)
			}

			if (stat.isDirectory()) {
				walk(fullPath)
				continue
			}

			if (!stat.isFile()) {
				throw new Error(
					`Unsupported file type in a Socia package: ${relative(baseDir, fullPath)}`,
				)
			}

			if (fileCount >= MAX_FILES) {
				throw new Error(
					`Package contains more than ${MAX_FILES.toLocaleString()} files. Remove unused assets and rebuild.`,
				)
			}
			totalBytes += stat.size
			if (totalBytes > MAX_UNPACKED_BYTES) {
				throw new Error(
					`Unpacked package is larger than ${MAX_UNPACKED_BYTES / 1024 / 1024} MB. Remove unused assets and rebuild.`,
				)
			}

			fileCount += 1
			const relativePath = relative(baseDir, fullPath).replace(/\\/g, '/')
			result.push({
				path: relativePath,
				bytes: readFileSync(fullPath),
			})
		}
	}

	walk(dir)
	return result
}

/**
 * Pack a directory into a `.tar.br` archive (tar + Brotli, quality 11).
 *
 * Why not ZIP?
 *   - ZIP uses Deflate, which compresses worse than Brotli on HTML,
 *     CSS, and JavaScript — especially when there are many small files
 *     (which is what `vite build` produces without `viteSingleFile`).
 *   - Brotli's static dictionary is tuned for web content, giving
 *     15–25% smaller output than Deflate on typical bundles.
 *
 * Quality 11 is the slowest but compresses the most. That is fine
 * here — the CLI runs on the developer's machine, once per deploy.
 * Decompression on the client is fast (it does not depend on quality).
 *
 * The resulting `.socia` file is a single binary blob that the host
 * app unpacks into a folder and loads via `loadFileUrl`.
 */
export async function createTarBr(
	sourceDir: string,
	outputPath: string,
): Promise<void> {
	// `tar.c` with `cwd` + a file list returns a readable stream.
	// We feed it into Brotli and write the compressed output to disk.
	const tarStream = tar.c(
		{
			gzip: false,
			cwd: sourceDir,
			portable: true,
			noMtime: true,
		},
		['.'],
	)

	const brotliStream = createBrotliCompress({
		params: {
			[zlibConstants.BROTLI_PARAM_QUALITY]: 11,
			[zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
		},
	})

	await pipeline(tarStream, brotliStream, createWriteStream(outputPath))
}
