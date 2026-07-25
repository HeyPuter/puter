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
});
