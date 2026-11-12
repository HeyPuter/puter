import { test, expect } from '@playwright/test';
import { registerTestApp, deleteTestApp, gotoTestApp, FIXTURE_URL } from '../helpers/testApp.js';

const COLOR_FIXTURE_URL = FIXTURE_URL.replace(
    'menubar-contextmenu.html',
    'color-picker.html',
);

test.describe('puter.ui.showColorPicker (env=app)', () => {
    for ( const [buttonId, label] of [
        ['color-string', 'a short hex string'],
        ['color-default-color', '{ defaultColor }'],
        ['color-default-value', '{ defaultValue }'],
        ['color-hex8', 'an 8-digit hex'],
    ] ) {
        test(`opens on the default color given as ${label} and resolves it`, async ({ page }) => {
            const appName = await registerTestApp(page, { fixtureURL: COLOR_FIXTURE_URL });
            try {
                const appFrame = await gotoTestApp(page, appName);

                await appFrame.locator(`#${buttonId}`).click();
                // The desktop shows puter.js's own picker, not a desktop window.
                const picker = page.locator('puter-color-picker');
                await expect(picker.locator('dialog')).toBeVisible({ timeout: 15_000 });
                await expect(picker.locator('.hex-input')).toHaveValue('#AABBCC');

                await picker.locator('.btn-ok').click();
                await expect(picker).toHaveCount(0);
                await expect(appFrame.locator('#log [data-entry="color:#aabbcc"]')).toBeVisible();
            } finally {
                await deleteTestApp(page, appName);
            }
        });
    }

    test('resolves the swatch the user picks', async ({ page }) => {
        const appName = await registerTestApp(page, { fixtureURL: COLOR_FIXTURE_URL });
        try {
            const appFrame = await gotoTestApp(page, appName);

            await appFrame.locator('#color-string').click();
            const picker = page.locator('puter-color-picker');
            await expect(picker.locator('dialog')).toBeVisible({ timeout: 15_000 });

            await picker.locator('.swatch[data-color="#ff0000"]').click();
            await picker.locator('.btn-ok').click();
            await expect(appFrame.locator('#log [data-entry="color:#ff0000"]')).toBeVisible();
        } finally {
            await deleteTestApp(page, appName);
        }
    });

    for ( const [how, dismiss] of [
        ['Cancel', (picker) => picker.locator('.btn-cancel').click()],
        ['Escape', (_, page) => page.keyboard.press('Escape')],
    ] ) {
        test(`resolves null when the picker is closed with ${how}`, async ({ page }) => {
            const appName = await registerTestApp(page, { fixtureURL: COLOR_FIXTURE_URL });
            try {
                const appFrame = await gotoTestApp(page, appName);

                await appFrame.locator('#color-string').click();
                const picker = page.locator('puter-color-picker');
                await expect(picker.locator('dialog')).toBeVisible({ timeout: 15_000 });

                await dismiss(picker, page);
                await expect(picker).toHaveCount(0);
                await expect(appFrame.locator('#log [data-entry="color:null"]')).toBeVisible();
            } finally {
                await deleteTestApp(page, appName);
            }
        });
    }
});
