import { test, expect } from '@playwright/test';
import { FIXTURE_URL, createVisitorAccount, waitForPuterReady } from '../helpers/testApp.js';

const FIXTURE = FIXTURE_URL.replace(
    'menubar-contextmenu.html',
    'request-permission.html',
);

/**
 * A sign-in popup ends by handing the opener a user-app token. On a
 * cross-origin-isolated opener that hand-off goes through `/login/set`, which
 * the unauthenticated `/login/wait` then serves to whoever holds the session
 * id — so unlike the `postMessage` route it is not origin-bound by the
 * browser, and the popup's own gates are what stand between a link and a
 * token.
 *
 * These cover the two ways a link used to get past those gates: naming an
 * opener in the URL, and asserting in the URL that a login already happened.
 */
test.describe('popup sign-in cannot be driven from a link', () => {
    /**
     * Start a `/login/wait` long poll on the page, open `popupUrl`, and report
     * whether a token ever came back. Absence of a leak reads as 'waiting'.
     */
    const probe = async (page, session, popupUrl) => {
        await page.goto('/');
        await page.waitForFunction(() => !!window.puter?.authToken, null, {
            timeout: 60_000,
        });
        await page.goto(FIXTURE);
        await page.locator('body.ready').waitFor({ timeout: 60_000 });

        const [popup] = await Promise.all([
            page.waitForEvent('popup'),
            page.evaluate(
                ({ s, u }) => {
                    window.__leaked = 'waiting';
                    (async () => {
                        for (let i = 0; i < 10; i++) {
                            try {
                                const r = await fetch(
                                    `${puter.APIOrigin}/login/wait`,
                                    {
                                        method: 'POST',
                                        headers: {
                                            'Content-Type': 'application/json',
                                        },
                                        body: JSON.stringify({ session: s }),
                                    },
                                );
                                if (r.ok && (await r.json())?.auth_token) {
                                    window.__leaked = 'leaked';
                                    return;
                                }
                            } catch (e) {
                                /* keep waiting */
                            }
                        }
                    })();
                    window.open(
                        u.replace('__GUI__', puter.defaultGUIOrigin),
                        'signin-probe',
                        'width=600,height=700',
                    );
                },
                { s: session, u: popupUrl },
            ),
        ]);
        return popup;
    };

    test('an action-less popup does not mint and relay a token on its own', async ({
        page,
    }) => {
        // The reported zero-click. A popup URL with no `action` missed the
        // account picker (which keyed off `action === 'sign-in'`) and, on a
        // single-session account, the multi-account picker too — so it showed
        // the user nothing and still ended in a token on the relay.
        const session = '11111111-2222-4333-8444-666666666666';
        const popup = await probe(
            page,
            session,
            '__GUI__/?embedded_in_popup=true&cross_origin_isolated=true' +
                `&signin_session=${session}&msg_id=88`,
        );

        // The user is asked, rather than the popup deciding for them.
        await expect(popup.locator('.auth-dialog [data-screen="accounts"]')).toBeVisible({
            timeout: 60_000,
        });
        expect(await page.evaluate(() => window.__leaked)).toBe('waiting');
    });

    test('`opener_origin` cannot name the app a sign-in token is minted for', async ({
        page,
    }) => {
        // The opener's origin picks the app identity the token belongs to.
        // Taken from the link, it let any site have a token minted in another
        // app's name; it now comes only from sources the browser vouches for.
        const session = '11111111-2222-4333-8444-777777777777';
        const popup = await probe(
            page,
            session,
            '__GUI__/?embedded_in_popup=true&cross_origin_isolated=true' +
                `&signin_session=${session}&msg_id=89` +
                '&opener_origin=https%3A%2F%2Fconsole.puter.com',
        );

        await expect(popup.locator('.auth-dialog [data-screen="accounts"]')).toBeVisible({
            timeout: 60_000,
        });
        await page.waitForTimeout(5000);
        expect(await page.evaluate(() => window.__leaked)).toBe('waiting');
    });

    test('`oidc_login` in the URL does not skip the account picker', async ({
        page,
    }) => {
        // The backend appends this on a genuine OIDC return leg, but as a bare
        // query parameter anyone can write it — and it suppressed the picker
        // outright. Both it and the opener's origin now come from the signed
        // `opener_state` proof, which only the server can mint.
        const session = '11111111-2222-4333-8444-888888888888';
        const popup = await probe(
            page,
            session,
            '__GUI__/action/sign-in?embedded_in_popup=true' +
                '&cross_origin_isolated=true&oidc_login=true' +
                `&signin_session=${session}&msg_id=90`,
        );

        await expect(popup.locator('.auth-dialog [data-screen="accounts"]')).toBeVisible({
            timeout: 60_000,
        });
        expect(await page.evaluate(() => window.__leaked)).toBe('waiting');
    });

    test('a forged opener_state is not believed', async ({ page }) => {
        // Only the server holds the signing key, so a made-up proof is refused
        // by /auth/oidc/verify-popup-return and the popup falls back to its
        // browser-attested opener.
        const session = '11111111-2222-4333-8444-aaaaaaaaaaaa';
        const popup = await probe(
            page,
            session,
            '__GUI__/action/sign-in?embedded_in_popup=true' +
                '&cross_origin_isolated=true&oidc_login=true' +
                '&opener_state=not.a.real.proof' +
                `&signin_session=${session}&msg_id=92`,
        );

        await expect(popup.locator('.auth-dialog [data-screen="accounts"]')).toBeVisible({
            timeout: 60_000,
        });
        expect(await page.evaluate(() => window.__leaked)).toBe('waiting');
    });

    test('dismissing the account picker leaves the opener with no token', async ({
        page,
    }) => {
        // The picker used to gate only the early token exchange; the delivery
        // in `postAuthActions` ran regardless, so declining still signed the
        // site in.
        const session = '11111111-2222-4333-8444-999999999999';
        const popup = await probe(
            page,
            session,
            '__GUI__/action/sign-in?embedded_in_popup=true' +
                '&cross_origin_isolated=true' +
                `&signin_session=${session}&msg_id=91`,
        );

        await expect(popup.locator('.auth-dialog [data-screen="accounts"]')).toBeVisible({
            timeout: 60_000,
        });
        await popup.close();
        await page.waitForTimeout(5000);
        expect(await page.evaluate(() => window.__leaked)).toBe('waiting');
    });
});

