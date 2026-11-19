import express from 'express'
import fsExtra from 'fs-extra'
import open from 'open'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadConfig, saveConfig } from '../utils/auth.js'
import {
	LOCAL_HOST,
	createLocalSecret,
	localRequestGuard,
	requireLocalSecret,
} from '../utils/local-http.js'
import { logger } from '../utils/logger.js'

const { removeSync } = fsExtra

/**
 * Renders the login page. Plain HTML + fetch to /api/login, which
 * the CLI proxies to the backend (avoids CORS).
 */
function buildLoginHtml(localSecret: string): string {
	const scripts = SCRIPTS.replace('__SOCIA_LOCAL_SECRET__', localSecret)
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>Sign in to Socia</title>
  <style>${STYLES}</style>
</head>
<body>
  <main class="box">
    <header class="head">
      <h1>Sign in to Socia</h1>
      <p class="sub">Sign in with your Socia account to continue.</p>
    </header>

    <form id="form">
      <div class="field">
        <label class="label" for="email">Email or username</label>
        <input
          type="text"
          id="email"
          autocomplete="username"
          spellcheck="false"
          required
          autofocus
        />
      </div>
      <div class="field">
        <label class="label" for="password">Password</label>
        <input
          type="password"
          id="password"
          autocomplete="current-password"
          required
        />
      </div>
      <button type="submit" id="btn" class="btn-primary">
        <span class="btn-label">Sign in</span>
        <span class="btn-spinner" aria-hidden="true"></span>
      </button>
      <div class="status" id="status" role="status" aria-live="polite"></div>
    </form>
  </main>

  <script>${scripts}</script>
</body>
</html>`
}

const STYLES = `
:root {
  color-scheme: dark;
  --bg: #000000;
  --surface: #0a0a0a;
  --surface-2: #111111;
  --surface-3: #161616;
  --border: rgba(255,255,255,0.08);
  --border-strong: rgba(255,255,255,0.14);
  --border-focus: rgba(255,255,255,0.35);
  --text: #ffffff;
  --text-muted: rgba(255,255,255,0.40);
  --text-dim: rgba(255,255,255,0.28);
  --success: #4ADE80;
  --danger: #FF3B30;
  --radius-md: 14px;
  --radius-pill: 999px;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --transition: 0.15s ease;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.box {
  width: 100%;
  max-width: 420px;
  padding: 40px 32px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 28px;
}
.head {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 32px;
}
h1 {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.4px;
}
.sub {
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-muted);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}
.label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--text-muted);
}
input {
  width: 100%;
  padding: 14px 16px;
  font-family: inherit;
  font-size: 14px;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  outline: none;
  transition: border-color var(--transition), background var(--transition);
}
input::placeholder { color: var(--text-dim); }
input:hover { border-color: var(--border-strong); }
input:focus { border-color: var(--border-focus); background: var(--surface-3); }
.btn-primary {
  width: 100%;
  height: 52px;
  margin-top: 8px;
  padding: 0 24px;
  font-family: inherit;
  font-size: 15px;
  font-weight: 600;
  color: #000000;
  background: #ffffff;
  border: none;
  border-radius: var(--radius-pill);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  box-shadow: 0 0 40px rgba(255,255,255,0.12);
  transition: opacity var(--transition);
}
.btn-primary:hover:not(:disabled) { opacity: 0.92; }
.btn-primary:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: none; }
.btn-spinner {
  display: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid rgba(0,0,0,0.2);
  border-top-color: #000000;
  animation: spin 0.7s linear infinite;
}
.btn-primary.loading .btn-spinner { display: inline-block; }
@keyframes spin { to { transform: rotate(360deg); } }
.status {
  display: none;
  margin-top: 16px;
  padding: 14px 16px;
  border-radius: var(--radius-md);
  font-size: 13px;
  line-height: 1.5;
  font-weight: 500;
}
.status.show { display: block; }
.status.success {
  background: rgba(74,222,128,0.08);
  border: 1px solid rgba(74,222,128,0.25);
  color: var(--success);
}
.status.error {
  background: rgba(255,59,48,0.08);
  border: 1px solid rgba(255,59,48,0.25);
  color: var(--danger);
}
`

const SCRIPTS = `
(function () {
  const LOCAL_SECRET = '__SOCIA_LOCAL_SECRET__';
  const form = document.getElementById('form');
  const btn = document.getElementById('btn');
  const status = document.getElementById('status');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true;
    btn.classList.add('loading');
    status.className = 'status';
    status.textContent = '';

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Socia-Local': LOCAL_SECRET,
        },
        body: JSON.stringify({ email, password, device_id: 'socia-cli' }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Login failed');

      status.className = 'status success show';
      status.textContent = 'Signed in. You can close this window.';
      btn.classList.remove('loading');
      btn.querySelector('.btn-label').textContent = 'Done';
    } catch (err) {
      status.className = 'status error show';
      status.textContent = err.message;
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  });
})();
`

export async function loginCommand(): Promise<void> {
	const config = loadConfig()
	const apiUrl = config.apiUrl

	logger.step(1, `Connecting to ${apiUrl}`)

	let done = false
	let loginData: {
		token: string
		refreshToken?: string
		userId: string
		username?: string | null
	} | null = null

	const tempDir = join(tmpdir(), `socia-login-${Date.now()}`)
	fsExtra.ensureDirSync(tempDir)

	const localSecret = createLocalSecret()
	let localPort = 0
	const app = express()
	app.use(localRequestGuard(() => localPort))
	app.use(express.json({ limit: '1mb' }))

	app.get('/', (req, res) => {
		res.set('Cache-Control', 'no-store')
		res.send(buildLoginHtml(localSecret))
	})

	// Proxy login to the backend to avoid CORS issues. Tokens stay in
	// this process and are never sent back to the browser.
	app.post('/api/login', requireLocalSecret(localSecret), async (req, res) => {
		try {
			const { email, password, device_id } = req.body

			const response = await fetch(`${apiUrl}/api/auth/login`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password, device_id }),
				signal: AbortSignal.timeout(30_000),
			})

			const data = (await response.json()) as {
				token?: unknown
				refreshToken?: unknown
				userId?: unknown
				user?: { username?: unknown }
				error?: unknown
			}

			if (!response.ok) {
				return res.status(response.status).json(data)
			}
			if (typeof data.token !== 'string' || typeof data.userId !== 'string') {
				return res.status(502).json({ error: 'Invalid login response' })
			}

			loginData = {
				token: data.token,
				refreshToken:
					typeof data.refreshToken === 'string' ? data.refreshToken : undefined,
				userId: data.userId,
				username:
					typeof data.user?.username === 'string' ? data.user.username : null,
			}
			done = true
			res.json({ ok: true, username: loginData.username ?? null })
		} catch (e) {
			res.status(500).json({
				error: e instanceof Error ? e.message : String(e),
			})
		}
	})

	return new Promise<void>((resolve, reject) => {
		let checkTimer: NodeJS.Timeout | undefined
		let timeout: NodeJS.Timeout | undefined
		let settled = false

		const server = app.listen(0, LOCAL_HOST) // OS picks a free port

		const cleanup = (): void => {
			if (checkTimer) clearInterval(checkTimer)
			if (timeout) clearTimeout(timeout)
		}

		const fail = (message: string): void => {
			if (settled) return
			settled = true
			cleanup()
			try {
				server.close()
			} catch {
				// ignore
			}
			removeSync(tempDir)
			reject(new Error(message))
		}

		timeout = setTimeout(() => {
			fail('Login timed out after 5 minutes. Run `socia login` again.')
		}, 5 * 60 * 1000)

		server.once('error', err => {
			fail(`Could not start the login server: ${err.message}`)
		})

		server.once('listening', async () => {
			const addr = server.address()
			const port = typeof addr === 'object' && addr ? addr.port : 0
			localPort = port
			const url = `http://${LOCAL_HOST}:${port}`
			logger.success(`Open the browser: ${url}`)
			try {
				await open(url)
			} catch {
				logger.warn(`Could not open the browser. Open manually: ${url}`)
			}
		})

		checkTimer = setInterval(() => {
			if (done && loginData) {
				settled = true
				cleanup()

				const updated = loadConfig()
				updated.token = loginData!.token
				if (loginData!.refreshToken) {
					updated.refreshToken = loginData!.refreshToken
				}
				updated.userId = loginData!.userId
				if (loginData!.username) {
					updated.username = loginData!.username
				}
				saveConfig(updated)

				logger.success(
					`Signed in as ${loginData!.username ?? loginData!.userId}`,
				)

				setTimeout(() => {
					server.close()
					removeSync(tempDir)
					resolve()
				}, 500)
			}
		}, 300)

		process.once('SIGINT', () => fail('Cancelled'))
	})
}


