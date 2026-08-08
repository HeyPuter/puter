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

    // With storageState, sign-in should already be done. Wait for the token to
    // be picked up and the SDK pointed at the GUI's own API origin.
    try {
        await page.waitForFunction(
            () => {
                // The GUI persists the token under the v2 key since the
                // v1→v2 cutover; tolerate the legacy key for old states.
                const ls = (typeof localStorage !== 'undefined')
                    ? (localStorage.getItem('auth_token_v2') || localStorage.getItem('auth_token'))
                    : null;
                return !!(
                    ls &&
                    window.auth_token && window.puter?.authToken &&
                    window.puter?.APIOrigin === window.api_origin
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
            lsAuthToken: !!(typeof localStorage !== 'undefined' && (localStorage.getItem('auth_token_v2') || localStorage.getItem('auth_token'))),
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

/**
 * Registers an app that only exists to *own data* — the target of a cross-app
 * request. Its `index_url` is never loaded, so no fixture is needed.
 *
 * `seed` entries are written into the target's own KV namespace from the GUI
 * page, using the user-token override that is deliberately ungated.
 *
 * @returns {Promise<{ name: string, uid: string, title: string }>}
 */
export async function registerTargetApp (page, { title = 'Contacts', seed = {} } = {}) {
    await page.goto('/');
    await waitForPuterReady(page);

    const appName = `puter-js-target-${randomUUID().slice(0, 8)}`;
    const result = await page.evaluate(
        async ({ name, appTitle, entries }) => {
            try {
                const app = await window.puter.apps.create(
                    name,
                    'https://target.example.test/',
                    appTitle,
                );
                for ( const [key, spec] of Object.entries(entries) ) {
                    await window.puter.kv.set(key, spec.value, {
                        appUuid: app.uid,
                        ...(spec.private ? { disableSharing: true } : {}),
                    });
                }
                return { ok: true, app };
            } catch (e) {
                return { ok: false, error: String(e?.message ?? e) };
            }
        },
        { name: appName, appTitle: title, entries: seed },
    );
    if ( ! result.ok ) {
        throw new Error(`registerTargetApp failed: ${result.error}`);
    }
    // The dialog labels the target by title, so the tests depend on it landing.
    if ( result.app.title !== title ) {
        throw new Error(`target app title is "${result.app.title}", expected "${title}"`);
    }
    return { name: appName, uid: result.app.uid, title };
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
