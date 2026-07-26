import { test, expect } from '@playwright/test';
import { registerTestApp, deleteTestApp, gotoTestApp, FIXTURE_URL } from '../helpers/testApp.js';

const PERMISSION_FIXTURE_URL = FIXTURE_URL.replace(
    'menubar-contextmenu.html',
    'request-permission.html',
);

// Playwright's Chromium reports `navigator.userActivation.isActive` as true
// even with zero interactions, which routes the SDK to the direct-popup path.
// Stubbing it as inactive forces the consent-dialog (no-gesture) path.
// Real popups still open from the dialog's Continue click because Playwright
// disables the popup blocker.
async function stubNoUserActivation (page) {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'userActivation', {
            value: { hasBeenActive: false, isActive: false },
            configurable: true,
        });
    });
}

test.describe('puter.ui.requestPermission (env=app)', () => {
    test('deny resolves false, allow resolves true', async ({ page }) => {
        const appName = await registerTestApp(page, { fixtureURL: PERMISSION_FIXTURE_URL });
        try {
            const appFrame = await gotoTestApp(page, appName);

            // First request: deny.
            await appFrame.locator('#req-email-perm').click();
            const dialog = page.locator('dialog.perm-dialog');
            await expect(dialog).toBeVisible();
            // The requesting app is identified in the dialog.
            await expect(dialog.locator('.perm-dialog-entity-name')).toContainText(appName);
            await dialog.locator('.perm-dialog-deny').click();
            await expect(appFrame.locator('#log [data-entry="perm:email:false"]')).toBeVisible();
            await expect(dialog).toBeHidden();

            // Second request: allow.
            await appFrame.locator('#req-email-perm').click();
            await expect(dialog).toBeVisible();
            await dialog.locator('.perm-dialog-allow').click();
            await expect(appFrame.locator('#log [data-entry="perm:email:true"]')).toBeVisible();
            await expect(dialog).toBeHidden();
        } finally {
            await deleteTestApp(page, appName);
        }
    });

    test('duplicate concurrent requests share one dialog and one decision', async ({ page }) => {
        const appName = await registerTestApp(page, { fixtureURL: PERMISSION_FIXTURE_URL });
        try {
            const appFrame = await gotoTestApp(page, appName);

            // Fire two requests for the same permission without awaiting them;
            // the GUI must show a single dialog that answers both.
            await appFrame.locator('body').evaluate(async () => {
                const whoami = await puter.auth.whoami();
                const permission = `user:${whoami.uuid}:email:read`;
                window.__permResults = Promise.all([
                    puter.ui.requestPermission({ permission }),
                    puter.ui.requestPermission({ permission }),
                ]);
            });

            const dialog = page.locator('dialog.perm-dialog');
            await expect(dialog).toHaveCount(1);
            await expect(dialog).toBeVisible();
            await dialog.locator('.perm-dialog-allow').click();

            const results = await appFrame.locator('body').evaluate(() => window.__permResults);
            expect(results).toEqual([true, true]);
        } finally {
            await deleteTestApp(page, appName);
        }
    });

    test('unsupported permission strings resolve false without a dialog', async ({ page }) => {
        const appName = await registerTestApp(page, { fixtureURL: PERMISSION_FIXTURE_URL });
        try {
            const appFrame = await gotoTestApp(page, appName);

            const granted = await appFrame.locator('body').evaluate(() =>
                puter.ui.requestPermission({ permission: 'not-a-real:permission' }),
            );
            expect(granted).toBe(false);
            await expect(page.locator('dialog.perm-dialog')).toHaveCount(0);
        } finally {
            await deleteTestApp(page, appName);
        }
    });

    test('Escape dismisses the dialog as a denial', async ({ page }) => {
        const appName = await registerTestApp(page, { fixtureURL: PERMISSION_FIXTURE_URL });
        try {
            const appFrame = await gotoTestApp(page, appName);

            await appFrame.locator('#req-driver-perm').click();
            const dialog = page.locator('dialog.perm-dialog');
            await expect(dialog).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(appFrame.locator('#log [data-entry="perm:driver:false"]')).toBeVisible();
            await expect(dialog).toBeHidden();
        } finally {
            await deleteTestApp(page, appName);
        }
    });

    test('requests for different permissions are prompted one at a time', async ({ page }) => {
        // A permission dialog is a modal `<dialog>`, so it makes the whole
        // desktop inert — not just the requesting app's window. Several at once
        // would wall the user in behind a pile of prompts.
        const appName = await registerTestApp(page, { fixtureURL: PERMISSION_FIXTURE_URL });
        try {
            const appFrame = await gotoTestApp(page, appName);

            await appFrame.locator('body').evaluate(() => {
                window.__serialResults = Promise.all([
                    puter.ui.requestPermission({ permission: 'driver:puter-image-generation:generate' }),
                    puter.ui.requestPermission({ permission: 'driver:puter-chat-completion:complete' }),
                ]);
            });

            const dialogs = page.locator('dialog.perm-dialog');
            await expect(dialogs).toHaveCount(1);
            await dialogs.first().locator('.perm-dialog-deny').click();
            // The queued request gets its own prompt once the first is answered.
            await expect(dialogs).toHaveCount(1);
            await dialogs.first().locator('.perm-dialog-allow').click();

            // Each caller still receives its own decision.
            const results = await appFrame.locator('body').evaluate(() => window.__serialResults);
            expect(results).toEqual([false, true]);
        } finally {
            await deleteTestApp(page, appName);
        }
    });

    test('an app is identified by its unique name, not just its chosen title', async ({ page }) => {
        // `title` is free-form text the app author picks and is not unique, so
        // on its own it can impersonate another app. `name` is unique and
        // format-restricted, so the dialog has to show it too.
        const appName = await registerTestApp(page, { fixtureURL: PERMISSION_FIXTURE_URL });
        try {
            await page.goto('/');
            await page.waitForFunction(() => !!window.puter?.authToken, null, { timeout: 60_000 });
            await page.evaluate(
                (name) => puter.apps.update(name, { title: 'Puter Settings' }),
                appName,
            );

            const appFrame = await gotoTestApp(page, appName);
            await appFrame.locator('#req-driver-perm').click();
            const dialog = page.locator('dialog.perm-dialog');
            await expect(dialog).toBeVisible();

            await expect(dialog.locator('.perm-dialog-entity-name')).toHaveText('Puter Settings');
            await expect(dialog.locator('.perm-dialog-entity-origin')).toHaveText(appName);
            await dialog.locator('.perm-dialog-deny').click();
        } finally {
            await deleteTestApp(page, appName);
        }
    });

    test('dismissing while the grant is in flight cannot report a false denial', async ({ page, context }) => {
        // The grant POST is committed server-side; answering "denied" over the
        // top of it would leave the user believing they cancelled a permission
        // that is now granted.
        const appName = await registerTestApp(page, { fixtureURL: PERMISSION_FIXTURE_URL });
        try {
            await context.route('**/auth/grant-user-app', async (route) => {
                await new Promise(r => setTimeout(r, 3000));
                await route.continue();
            });

            const appFrame = await gotoTestApp(page, appName);
            await appFrame.locator('#req-driver-perm').click();
            const dialog = page.locator('dialog.perm-dialog');
            await expect(dialog).toBeVisible();
            await dialog.locator('.perm-dialog-allow').click();

            // Try to dismiss while the request is outstanding. Escape is the
            // real-world route, but with both buttons disabled focus has left
            // the dialog and Chromium routes the key elsewhere — so also fire
            // the `cancel` event the platform would fire, which is what the
            // dialog actually has to defend against.
            await expect(dialog.locator('.perm-dialog-allow.perm-dialog-busy')).toBeVisible();
            await page.keyboard.press('Escape');
            await page.evaluate(() => {
                document.querySelector('dialog.perm-dialog')
                    ?.dispatchEvent(new Event('cancel', { cancelable: true }));
            });

            // The grant's own outcome is the answer, not the dismissal.
            await expect(appFrame.locator('#log [data-entry="perm:driver:true"]')).toBeVisible();
            expect(await appFrame.locator('#log [data-entry="perm:driver:false"]').count()).toBe(0);
        } finally {
            await deleteTestApp(page, appName);
        }
    });

    test('a force-closed dialog with a failing in-flight grant still settles', async ({ page, context }) => {
        // The `cancel` handler is preventDefault'd, but close requests can't
        // be suppressed forever: Chrome's close watcher lets a repeated Esc
        // skip `cancel` and close the dialog outright while the grant POST is
        // still in flight. If that grant then fails, there is no retry UI to
        // hand back — the dialog must settle (as a denial) rather than leave
        // the requesting app waiting on a promise forever.
        const appName = await registerTestApp(page, { fixtureURL: PERMISSION_FIXTURE_URL });
        try {
            await context.route('**/auth/grant-user-app', async (route) => {
                await new Promise(r => setTimeout(r, 2000));
                await route.fulfill({ status: 500, body: '{}' });
            });

            const appFrame = await gotoTestApp(page, appName);
            await appFrame.locator('#req-driver-perm').click();
            const dialog = page.locator('dialog.perm-dialog');
            await expect(dialog).toBeVisible();
            await dialog.locator('.perm-dialog-allow').click();
            await expect(dialog.locator('.perm-dialog-allow.perm-dialog-busy')).toBeVisible();

            // What the close watcher does on the second Esc: close without
            // firing a cancelable `cancel`.
            await page.evaluate(() => {
                document.querySelector('dialog.perm-dialog')?.close();
            });

            await expect(appFrame.locator('#log [data-entry="perm:driver:false"]')).toBeVisible({ timeout: 20_000 });
        } finally {
            await deleteTestApp(page, appName);
        }
    });

    test('a grant whose response is lost is withdrawn when the user then denies', async ({ page, context }) => {
        // The dialog aborts a grant that takes too long, but the request may
        // already have committed server-side. Answering "Don't Allow" after that
        // has to undo it — otherwise the app is told "denied" while the
        // permission is live in the user's account.
        const appName = await registerTestApp(page, { fixtureURL: PERMISSION_FIXTURE_URL });
        const permission = 'driver:puter-image-generation:generate';
        // Scoped to this app's uid: other tests grant the same permission to
        // the fixture origin's app, whose row outlives them.
        const isGrantedTo = (appUid) => page.evaluate(async ({ perm, uid }) => {
            const res = await fetch(`${puter.APIOrigin}/auth/list-permissions`, {
                headers: { 'Authorization': `Bearer ${puter.authToken}` },
            });
            const body = await res.json();
            return body.myself_to_app.some(
                r => r.permission === perm && r.app_uid === uid,
            );
        }, { perm: permission, uid: appUid });

        try {
            const appFrame = await gotoTestApp(page, appName);
            const appUid = await page.evaluate(
                async (name) => (await puter.apps.get(name)).uid,
                appName,
            );
            const dialog = page.locator('dialog.perm-dialog');

            // First, grant it for real so there is a row to withdraw.
            await appFrame.locator('#req-driver-perm').click();
            await expect(dialog).toBeVisible();
            await dialog.locator('.perm-dialog-allow').click();
            await expect(appFrame.locator('#log [data-entry="perm:driver:true"]')).toBeVisible();
            expect(await isGrantedTo(appUid)).toBe(true);

            // Now stand in for a grant whose outcome the dialog can't know: a
            // 5xx (or a dropped response) says nothing about whether the row was
            // written — and here one already is.
            let revoked = false;
            await context.route('**/auth/grant-user-app', route =>
                route.fulfill({ status: 502, body: '{}' }));
            await context.route('**/auth/revoke-user-app', async (route) => {
                revoked = true;
                await route.continue();
            });

            await appFrame.locator('#req-driver-perm').click();
            await expect(dialog).toBeVisible();
            await dialog.locator('.perm-dialog-allow').click();
            // The dialog hands itself back with a retryable error.
            await expect(dialog.locator('.perm-dialog-error')).toBeVisible({ timeout: 30_000 });
            await dialog.locator('.perm-dialog-deny').click();

            await expect.poll(() => revoked, { timeout: 15_000 }).toBe(true);
            // "Don't Allow" has to mean the permission is not granted.
            await expect.poll(() => isGrantedTo(appUid), { timeout: 15_000 }).toBe(false);
        } finally {
            await deleteTestApp(page, appName);
        }
    });
});