test.describe('popup sign-in after an account is picked', () => {
    // The popup's own `/whoami` read carries `icon_size`. puter.js sends a
    // bare one on every `setAuthToken()`, which the popup does not wait on.
    const COUNTED = ['/auth/get-user-app-token', '/auth/check-app', '/whoami?icon_size=64'];

    /**
     * Open a sign-in popup from the fixture, pick the signed-in account, and
     * report the API requests the popup sent after the pick. With a `session`
     * the page waits on `/login/wait` for it, as an isolated opener does. With
     * an `other` account, that one is signed in on the browser too, and picked.
     */
    const pickAccount = async (page, popupQuery, session = null, other = null) => {
        await page.goto('/');
        await page.waitForFunction(() => !!window.puter?.authToken, null, {
            timeout: 60_000,
        });
        if ( other ) {
            await waitForPuterReady(page);
            await page.evaluate(({ token, user }) => {
                const known = JSON.parse(localStorage.getItem('logged_in_users'));
                known.push({ ...user, auth_token: token });
                localStorage.setItem('logged_in_users', JSON.stringify(known));
            }, other);
        }
        await page.goto(FIXTURE);
        await page.locator('body.ready').waitFor({ timeout: 60_000 });

        const [popup] = await Promise.all([
            page.waitForEvent('popup'),
            page.evaluate(({ query, relaySession }) => {
                if ( relaySession ) {
                    window.__relayed = fetch(`${puter.APIOrigin}/login/wait`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ session: relaySession }),
                    }).then(async (response) => (await response.json())?.auth_token);
                }
                window.__delivered = null;
                window.addEventListener('message', (event) => {
                    if ( event.data?.msg === 'puter.token' ) {
                        window.__delivered = event.data;
                    }
                });
                window.open(
                    `${puter.defaultGUIOrigin}/action/sign-in?embedded_in_popup=true&${query}`,
                    'signin-pick',
                    'width=600,height=700',
                );
            }, { query: popupQuery, relaySession: session }),
        ]);

        const accounts = popup.locator('.auth-dialog [data-screen="accounts"] .auth-account');
        await expect(accounts).toHaveCount(other ? 2 : 1, { timeout: 60_000 });
        const account = other ? accounts.and(popup.locator(`[data-uuid="${other.user.uuid}"]`)) : accounts;
        const requests = [];
        popup.on('request', (request) => {
            if ( request.method() === 'OPTIONS' ) return;
            const { pathname, search } = new URL(request.url());
            if ( COUNTED.includes(pathname + search) ) requests.push(pathname + search);
        });
        await Promise.all([popup.waitForEvent('close'), account.click()]);
        return requests;
    };

    /** The username the API resolves `token` to, asked from the fixture page. */
    const usernameFor = (page, token) =>
        page.evaluate(async (bearer) => {
            const response = await fetch(`${puter.APIOrigin}/whoami`, {
                headers: { Authorization: `Bearer ${bearer}` },
            });
            return response.ok ? (await response.json()).username : null;
        }, token);

    test('hands the opener a working token after one exchange', async ({ page }) => {
        const requests = await pickAccount(page, 'msg_id=92');

        await page.waitForFunction(() => !!window.__delivered);
        const delivered = await page.evaluate(() => window.__delivered);
        expect(delivered.success).toBe(true);
        expect(delivered.msg_id).toBe('92');
        expect(delivered.app_uid).toMatch(/^app-/);
        expect(await usernameFor(page, delivered.token)).toBe(delivered.username);
        expect(requests).toEqual(['/auth/get-user-app-token']);
    });

    test('relays a working token to an isolated opener after one exchange', async ({ page }) => {
        const session = '22222222-3333-4444-8555-aaaaaaaaaaaa';
        const requests = await pickAccount(
            page,
            `cross_origin_isolated=true&signin_session=${session}&msg_id=93`,
            session,
        );

        const token = await page.evaluate(() => window.__relayed);
        expect(await usernameFor(page, token)).toBeTruthy();
        expect(requests).toEqual(['/auth/get-user-app-token']);
    });

    test('hands over the picked account when it is not the one the popup opened with', async ({ browser, page }) => {
        const other = await createVisitorAccount(browser);

        const requests = await pickAccount(page, 'msg_id=94', null, other);

        await page.waitForFunction(() => !!window.__delivered);
        const delivered = await page.evaluate(() => window.__delivered);
        expect(delivered.success).toBe(true);
        expect(delivered.username).toBe(other.user.username);
        expect(await usernameFor(page, delivered.token)).toBe(other.user.username);
        // The popup has not read this account yet, so it reads it once.
        expect(requests).toEqual(['/auth/get-user-app-token', '/whoami?icon_size=64']);
    });
});
