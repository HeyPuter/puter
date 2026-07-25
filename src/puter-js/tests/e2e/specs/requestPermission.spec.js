import { test, expect } from '@playwright/test';
import { registerTestApp, deleteTestApp, gotoTestApp, FIXTURE_URL } from '../helpers/testApp.js';

const PERMISSION_FIXTURE_URL = FIXTURE_URL.replace(
    'menubar-contextmenu.html',
    'request-permission.html',
);

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