test.describe('puter.ui.requestPermission (env=gui)', () => {
    test('inside the Puter GUI it resolves false without opening anything', async ({ page, context }) => {
        // The popup flow is for third-party websites. The GUI's own SDK runs
        // with env='gui'; a permission-denied driver retry there must not pop
        // a window to the Puter origin from the Puter desktop itself.
        // The prod-built GUI loads its SDK from the js.puter.com CDN, so route
        // that to the local build — otherwise this exercises the shipped SDK
        // rather than the code under test.
        await context.route('https://js.puter.com/v2/**', route => route.fulfill({
            path: new URL('../../../dist/puter.dev.js', import.meta.url).pathname,
            contentType: 'application/javascript',
        }));

        await page.goto('/');
        await page.waitForFunction(() => !!window.puter?.authToken, null, { timeout: 60_000 });
        expect(await page.evaluate(() => puter.env)).toBe('gui');

        let popupOpened = false;
        page.on('popup', () => { popupOpened = true; });

        const granted = await page.evaluate(() =>
            puter.ui.requestPermission({ permission: 'driver:puter-image-generation:generate' }),
        );
        expect(granted).toBe(false);
        expect(popupOpened).toBe(false);
        // Neither the consent dialog nor the permission dialog may appear.
        await expect(page.locator('puter-dialog')).toHaveCount(0);
        await expect(page.locator('dialog.perm-dialog')).toHaveCount(0);
    });
});

