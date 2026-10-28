import { test, expect } from '@playwright/test';
import { registerTestApp, deleteTestApp, gotoTestApp, waitForPuterReady, FIXTURE_URL } from '../helpers/testApp.js';

const ATTACH_FIXTURE_URL = FIXTURE_URL.replace(
    'menubar-contextmenu.html',
    'attach-custom-domain.html',
);

// The test instance runs without the custom domains backend, so the dialog
// shows its unavailable pane. Picking and adding domains needs that backend
// and is covered by the extension's own tests.

test.describe('puter.hosting.attach (env=app)', () => {
    test('the desktop hosts the dialog and closing it resolves null', async ({ page }) => {
        const appName = await registerTestApp(page, { fixtureURL: ATTACH_FIXTURE_URL });
        try {
            const appFrame = await gotoTestApp(page, appName);

            await appFrame.locator('#attach').click();
            const dialog = page.locator('.custom-domain-overlay');
            await expect(dialog).toBeVisible();
            // The site and the requesting app are named from the GUI's own
            // records, not from anything the app can style.
            await expect(dialog.locator('.custom-domain-intro')).toContainText('e2e-attach-site.');
            await expect(dialog.locator('.custom-domain-requester')).toContainText(appName);
            await expect(dialog.locator('[data-pane="unavailable"]')).toBeVisible({ timeout: 15_000 });

            await dialog.locator('.app-feedback-x').click();
            await expect(appFrame.locator('#log [data-entry="attach:null"]')).toBeVisible();
            await expect(dialog).toBeHidden();
        } finally {
            await deleteTestApp(page, appName);
        }
    });
});

test.describe('puter.hosting.attach (env=gui)', () => {
    test('rejects on the Puter desktop itself', async ({ page }) => {
        await page.goto('/');
        await waitForPuterReady(page);
        const code = await page.evaluate(() =>
            window.puter.hosting.attach('e2e-attach-site').then(() => 'resolved', (e) => e?.code));
        expect(code).toBe('not_available');
    });
});

test.describe('puter.hosting.attach (env=web popup)', () => {
    test('popup hosts the dialog, resolves null on close, and never hands the opener a token', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => !!window.puter?.authToken, null, { timeout: 60_000 });

        await page.goto(ATTACH_FIXTURE_URL);
        await page.locator('body.ready').waitFor({ timeout: 60_000 });

        const [popup] = await Promise.all([
            page.waitForEvent('popup'),
            page.locator('#attach').click(),
        ]);

        const dialog = popup.locator('.custom-domain-overlay');
        await expect(dialog).toBeVisible({ timeout: 60_000 });

        await popup.close();
        await expect(page.locator('#log [data-entry="attach:null"]')).toBeVisible({ timeout: 15_000 });

        // attach-custom-domain is a NON_AUTH popup action.
        const authToken = await page.evaluate(() => window.puter.authToken ?? null);
        expect(authToken).toBeNull();
    });
});
