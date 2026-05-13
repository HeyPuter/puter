import { randomUUID } from 'node:crypto';

const FIXTURE_ORIGIN = process.env.PUTER_TEST_FIXTURE_ORIGIN || 'http://localhost:8080';
const FIXTURE_PATH = '/tests/e2e/fixtures/menubar-contextmenu.html';

export const FIXTURE_URL = `${FIXTURE_ORIGIN}${FIXTURE_PATH}`;

const PUTER_READY_TIMEOUT = 60_000;

/**
 * Waits for Puter desktop to be fully signed in (auto-temp-user creation done)
 * and the puter.js SDK to be authenticated. Throws on timeout with a useful
 * snapshot of why we think it's not ready.
 */
export async function waitForPuterReady (page) {
    await page.waitForFunction(() => !!window.puter, null, { timeout: PUTER_READY_TIMEOUT });

    // With storageState, sign-in should already be done. Wait for both auth
    // and the API origin to be picked up by the SDK from localStorage.
    try {
        await page.waitForFunction(
            () => {
                const ls = (typeof localStorage !== 'undefined') ? localStorage.getItem('auth_token') : null;
                const lsApi = (typeof localStorage !== 'undefined') ? localStorage.getItem('api_origin') : null;
                return !!(
                    ls && lsApi &&
                    window.auth_token && window.puter?.authToken &&
                    window.puter?.APIOrigin === lsApi
                );
            },
            null,
            { timeout: PUTER_READY_TIMEOUT },
        );
    } catch (e) {
        const diag = await page.evaluate(() => ({
            url: location.href,
            puter: typeof window.puter,
            puterAuthToken: !!window.puter?.authToken,
            windowAuthToken: !!window.auth_token,
            lsAuthToken: !!(typeof localStorage !== 'undefined' && localStorage.getItem('auth_token')),
            firstVisitEver: window.first_visit_ever,
            isAuth: typeof window.is_auth === 'function' ? window.is_auth() : null,
            user: window.user ? { is_temp: window.user.is_temp, username: window.user.username } : null,
            captchaModalVisible: document.querySelector('.captcha-modal') ? true : false,
        }));
        throw new Error(`waitForPuterReady timed out. Diagnostics: ${JSON.stringify(diag, null, 2)}`);
    }

    await page.waitForFunction(() => !!window.puter?.apps?.create, null, { timeout: 10_000 });
}

async function assertFixtureReachable (fixtureURL) {
    let res;
    try {
        res = await fetch(fixtureURL, { method: 'GET' });
    } catch (e) {
        throw new Error(
            `Fixture URL is unreachable: ${fixtureURL}\n` +
            '→ Is the puter-js dev server running? From src/puter-js: `npm start`\n' +
            `Underlying error: ${e?.message || e}`,
        );
    }
    if ( ! res.ok ) {
        throw new Error(`Fixture URL returned HTTP ${res.status}: ${fixtureURL}`);
    }
}

export async function registerTestApp (page, { fixtureURL = FIXTURE_URL } = {}) {
    await assertFixtureReachable(fixtureURL);
    await page.goto('/');
    await waitForPuterReady(page);

    const appName = `puter-js-testing-${randomUUID().slice(0, 8)}`;

    const result = await page.evaluate(
        async ({ name, url }) => {
            const ctx = {
                APIOrigin: window.puter?.APIOrigin,
                authTokenLen: window.puter?.authToken ? window.puter.authToken.length : 0,
                api_origin: window.api_origin,
            };
            try {
                const app = await window.puter.apps.create(name, url);
                return { ok: true, app, ctx };
            } catch (e) {
                return { ok: false, error: String(e?.message || (typeof e === 'object' ? JSON.stringify(e) : e)), ctx };
            }
        },
        { name: appName, url: fixtureURL },
    );
    if ( ! result.ok ) {
        throw new Error(`puter.apps.create failed: ${result.error}\nContext: ${JSON.stringify(result.ctx)}`);
    }

    return appName;
}

export async function deleteTestApp (page, appName) {
    if ( ! appName ) return;
    try {
        await page.goto('/');
        await waitForPuterReady(page);
        await page.evaluate(async (name) => {
            try {
                await window.puter.apps.delete(name);
            } catch {
            }
        }, appName);
    } catch {
        // Cleanup is best-effort.
    }
}

export async function gotoTestApp (page, appName) {
    await page.goto(`/app/${appName}`);
    const appFrame = page.frameLocator('iframe.window-app-iframe').last();
    await appFrame.locator('body.ready').waitFor({ timeout: 60_000 });
    return appFrame;
}