test.describe('puter.ui.requestPermission (env=web popup)', () => {
    test('permission prompt opens in a popup and reports the decision', async ({ page }) => {
        // Prime the GUI session (storageState sign-in) so the popup is authed.
        await page.goto('/');
        await page.waitForFunction(() => !!window.puter?.authToken, null, { timeout: 60_000 });

        // Load the fixture directly (env=web, third-party origin).
        await page.goto(PERMISSION_FIXTURE_URL);
        await page.locator('body.ready').waitFor({ timeout: 60_000 });

        // Deny first: the click provides user activation, so the popup opens
        // directly (no consent dialog).
        let [popup] = await Promise.all([
            page.waitForEvent('popup'),
            page.locator('#req-driver-perm').click(),
        ]);
        let dialog = popup.locator('dialog.perm-dialog');
        await expect(dialog).toBeVisible({ timeout: 60_000 });
        // Sites are identified by their origin host.
        await expect(dialog.locator('.perm-dialog-entity-name')).toContainText('localhost');
        await dialog.locator('.perm-dialog-deny').click();
        await expect(page.locator('#log [data-entry="perm:driver:false"]')).toBeVisible();

        // Allow on the second attempt; popup closes itself after answering.
        [popup] = await Promise.all([
            page.waitForEvent('popup'),
            page.locator('#req-driver-perm').click(),
        ]);
        dialog = popup.locator('dialog.perm-dialog');
        await expect(dialog).toBeVisible({ timeout: 60_000 });
        await dialog.locator('.perm-dialog-allow').click();
        await expect(page.locator('#log [data-entry="perm:driver:true"]')).toBeVisible();
    });

    test('without a user gesture, a consent dialog collects the click that opens the popup', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => !!window.puter?.authToken, null, { timeout: 60_000 });

        // Playwright's Chromium reports user activation as always-active, so
        // stub it out to deterministically exercise the no-gesture path.
        await stubNoUserActivation(page);
        await page.goto(PERMISSION_FIXTURE_URL);
        await page.locator('body.ready').waitFor({ timeout: 60_000 });

        // Kick off the request from evaluate (no user activation): the SDK
        // must show the PuterDialog consent step instead of a blocked popup.
        await page.evaluate(() => {
            window.__permPromise = puter.ui.requestPermission({
                permission: 'driver:puter-image-generation:generate',
            });
        });
        const continueButton = page.locator('puter-dialog #launch-auth-popup');
        await expect(continueButton).toBeVisible();

        // The Continue click supplies the gesture; the popup opens from it.
        const [popup] = await Promise.all([
            page.waitForEvent('popup'),
            continueButton.click(),
        ]);
        const dialog = popup.locator('dialog.perm-dialog');
        await expect(dialog).toBeVisible({ timeout: 60_000 });
        await dialog.locator('.perm-dialog-deny').click();

        expect(await page.evaluate(() => window.__permPromise)).toBe(false);
    });

    test('cancelling the consent dialog resolves false without opening a popup', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => !!window.puter?.authToken, null, { timeout: 60_000 });

        await stubNoUserActivation(page);
        await page.goto(PERMISSION_FIXTURE_URL);
        await page.locator('body.ready').waitFor({ timeout: 60_000 });

        await page.evaluate(() => {
            window.__permPromise = puter.ui.requestPermission({
                permission: 'driver:puter-image-generation:generate',
            });
        });
        const cancelButton = page.locator('puter-dialog #launch-auth-popup-cancel');
        await expect(cancelButton).toBeVisible();
        await cancelButton.click();

        expect(await page.evaluate(() => window.__permPromise)).toBe(false);
    });

    test('closing the popup without answering resolves false', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => !!window.puter?.authToken, null, { timeout: 60_000 });

        await page.goto(PERMISSION_FIXTURE_URL);
        await page.locator('body.ready').waitFor({ timeout: 60_000 });

        const [popup] = await Promise.all([
            page.waitForEvent('popup'),
            page.locator('#req-driver-perm').click(),
        ]);
        await expect(popup.locator('dialog.perm-dialog')).toBeVisible({ timeout: 60_000 });
        await popup.close();
        await expect(page.locator('#log [data-entry="perm:driver:false"]')).toBeVisible();
    });

    test('Escape on the consent dialog settles the request', async ({ page }) => {
        // A modal `<dialog>` disappears on Escape whether or not anyone is
        // listening, so the dialog has to report that dismissal — otherwise the
        // prompt vanishes and the site waits on a promise that never settles.
        await page.goto('/');
        await page.waitForFunction(() => !!window.puter?.authToken, null, { timeout: 60_000 });

        await stubNoUserActivation(page);
        await page.goto(PERMISSION_FIXTURE_URL);
        await page.locator('body.ready').waitFor({ timeout: 60_000 });

        await page.evaluate(() => {
            window.__permSettled = 'pending';
            window.__permPromise = puter.ui.requestPermission({
                permission: 'driver:puter-image-generation:generate',
            }).then((v) => { window.__permSettled = `resolved:${v}`; return v; });
        });
        await expect(page.locator('puter-dialog #launch-auth-popup')).toBeVisible();

        await page.keyboard.press('Escape');
        await expect
            .poll(() => page.evaluate(() => window.__permSettled), { timeout: 15_000 })
            .toBe('resolved:false');
    });

    test('the permission popup does not sign the site in', async ({ page }) => {
        // Answering a permission prompt is not consent to hand the site this
        // user's credentials, and a failure inside the popup must not clobber a
        // token the site already holds.
        await page.goto('/');
        await page.waitForFunction(() => !!window.puter?.authToken, null, { timeout: 60_000 });

        await page.goto(PERMISSION_FIXTURE_URL);
        await page.locator('body.ready').waitFor({ timeout: 60_000 });
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await page.locator('body.ready').waitFor({ timeout: 60_000 });
        expect(await page.evaluate(() => !!puter.authToken)).toBe(false);

        const [popup] = await Promise.all([
            page.waitForEvent('popup'),
            page.locator('#req-driver-perm').click(),
        ]);
        await expect(popup.locator('dialog.perm-dialog')).toBeVisible({ timeout: 60_000 });
        await popup.locator('dialog.perm-dialog .perm-dialog-deny').click();
        await expect(page.locator('#log [data-entry="perm:driver:false"]')).toBeVisible();

        expect(await page.evaluate(() => !!puter.authToken)).toBe(false);
        expect(await page.evaluate(() => localStorage.getItem('puter.auth.token.v2'))).toBeNull();
    });
});

