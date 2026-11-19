import { createRequire } from 'node:module'

/**
 * Single source of truth for the CLI version: `package.json`.
 *
 * Both binaries (`socia` and `create-socia-sphere`) read it from here,
 * so `npm version` cannot leave one of them behind. Resolved relative
 * to this module, which works from both `src/utils/` and `dist/utils/`.
 */
const require = createRequire(import.meta.url)
const pkg = require('../../package.json') as { version: string }

export const CLI_VERSION: string = pkg.version
