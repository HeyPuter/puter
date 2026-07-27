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

    test('a malformed options argument is denied rather than left hanging', async ({ page }) => {
        // `typeof null === 'object'`, so a null `options` slipped past the
        // "must be an object" guard and faulted on the `.permission` read —
        // before any reply had been posted, leaving the caller's promise
        // pending forever. env=web already answered false for the same input.
        const appName = await registerTestApp(page, { fixtureURL: PERMISSION_FIXTURE_URL });
        try {
            const appFrame = await gotoTestApp(page, appName);
            const outcome = await appFrame.locator('body').evaluate(async () => {
                const settled = puter.ui.requestPermission(null).then(
                    v => `resolved:${v}`,
                    e => `rejected:${e?.message ?? e}`,
                );
                return Promise.race([
                    settled,
                    new Promise(r => setTimeout(() => r('never settled'), 10_000)),
                ]);
            });
            expect(outcome).toBe('resolved:false');
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

    test('a grant that is still hanging when the dialog is force-closed is withdrawn too', async ({ page, context }) => {
        // Same reconciliation, reached through the timeout instead of an error
        // response. The timeout aborts the request, and the abort's rejection is
        // only delivered as a microtask — it cannot run until the timer callback
        // returns. So when the dialog has already been force-closed (the close
        // watcher can bypass the `cancel` handler), the timer settles the dialog
        // as a denial *before* the outcome is recorded as unknown, and the
        // permission the request may have committed is left behind, granted,
        // with the app told it was refused.
        const appName = await registerTestApp(page, { fixtureURL: PERMISSION_FIXTURE_URL });
        const permission = 'driver:puter-image-generation:generate';
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

            // Grant it for real first, so there is a live row the withdrawal
            // has to remove.
            await appFrame.locator('#req-driver-perm').click();
            await expect(dialog).toBeVisible();
            await dialog.locator('.perm-dialog-allow').click();
            await expect(appFrame.locator('#log [data-entry="perm:driver:true"]')).toBeVisible();
            expect(await isGrantedTo(appUid)).toBe(true);

            // Hang the next grant past the dialog's 15s time-box.
            let revoked = false;
            await context.route('**/auth/grant-user-app', async () => {
                await new Promise(r => setTimeout(r, 60_000));
            });
            await context.route('**/auth/revoke-user-app', async (route) => {
                revoked = true;
                await route.continue();
            });

            await appFrame.locator('#req-driver-perm').click();
            await expect(dialog).toBeVisible();
            await dialog.locator('.perm-dialog-allow').click();
            await expect(dialog.locator('.perm-dialog-allow.perm-dialog-busy')).toBeVisible();

            // What the close watcher does on a repeated close request: close
            // without firing a cancelable `cancel`, while the grant is still in
            // flight. There is then no retry UI left, so the timeout has to
            // settle it — as a denial it must reconcile.
            await page.evaluate(() => {
                document.querySelector('dialog.perm-dialog')?.close();
            });

            await expect(appFrame.locator('#log [data-entry="perm:driver:false"]'))
                .toBeVisible({ timeout: 30_000 });
            await expect.poll(() => revoked, { timeout: 20_000 }).toBe(true);
            await expect.poll(() => isGrantedTo(appUid), { timeout: 20_000 }).toBe(false);
        } finally {
            await context.unroute('**/auth/grant-user-app');
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
        // And marked as a host, which is what buys the left-elision asserted on
        // further down. Without this class a long host truncates on the wrong
        // end, so the real flow has to be the thing that applies it.
        await expect(dialog.locator('.perm-dialog-entity-name'))
            .toHaveClass(/perm-dialog-entity-host/);
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

    test('a non-canonical configured origin still hears the decision', async ({ page }) => {
        // `defaultGUIOrigin` is configuration-supplied text, while the popup's
        // messages arrive tagged with the browser's canonical origin
        // serialization. A trailing slash used to fail the raw comparison and
        // drop both messages — and a dropped `permissionPromptReady` makes the
        // popup's close read as a severed opener, reporting the grant the user
        // just made as a denial. The SDK compares canonical-to-canonical now.
        await page.goto('/');
        await page.waitForFunction(() => !!window.puter?.authToken, null, { timeout: 60_000 });

        await page.goto(PERMISSION_FIXTURE_URL);
        await page.locator('body.ready').waitFor({ timeout: 60_000 });
        // Re-point the SDK at the same GUI through a non-canonical string.
        // The getter reads `globalThis.PUTER_ORIGIN` on every access, so this
        // takes effect for the request below.
        await page.evaluate(() => {
            globalThis.PUTER_ORIGIN = `${window.PUTER_ORIGIN}/`;
        });

        const [popup] = await Promise.all([
            page.waitForEvent('popup'),
            page.locator('#req-driver-perm').click(),
        ]);
        const dialog = popup.locator('dialog.perm-dialog');
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

    test('a refused window.open denies instead of rejecting', async ({ page }) => {
        // requestPermission is documented `Promise<boolean>` and every handled
        // path resolves false. `window.open` refused outright — by a policy or
        // an override that throws rather than returning null — used to escape
        // the launch branch and reject, since only the consent-dialog path was
        // wrapped.
        await page.goto('/');
        await page.waitForFunction(() => !!window.puter?.authToken, null, { timeout: 60_000 });
        await page.goto(PERMISSION_FIXTURE_URL);
        await page.locator('body.ready').waitFor({ timeout: 60_000 });

        const outcome = await page.evaluate(async () => {
            window.open = () => { throw new Error('blocked by policy'); };
            const settled = puter.ui.requestPermission({
                permission: 'driver:puter-image-generation:generate',
            }).then(v => `resolved:${v}`, e => `rejected:${e?.message ?? e}`);
            return Promise.race([
                settled,
                new Promise(r => setTimeout(() => r('never settled'), 10_000)),
            ]);
        });
        expect(outcome).toBe('resolved:false');
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

    test('a close moments after the popup opens is answered, not waited out', async ({ page }) => {
        // The site is signed in, so the server-poll fallback has a token and
        // will run if the close is mistaken for a severed opener — burning its
        // whole 5-minute timeout before answering, because a denial writes
        // nothing for it to observe. A close this early used to land inside the
        // window that was read as severing, so dismissing the popup on sight
        // left the caller's promise pending for minutes instead of answering.
        await page.goto('/');
        await page.waitForFunction(() => !!window.getUserAppToken && !!window.auth_token,
            null, { timeout: 60_000 });
        const fixtureOrigin = new URL(PERMISSION_FIXTURE_URL).origin;
        const appToken = await page.evaluate(
            async (origin) => (await window.getUserAppToken(origin))?.token,
            fixtureOrigin,
        );
        await page.evaluate(async ({ origin, perm }) => {
            await fetch(`${window.api_origin}/auth/revoke-user-app`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${window.auth_token}`,
                },
                body: JSON.stringify({ origin, permission: perm }),
            });
        }, { origin: fixtureOrigin, perm: 'driver:puter-image-generation:generate' });

        await page.goto(PERMISSION_FIXTURE_URL);
        await page.locator('body.ready').waitFor({ timeout: 60_000 });
        await page.evaluate((t) => puter.setAuthToken(t), appToken);

        const [popup] = await Promise.all([
            page.waitForEvent('popup'),
            page.locator('#req-driver-perm').click(),
        ]);
        // Closed as soon as the popup has announced itself, which is the
        // earliest point a real user could have seen the window — and far
        // inside the old cutoff.
        await popup.waitForFunction(() => !!window.openerOrigin, null, { timeout: 30_000 });
        await popup.close();
        await expect(page.locator('#log [data-entry="perm:driver:false"]'))
            .toBeVisible({ timeout: 20_000 });
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

test.describe('puter.ui.requestPermission (env=web, COOP-only opener)', () => {
    test('a site that only sets COOP is not answered before the user has decided', async ({ page, context }) => {
        // `Cross-Origin-Opener-Policy: same-origin` without COEP severs the
        // opener relationship — but only when the popup's navigation *commits*,
        // a couple of hundred milliseconds after `window.open()` returns. So the
        // severed-opener check that runs synchronously after opening cannot see
        // it, and the severing instead surfaces as `popup.closed` flipping true
        // while the popup is still loading. Treating that as a close reported a
        // denial about a second after the click — before the user had even seen
        // the dialog — and then the Allow they went on to click committed a
        // grant the site had been told it did not get.
        const permission = 'driver:puter-image-generation:generate';

        // Hand the site a token for its *own* app, the way a signed-in
        // third-party site holds one. Without it the poll fallback has nothing
        // to authenticate with and answers false immediately (covered above),
        // and `/auth/check-permissions` has to run as this app-under-user actor
        // for a user→app grant to be visible at all.
        // `window.api_origin` / `window.auth_token`, not the SDK's: the
        // prod-built GUI bundles an SDK pointed at api.puter.com, so
        // `puter.APIOrigin` on this page is production.
        await page.goto('/');
        await page.waitForFunction(() => !!window.getUserAppToken && !!window.auth_token,
            null, { timeout: 60_000 });
        const fixtureOrigin = new URL(PERMISSION_FIXTURE_URL).origin;
        const appToken = await page.evaluate(
            async (origin) => (await window.getUserAppToken(origin))?.token,
            fixtureOrigin,
        );
        expect(typeof appToken).toBe('string');

        // Earlier tests grant this same permission to the fixture origin's app,
        // and the row outlives them — clear it so the poll starting out true
        // can't pass this test on its own.
        await page.evaluate(async ({ origin, perm }) => {
            await fetch(`${window.api_origin}/auth/revoke-user-app`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${window.auth_token}`,
                },
                body: JSON.stringify({ origin, permission: perm }),
            });
        }, { origin: fixtureOrigin, perm: permission });

        await context.route(PERMISSION_FIXTURE_URL, async (route) => {
            const resp = await route.fetch();
            await route.fulfill({
                response: resp,
                headers: {
                    ...resp.headers(),
                    'cross-origin-opener-policy': 'same-origin',
                },
            });
        });

        await page.goto(PERMISSION_FIXTURE_URL);
        await page.locator('body.ready').waitFor({ timeout: 60_000 });
        // COOP-only: severed, but *not* cross-origin-isolated (that needs COEP
        // too), so the isolation check above does not catch this case.
        expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(false);
        await page.evaluate((t) => puter.setAuthToken(t), appToken);

        const [popup] = await Promise.all([
            page.waitForEvent('popup'),
            page.locator('#req-driver-perm').click(),
        ]);
        const dialog = popup.locator('dialog.perm-dialog');
        await expect(dialog).toBeVisible({ timeout: 60_000 });

        // Long enough to cover the severing (~200ms) and the close grace
        // period (1s), with room to spare.
        await page.waitForTimeout(5000);
        expect(await page.locator('#log [data-entry="perm:driver:false"]').count()).toBe(0);
        expect(await page.locator('#log [data-entry="perm:driver:true"]').count()).toBe(0);

        // The answer itself has to come from the server poll, since the popup
        // cannot reach a severed opener. That leg is not asserted here: the poll
        // is a direct site→API request, and Chrome refuses it from this
        // loopback fixture origin ("Permission was denied for this request to
        // access the `loopback` address space"), which does not apply to the
        // https origins this runs on in production. The grant still has to
        // succeed, which is what the popup is left to do.
        const granted = popup.waitForResponse(
            (r) => r.url().includes('/auth/grant-user-app') && r.status() === 200,
            { timeout: 30_000 },
        );
        await dialog.locator('.perm-dialog-allow').click();
        await granted;
        // Polled rather than awaiting the `close` event: the popup closes itself
        // as soon as it has answered, which can happen before a listener
        // registered after the click is attached.
        await expect.poll(() => popup.isClosed(), { timeout: 30_000 }).toBe(true);
    });

    test('a slow popup navigation is still recognised as a severed opener', async ({ page, context }) => {
        // Severing surfaces as `popup.closed` flipping true when the popup's
        // navigation commits, so how long that takes decides nothing about
        // whether the opener link survived. Classifying a close by elapsed time
        // therefore broke as soon as the commit was slow: past the cutoff the
        // severing read as a user close, and the site was told "denied" about a
        // second later — while the prompt was still coming up, and before the
        // user had decided anything. What separates the two is whether the popup
        // ever announced itself, which only reaches an opener that is still
        // attached.
        const permission = 'driver:puter-image-generation:generate';

        await page.goto('/');
        await page.waitForFunction(() => !!window.getUserAppToken && !!window.auth_token,
            null, { timeout: 60_000 });
        const fixtureOrigin = new URL(PERMISSION_FIXTURE_URL).origin;
        const appToken = await page.evaluate(
            async (origin) => (await window.getUserAppToken(origin))?.token,
            fixtureOrigin,
        );
        // Earlier tests leave this permission granted to the fixture origin's
        // app; clear it so a poll that starts out true can't mask a premature
        // denial.
        await page.evaluate(async ({ origin, perm }) => {
            await fetch(`${window.api_origin}/auth/revoke-user-app`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${window.auth_token}`,
                },
                body: JSON.stringify({ origin, permission: perm }),
            });
        }, { origin: fixtureOrigin, perm: permission });

        await context.route(PERMISSION_FIXTURE_URL, async (route) => {
            const resp = await route.fetch();
            await route.fulfill({
                response: resp,
                headers: {
                    ...resp.headers(),
                    'cross-origin-opener-policy': 'same-origin',
                },
            });
        });
        // Hold the popup document back so its navigation — and with it the
        // severing — commits well after the old 3s cutoff.
        await context.route('**/action/request-permission*', async (route) => {
            await new Promise(r => setTimeout(r, 4500));
            await route.continue();
        });

        await page.goto(PERMISSION_FIXTURE_URL);
        await page.locator('body.ready').waitFor({ timeout: 60_000 });
        expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(false);
        await page.evaluate((t) => puter.setAuthToken(t), appToken);

        await Promise.all([
            page.waitForEvent('popup'),
            page.locator('#req-driver-perm').click(),
        ]);

        // Past the delayed commit and the grace period that follows it: the
        // requester must still be waiting, not holding a denial it was handed
        // while the user was reading the prompt.
        await page.waitForTimeout(9000);
        expect(await page.locator('#log [data-entry="perm:driver:false"]').count()).toBe(0);
        expect(await page.locator('#log [data-entry="perm:driver:true"]').count()).toBe(0);
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

test.describe('request-permission popup reconciliation', () => {
    test('a denial after an uncertain grant is withdrawn even though the popup closes itself', async ({ page, context }) => {
        // Same reconciliation the env=app suite covers, but in the popup flow,
        // where answering is immediately followed by `window.close()`. The
        // withdrawal request is fired from the closing document, so unless it
        // is sent `keepalive` the browser cancels it with the popup — leaving
        // the user told "denied" while the grant is live in their account.
        const permission = 'driver:puter-image-generation:generate';
        const fixtureOrigin = new URL(PERMISSION_FIXTURE_URL).origin;

        // A GUI-origin page for server-side state checks: the fixture origin
        // cannot fetch the API directly (Chrome blocks loopback-address
        // requests from it), but the GUI origin can.
        await page.goto('/');
        await page.waitForFunction(() => !!window.getUserAppToken && !!window.auth_token,
            null, { timeout: 60_000 });
        const appUid = await page.evaluate(
            async (origin) => (await window.getUserAppToken(origin))?.app_uid,
            fixtureOrigin,
        );
        expect(typeof appUid).toBe('string');
        const checker = await context.newPage();
        await checker.goto('/');
        await checker.waitForFunction(() => !!window.auth_token, null, { timeout: 60_000 });
        const isGranted = () => checker.evaluate(async ({ perm, uid }) => {
            const res = await fetch(`${window.api_origin}/auth/list-permissions`, {
                headers: { 'Authorization': `Bearer ${window.auth_token}` },
            });
            const body = await res.json();
            return body.myself_to_app.some(
                r => r.permission === perm && r.app_uid === uid,
            );
        }, { perm: permission, uid: appUid });

        await page.goto(PERMISSION_FIXTURE_URL);
        await page.locator('body.ready').waitFor({ timeout: 60_000 });

        // Grant for real first, so there is a live row the withdrawal must
        // remove.
        let [popup] = await Promise.all([
            page.waitForEvent('popup'),
            page.locator('#req-driver-perm').click(),
        ]);
        await expect(popup.locator('dialog.perm-dialog')).toBeVisible({ timeout: 60_000 });
        await popup.locator('dialog.perm-dialog .perm-dialog-allow').click();
        await expect(page.locator('#log [data-entry="perm:driver:true"]')).toBeVisible();
        expect(await isGranted()).toBe(true);

        // Now make the next grant's outcome unknowable (a 5xx says nothing
        // about whether the row was written — and here one already is).
        await context.route('**/auth/grant-user-app', route =>
            route.fulfill({ status: 502, body: '{}' }));

        [popup] = await Promise.all([
            page.waitForEvent('popup'),
            page.locator('#req-driver-perm').click(),
        ]);
        const dialog = popup.locator('dialog.perm-dialog');
        await expect(dialog).toBeVisible({ timeout: 60_000 });
        await dialog.locator('.perm-dialog-allow').click();
        await expect(dialog.locator('.perm-dialog-error')).toBeVisible({ timeout: 30_000 });
        await dialog.locator('.perm-dialog-deny').click();

        // The popup answers and closes itself; the withdrawal must survive it.
        await expect(page.locator('#log [data-entry="perm:driver:false"]')).toBeVisible();
        await expect.poll(() => popup.isClosed(), { timeout: 15_000 }).toBe(true);
        await expect.poll(isGranted, { timeout: 20_000 }).toBe(false);
    });
});

test.describe('grant-user-app permission length', () => {
    test('a deep fs path is measured after the server rewrites it to a uid', async ({ page }) => {
        // `fs:/path:mode` is rewritten to `fs:<uuid>:mode` before storage, so
        // the row is ~44 chars however deep the path is. Measuring the
        // caller's raw string instead rejected grants whose stored value was
        // comfortably inside the column, and the permission dialog dead-ended
        // on its retryable error for any deeply nested file. The oversized
        // string that no rewriter shortens must still be refused.
        await page.goto('/');
        await page.waitForFunction(() => !!window.auth_token && !!window.getUserAppToken,
            null, { timeout: 60_000 });

        const out = await page.evaluate(async () => {
            const api = window.api_origin;
            const token = window.auth_token;
            const post = (path, body) => fetch(`${api}${path}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify(body),
            }).then(r => r.status);

            const appUid = (await window.getUserAppToken('https://longpath-e2e.example'))?.app_uid;
            const segments = Array.from({ length: 34 },
                (_, i) => `seg${String(i).padStart(6, '0')}`);
            const deepDir = `/${window.user.username}/${segments.join('/')}`;
            await puter.fs.mkdir(deepDir, { createMissingParents: true, overwrite: false })
                .catch(() => {});
            const entry = await puter.fs.stat({ path: deepDir });

            const longPathStatus = await post('/auth/grant-user-app', {
                app_uid: appUid, permission: `fs:${deepDir}:read`,
            });
            // Nothing rewrites this one, so it is genuinely too wide.
            const oversizedStatus = await post('/auth/grant-user-app', {
                app_uid: appUid, permission: `service:${'a'.repeat(300)}:ii:read`,
            });

            const body = await fetch(`${api}/auth/list-permissions`, {
                headers: { 'Authorization': `Bearer ${token}` },
            }).then(r => r.json());
            return {
                permissionLength: `fs:${deepDir}:read`.length,
                longPathStatus,
                oversizedStatus,
                storedRewritten: body.myself_to_app.some(
                    r => r.app_uid === appUid && r.permission === `fs:${entry.uid}:read`,
                ),
            };
        });

        expect(out.permissionLength).toBeGreaterThan(255);
        expect(out.longPathStatus).toBe(200);
        expect(out.storedRewritten).toBe(true);
        expect(out.oversizedStatus).toBe(400);
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

    test('the grant names the requester by origin only, never by a browser-computed uid', async ({ page, context }) => {
        // A uid computed in the browser is unsafe to forward even when it came
        // from the server: an origin with no app row of its own resolves to a
        // *synthetic* `app-<uuidv5(origin)>`, and the grant endpoint resolves
        // `app_uid` as uid-*or-name*. Forwarding it would hand the grant to
        // whoever registered an app under that literal name — a name derived
        // from a published namespace constant, so it can be squatted offline —
        // while the dialog named the origin. Sending the origin alone is what
        // makes the server resolve the same requester the user was shown, and
        // reject it outright unless it names an app that really exists.
        await page.goto('/');
        await page.waitForFunction(() => !!window.puter?.authToken, null, { timeout: 60_000 });
        await page.goto(PERMISSION_FIXTURE_URL);
        await page.locator('body.ready').waitFor({ timeout: 60_000 });

        const grantBodies = [];
        await context.route('**/auth/grant-user-app', async (route) => {
            grantBodies.push(route.request().postDataJSON());
            await route.continue();
        });

        const [popup] = await Promise.all([
            page.waitForEvent('popup'),
            page.locator('#req-driver-perm').click(),
        ]);
        const dialog = popup.locator('dialog.perm-dialog');
        await expect(dialog).toBeVisible({ timeout: 60_000 });
        await dialog.locator('.perm-dialog-allow').click();
        await expect(page.locator('#log [data-entry="perm:driver:true"]')).toBeVisible();

        expect(grantBodies.length).toBeGreaterThan(0);
        for ( const body of grantBodies ) {
            expect(body.app_uid).toBeUndefined();
            expect(typeof body.origin).toBe('string');
        }
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

    test('`opener_origin` cannot rename the requester on the prompt', async ({ page }) => {
        // That parameter exists so a sign-in popup can carry its opener's origin
        // across an OIDC redirect. On a permission prompt the opener's origin is
        // the requester's identity, so honouring a link-supplied one would let any
        // site raise a prompt in another app's name — and land the grant on that
        // app. The popup must name the origin the browser attests to instead.
        await page.goto('/');
        await page.waitForFunction(() => !!window.puter?.authToken, null, { timeout: 60_000 });
        await page.goto(PERMISSION_FIXTURE_URL);
        await page.locator('body.ready').waitFor({ timeout: 60_000 });

        const spoofed = 'https://not-the-requester.example';
        const [popup] = await Promise.all([
            page.waitForEvent('popup'),
            page.evaluate((o) => {
                window.open(
                    `${puter.defaultGUIOrigin}/action/request-permission?embedded_in_popup=true`
                        + `&opener_origin=${encodeURIComponent(o)}`
                        + '&permission=driver%3Aputer-image-generation%3Agenerate&msg_id=88',
                    'perm-opener-origin-probe',
                    'width=600,height=700',
                );
            }, spoofed),
        ]);

        const name = popup.locator('dialog.perm-dialog .perm-dialog-entity-name');
        await expect(name).toBeVisible({ timeout: 60_000 });
        await expect(name).toContainText('localhost');
        await expect(name).not.toContainText('not-the-requester.example');
    });

    test('a URL-supplied origin never produces a prompt either', async ({ page }) => {
        // Same rule as the `app_uid` case above, for the other identifier a link
        // can carry. The origin is the requester's identity — the name the dialog
        // shows *and* what the server resolves into the app the grant is written
        // against — so it may only come from a source the browser vouches for
        // (the referrer, or the opener's reply to the `requestOrigin`
        // handshake). Believing the query string would let a bare link raise a
        // consent prompt in any app's name and commit the user's grant to it.
        await page.goto(
            '/action/request-permission?permission=driver%3Aputer-image-generation%3Agenerate' +
                `&origin=${encodeURIComponent('https://not-the-requester.example/')}`,
        );
        await page.waitForFunction(() => !!window.puter?.authToken, null, { timeout: 60_000 });
        await page.locator('.desktop').waitFor({ timeout: 60_000 });
        await expect(page.locator('dialog.perm-dialog')).toHaveCount(0);
    });

    test('a long hostname keeps its registrable domain visible', async ({ page }) => {
        // The identity line is the only thing naming the requester, so it must
        // not elide the end of the host: `accounts.google.com.attacker.example`
        // truncated on the right reads as `accounts.google.com…`.
        //
        // Driven against the dialog's own markup rather than through a request,
        // because there is no longer any way to hand the flow an arbitrary host:
        // the origin has to be browser-attested, and the fixture's opener is
        // whatever host the test server runs on. What is asserted here is the CSS
        // contract that produces the elision; that the real flow marks a site's
        // identity line with `perm-dialog-entity-host` — the class the contract
        // keys on — is asserted in the popup test above.
        const host = 'accounts.google.com.attacker-run-domain.example';
        await page.goto('/');
        await page.waitForFunction(() => !!window.puter?.authToken, null, { timeout: 60_000 });
        await page.evaluate((h) => {
            const el = document.createElement('dialog');
            el.className = 'perm-dialog';
            el.innerHTML = '<div class="perm-dialog-body">'
                + '<div class="perm-dialog-identity">'
                + '<h1 class="perm-dialog-entity-name perm-dialog-entity-host"></h1>'
                + '</div></div>';
            el.querySelector('h1').textContent = h;
            document.body.appendChild(el);
            el.showModal();
        }, host);
        const name = page.locator('dialog.perm-dialog .perm-dialog-entity-name');
        await expect(name).toBeVisible({ timeout: 60_000 });

        // Measured from what is actually on screen, not from the declared
        // `direction`: `unicode-bidi: plaintext` leaves `direction: rtl`
        // computing as `rtl` while taking the real base direction from the
        // content's first strong character, which for any Latin host put the
        // ellipsis back on the right. Asserting the property passed while the
        // rendering did the opposite of what it claims.
        const info = await name.evaluate((el) => {
            const node = el.firstChild;
            const box = el.getBoundingClientRect();
            const rectOf = (i) => {
                const r = document.createRange();
                r.setStart(node, i);
                r.setEnd(node, i + 1);
                return r.getBoundingClientRect();
            };
            const text = node.textContent;
            const visible = [];
            for ( let i = 0; i < text.length; i++ ) {
                const r = rectOf(i);
                if ( r.left >= box.left - 1 && r.right <= box.right + 1 ) {
                    visible.push({ ch: text[i], i, left: r.left });
                }
            }
            return {
                text,
                overflowing: el.scrollWidth > el.clientWidth,
                visibleText: visible.map((c) => c.ch).join(''),
                // Still reads left-to-right, in source order: anchoring the box
                // to its end must not reorder the host itself.
                readsInOrder: visible.every((c, k) => k === 0
                    || (c.i > visible[k - 1].i && c.left >= visible[k - 1].left)),
            };
        });
        // The host is genuinely too long for the dialog, so the elision this
        // asserts about is actually happening.
        expect(info.text).toBe(host);
        expect(info.overflowing).toBe(true);
        // What survives the ellipsis is the end of the host — the part that says
        // who is really asking — not the trusted-looking prefix.
        expect(info.visibleText.endsWith('attacker-run-domain.example')).toBe(true);
        expect(info.readsInOrder).toBe(true);
    });
});