test.describe('puter.ui.requestPermission (env=web popup, first visit)', () => {
    // No Puter session at all: the popup takes the first-visit branch, which
    // creates a temp user. That path mints its own user-app token, so it has to
    // withhold it from the opener for the same reason the plain token exchange
    // does — otherwise a site that only ever asked about one permission walks
    // away signed in as a brand-new account.
    test.use({ storageState: { cookies: [], origins: [] } });

    test('creating a user to answer the prompt does not sign the site in', async ({ page }) => {
        await page.goto(PERMISSION_FIXTURE_URL);
        await page.locator('body.ready').waitFor({ timeout: 60_000 });
        expect(await page.evaluate(() => !!puter.authToken)).toBe(false);

        const [popup] = await Promise.all([
            page.waitForEvent('popup'),
            page.locator('#req-driver-perm').click(),
        ]);

        // The prompt still has to arrive: the first-visit path waits on the
        // spinner before handing back control, and that wait has to end for
        // any action that keeps the popup open.
        await expect(popup.locator('dialog.perm-dialog')).toBeVisible({ timeout: 60_000 });
        await popup.locator('dialog.perm-dialog .perm-dialog-deny').click();
        await expect(page.locator('#log [data-entry="perm:driver:false"]')).toBeVisible();

        expect(await page.evaluate(() => !!puter.authToken)).toBe(false);
        expect(await page.evaluate(() => localStorage.getItem('puter.auth.token.v2'))).toBeNull();
    });
});

