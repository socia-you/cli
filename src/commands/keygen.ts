import {
	clearSigningKey,
	hasSigningKey,
	saveSigningKey,
} from '../utils/auth.js'
import { encodeKey, generateKeypair } from '../utils/sign.js'
import {
	colors,
	printInfo,
	printSuccess,
	printWarning,
} from '../utils/theme.js'

export interface KeygenOptions {
	/**
	 * Overwrite an existing key.
	 *
	 * Without this flag, `socia keygen` refuses to overwrite — the
	 * developer might accidentally invalidate every package they
	 * have ever signed.
	 */
	force?: boolean
}

/**
 * `socia keygen` — generate an Ed25519 signing keypair.
 *
 * Writes two files into `~/.socia/`:
 *   - `signing_key`      JSON with base64 private + public keys.
 *   - `signing_key.pub`  public key only, base64, for copy-paste.
 *
 * On POSIX, `signing_key` is chmod 0600 (owner-read only).
 *
 * The public key is printed to stdout so the developer can
 * register it on the Sphere backend.
 */
export async function keygenCommand(options: KeygenOptions): Promise<void> {
	if (hasSigningKey() && !options.force) {
		printWarning('A signing key already exists in ~/.socia/signing_key.')
		printInfo('')
		printInfo('Regenerating it will invalidate every package you have')
		printInfo('signed so far. Existing installs will fail to verify.')
		printInfo('')
		printInfo(
			`To overwrite anyway, run: ${colors.accent('socia keygen --force')}`,
		)
		process.exit(1)
	}

	if (hasSigningKey() && options.force) {
		printWarning('Overwriting the existing signing key.')
		clearSigningKey()
	}

	const { privateKey, publicKey } = generateKeypair()

	saveSigningKey({
		privateKey: encodeKey(privateKey),
		publicKey: encodeKey(publicKey),
	})

	const publicBase64 = encodeKey(publicKey)

	console.log('')
	printSuccess('Signing key generated.')
	console.log('')
	printInfo(`Private key:  ${colors.dim('~/.socia/signing_key')}`)
	printInfo(`Public key:   ${colors.dim('~/.socia/signing_key.pub')}`)
	console.log('')
	printInfo('Public key (base64):')
	console.log('')
	console.log(`  ${colors.accent(publicBase64)}`)
	console.log('')
	printInfo('Keep the private key safe. If you lose it, you will not')
	printInfo('be able to publish updates to apps you have already signed.')
	console.log('')
}
