import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { readFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_STATE_PATH = path.join(__dirname, '.auth', 'state.json');
const ENV_FILE_PATH = path.join(__dirname, '.env');
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;

// Tiny dotenv loader. Loads tests/e2e/.env into process.env if it exists.
// Existing process.env wins, so CLI overrides still work.
async function loadDotEnv (filePath) {
    if ( ! existsSync(filePath) ) return;
    const text = await readFile(filePath, 'utf8');
    for ( const rawLine of text.split('\n') ) {
        const line = rawLine.trim();
        if ( !line || line.startsWith('#') ) continue;
        const eq = line.indexOf('=');
        if ( eq < 0 ) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if ( (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")) ) {
            value = value.slice(1, -1);
        }
        if ( ! (key in process.env) ) process.env[key] = value;
    }
}

async function isCachedStateFresh () {
    if ( ! existsSync(STORAGE_STATE_PATH) ) return false;
    if ( process.env.PUTER_TEST_RESET_AUTH === '1' ) return false;
    try {
        const s = await stat(STORAGE_STATE_PATH);
        return (Date.now() - s.mtimeMs) < CACHE_TTL_MS;
    } catch {
        return false;
    }
}

async function loginAsAdmin ({ origin, username, password }) {
    // Puter rejects POSTs without an Origin header (403 Forbidden), so send
    // one matching the target origin to satisfy its CSRF check.
    const res = await fetch(`${origin}/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Origin': origin,
        },
        body: JSON.stringify({ username, password }),
    });
    if ( ! res.ok ) {
        const text = await res.text().catch(() => '');
        throw new Error(`POST /login → HTTP ${res.status}: ${text || '(empty body)'}`);
    }
    const data = await res.json();
    if ( ! data.token ) {
        throw new Error(`POST /login response had no token: ${JSON.stringify(data)}`);
    }
    return data.token;
}

export default async function globalSetup () {
    await loadDotEnv(ENV_FILE_PATH);

    const PUTER_ORIGIN = process.env.PUTER_TEST_ORIGIN || 'http://puter.localhost:4100';
    const ADMIN_USERNAME = process.env.PUTER_ADMIN_USERNAME || 'admin';
    const ADMIN_PASSWORD = process.env.PUTER_ADMIN_PASSWORD || '';

    await mkdir(path.dirname(STORAGE_STATE_PATH), { recursive: true });

    if ( await isCachedStateFresh() ) {

        console.log(`[e2e] Reusing cached auth state at ${STORAGE_STATE_PATH}`);
        return;
    }

    if ( ! ADMIN_PASSWORD ) {
        throw new Error(
            'PUTER_ADMIN_PASSWORD is not set.\n' +
            'Your local Puter prints the admin password at startup (look for "Password: <hex>" in the monorepo\'s npm start output).\n' +
            'Set it in tests/e2e/.env (gitignored):\n' +
            '  cp tests/e2e/.env.example tests/e2e/.env\n' +
            '  # then edit tests/e2e/.env and set PUTER_ADMIN_PASSWORD\n' +
            'Or pass it inline: PUTER_ADMIN_PASSWORD=<value> npm run test:e2e',
        );
    }

    // 1) Direct API login → token (no browser, no /signup, no rate-limit risk).
    const token = await loginAsAdmin({ origin: PUTER_ORIGIN, username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    // 2) Open Puter with ?auth_token=<token>&api_origin=<origin> so initgui's
    //    auth_token flow runs the full setup (puter.setAuthToken,
    //    puter.setAPIOrigin, /session/sync-cookie, update_auth_data) and persists
    //    the API origin to localStorage.api_origin — otherwise the bundled SDK
    //    keeps its production default (https://api.puter.com) and apps.create
    //    hits the wrong server.
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    // Probe the GUI's templated api_origin first so we can pass it through.
    await page.goto(PUTER_ORIGIN);
    const apiOrigin = await page.evaluate(() => window.api_origin || null);
    if ( ! apiOrigin ) {
        await browser.close();
        throw new Error(`Could not determine api_origin from ${PUTER_ORIGIN} (window.api_origin was empty).`);
    }

    await page.goto(
        `${PUTER_ORIGIN}/?auth_token=${encodeURIComponent(token)}` +
        `&api_origin=${encodeURIComponent(apiOrigin)}`,
    );

    await page.waitForFunction(() => !!window.puter, null, { timeout: 60_000 });
    await page.waitForFunction(
        () => {
            const ls = (typeof localStorage !== 'undefined') ? localStorage.getItem('auth_token') : null;
            const lsApi = (typeof localStorage !== 'undefined') ? localStorage.getItem('api_origin') : null;
            return !!(ls && lsApi && window.auth_token && window.puter?.authToken && window.puter?.APIOrigin === lsApi);
        },
        null,
        { timeout: 60_000 },
    );

    await context.storageState({ path: STORAGE_STATE_PATH });
    await browser.close();

    console.log(`[e2e] Logged in as "${ADMIN_USERNAME}", saved auth state to ${STORAGE_STATE_PATH}`);
}