test.describe('puter.ui.requestPermission (env=web, cross-origin-isolated)', () => {
    test('a signed-out isolated site is answered promptly instead of waiting out the poll', async ({ page, context }) => {
        // A cross-origin-isolated opener can't be reached by postMessage, so the
        // SDK falls back to polling /auth/check-permissions. That needs the
        // site's own token, and a permission popup deliberately never hands one
        // over — so with no token the poll can never succeed and used to burn
        // its full 5-minute timeout before resolving.
        await context.route(PERMISSION_FIXTURE_URL, async (route) => {
            const resp = await route.fetch();
            await route.fulfill({
                response: resp,
                headers: {
                    ...resp.headers(),
                    'cross-origin-opener-policy': 'same-origin',
                    'cross-origin-embedder-policy': 'credentialless',
                },
            });
        });

        await page.goto(PERMISSION_FIXTURE_URL);
        await page.locator('body.ready').waitFor({ timeout: 60_000 });
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await page.locator('body.ready').waitFor({ timeout: 60_000 });
        // Both preconditions the fallback depends on.
        expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
        expect(await page.evaluate(() => !!puter.authToken)).toBe(false);

        await page.locator('#req-driver-perm').click();
        await expect(page.locator('#log [data-entry="perm:driver:false"]'))
            .toBeVisible({ timeout: 30_000 });
    });
});

