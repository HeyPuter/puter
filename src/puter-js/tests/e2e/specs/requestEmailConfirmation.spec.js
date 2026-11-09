import { test, expect } from '@playwright/test';
import { registerTestApp, deleteTestApp, gotoTestApp, FIXTURE_URL } from '../helpers/testApp.js';

const PUTER_ORIGIN = process.env.PUTER_TEST_ORIGIN || 'http://puter.localhost:4100';
const API_ORIGIN = PUTER_ORIGIN.replace('://', '://api.');
const CONFIRM_FIXTURE_URL = FIXTURE_URL.replace('menubar-contextmenu.html', 'request-email-confirmation.html');

/** Answers the code check as the server would for a right code, so no email has to be read. */
const routeConfirmEmail = (page) => page.context().route(`${API_ORIGIN}/confirm-email`, (route) => route.fulfill({
    status: route.request().method() === 'OPTIONS' ? 204 : 200,
    headers: {
        'access-control-allow-origin': PUTER_ORIGIN,
        'access-control-allow-headers': '*',
        'access-control-allow-credentials': 'true',
    },
    contentType: 'application/json',
    body: JSON.stringify({ email_confirmed: true }),
}));

/** Sets whether the desktop's user has confirmed their email. */
const setEmailConfirmed = (page, confirmed) =>
    page.evaluate((confirmed) => {
        window.user.is_temp = false;
        window.user.email_confirmed = confirmed;
    }, confirmed);

const codeWindow = (page) => page.locator('.window-confirm-email-using-code');

test.describe('puter.ui.requestEmailConfirmation (env=app)', () => {
    let appName;

    test.beforeEach(async ({ page }) => {
        appName = await registerTestApp(page, { fixtureURL: CONFIRM_FIXTURE_URL });
    });

    test.afterEach(async ({ page }) => {
        await deleteTestApp(page, appName);
    });

    test('a confirmed email resolves true without a dialog', async ({ page }) => {
        const appFrame = await gotoTestApp(page, appName);
        await setEmailConfirmed(page, true);

        await appFrame.locator('#confirm-email').click();

        await expect(appFrame.locator('#log [data-entry="confirm:true"]')).toBeVisible();
        await expect(codeWindow(page)).toHaveCount(0);
        await expect(appFrame.locator('#log [data-entry]')).toHaveCount(1);
    });

    test('entering the code shows one dialog and resolves true', async ({ page }) => {
        await routeConfirmEmail(page);
        const appFrame = await gotoTestApp(page, appName);
        await setEmailConfirmed(page, false);

        await appFrame.locator('#confirm-email').click();
        await expect(codeWindow(page)).toHaveCount(1);
        // A click, not fill(), so it fails if the app's window covers the dialog.
        await codeWindow(page).locator('.digit-input').first().click();
        await page.keyboard.type('123456');

        await expect(appFrame.locator('#log [data-entry="confirm:true"]')).toBeVisible({ timeout: 15_000 });
        // No second dialog opens after the first.
        await page.waitForTimeout(1000);
        await expect(codeWindow(page)).toHaveCount(0);
        await expect(appFrame.locator('#log [data-entry]')).toHaveCount(1);
    });

    test('closing the dialog resolves false', async ({ page }) => {
        const appFrame = await gotoTestApp(page, appName);
        await setEmailConfirmed(page, false);

        await appFrame.locator('#confirm-email').click();
        await expect(codeWindow(page)).toHaveCount(1);
        await codeWindow(page).locator('.generic-close-window-button').click();

        await expect(appFrame.locator('#log [data-entry="confirm:false"]')).toBeVisible();
        await expect(codeWindow(page)).toHaveCount(0);
    });

    test('a call made while the dialog shows gets its answer, with no second dialog', async ({ page }) => {
        const appFrame = await gotoTestApp(page, appName);
        await setEmailConfirmed(page, false);

        await appFrame.locator('#confirm-email').click();
        await expect(codeWindow(page)).toHaveCount(1);
        // The dialog covers the button, so the app calls again itself.
        await appFrame.locator('#confirm-email').evaluate((button) => button.click());
        await page.waitForTimeout(500);
        await expect(codeWindow(page)).toHaveCount(1);
        await codeWindow(page).locator('.generic-close-window-button').click();

        await expect(appFrame.locator('#log [data-entry="confirm:false"]')).toHaveCount(2);
    });

    test('a temporary account calling twice gets both answers from one save-account window', async ({ page }) => {
        const appFrame = await gotoTestApp(page, appName);
        await page.evaluate(() => {
            window.user.is_temp = true;
            window.user.email_confirmed = false;
        });
        const saveWindow = page.locator('.window-save-account');

        await appFrame.locator('#confirm-email').click();
        await expect(saveWindow).toHaveCount(1);
        await appFrame.locator('#confirm-email').evaluate((button) => button.click());
        await page.waitForTimeout(500);
        await expect(saveWindow).toHaveCount(1);
        await saveWindow.locator('.generic-close-window-button').click();

        await expect(appFrame.locator('#log [data-entry="confirm:false"]')).toHaveCount(2);
    });
});