test.describe('request-permission action hardening', () => {
    test('an app_uid in the URL never produces a prompt on its own', async ({ page }) => {
        // The uid identifies who receives the grant, so it must come from the
        // requesting origin — never from the link. A link carrying only a uid
        // would otherwise prompt for an unnamed requester and grant to an app
        // the dialog never showed the user.
        await page.goto(
            '/action/request-permission?permission=driver%3Aputer-image-generation%3Agenerate' +
                '&app_uid=app-00000000-0000-4000-8000-000000000000',
        );
        await page.waitForFunction(() => !!window.puter?.authToken, null, { timeout: 60_000 });
        // Give the post-auth action a chance to run before asserting absence.
        await page.locator('.desktop').waitFor({ timeout: 60_000 });
        await expect(page.locator('dialog.perm-dialog')).toHaveCount(0);
    });

    test('`cross_origin_isolated` cannot turn a permission prompt into a token grant', async ({ page }) => {
        // That flag routes the user-app token to the opener via /login/set,
        // which the unauthenticated /login/wait then hands to whoever knows the
        // session id. It is a sign-in mechanism, so a permission popup must not
        // honour it — otherwise one extra query parameter both skips the prompt
        // and signs the site in.
        await page.goto('/');
        await page.waitForFunction(() => !!window.puter?.authToken, null, { timeout: 60_000 });
        await page.goto(PERMISSION_FIXTURE_URL);
        await page.locator('body.ready').waitFor({ timeout: 60_000 });

        const session = '11111111-2222-4333-8444-555555555555';
        const [popup] = await Promise.all([
            page.waitForEvent('popup'),
            page.evaluate(({ s }) => {
                // `/login/wait` is a long poll: it holds the request open until
                // a token is published for the session. So absence of a leak is
                // "still waiting", and a leak flips this flag within seconds.
                window.__leaked = 'waiting';
                (async () => {
                    for ( let i = 0; i < 10; i++ ) {
                        try {
                            const r = await fetch(`${puter.APIOrigin}/login/wait`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ session: s }),
                            });
                            if ( r.ok && (await r.json())?.auth_token ) {
                                window.__leaked = 'leaked';
                                return;
                            }
                        } catch (e) { /* keep waiting */ }
                    }
                })();
                window.open(
                    `${puter.defaultGUIOrigin}/action/request-permission?embedded_in_popup=true`
                        + `&cross_origin_isolated=true&signin_session=${s}`
                        + '&permission=driver%3Aputer-image-generation%3Agenerate&msg_id=77',
                    'perm-isolated-probe',
                    'width=600,height=700',
                );
            }, { s: session }),
        ]);

        // The prompt still has to be shown, and no token may reach the opener.
        await expect(popup.locator('dialog.perm-dialog')).toBeVisible({ timeout: 60_000 });
        await popup.locator('dialog.perm-dialog .perm-dialog-deny').click();
        await page.waitForTimeout(5000);
        expect(await page.evaluate(() => window.__leaked)).toBe('waiting');
    });

    test('a long hostname keeps its registrable domain visible', async ({ page }) => {
        // The identity line is the only thing naming the requester, so it must
        // not elide the end of the host: `accounts.google.com.attacker.example`
        // truncated on the right reads as `accounts.google.com…`.
        const host = 'accounts.google.com.attacker-run-domain.example';
        await page.goto(
            '/action/request-permission?permission=driver%3Aputer-image-generation%3Agenerate' +
                `&origin=${encodeURIComponent(`https://${host}/`)}`,
        );
        await page.waitForFunction(() => !!window.puter?.authToken, null, { timeout: 60_000 });
        const name = page.locator('dialog.perm-dialog .perm-dialog-entity-name');
        await expect(name).toBeVisible({ timeout: 60_000 });

        const info = await name.evaluate((el) => ({
            text: el.textContent,
            overflowing: el.scrollWidth > el.clientWidth,
            direction: getComputedStyle(el).direction,
        }));
        // The host is genuinely too long for the dialog, so the elision this
        // asserts about is actually happening.
        expect(info.text).toBe(host);
        expect(info.overflowing).toBe(true);
        // `direction: rtl` anchors the text to its end, so the ellipsis lands on
        // the left and the registrable domain stays on screen.
        expect(info.direction).toBe('rtl');
    });
});
