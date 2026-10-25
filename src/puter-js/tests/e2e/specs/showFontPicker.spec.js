import { test, expect } from '@playwright/test';
import { registerTestApp, deleteTestApp, gotoTestApp, FIXTURE_URL } from '../helpers/testApp.js';

const FONT_FIXTURE_URL = FIXTURE_URL.replace(
    'menubar-contextmenu.html',
    'font-picker.html',
);

test.describe('puter.ui.showFontPicker (env=app)', () => {
    for ( const [buttonId, label] of [
        ['font-string', 'a string argument'],
        ['font-default-font', '{ defaultFont }'],
        ['font-default-value', '{ defaultValue }'],
    ] ) {
        test(`preselects the default font with ${label}`, async ({ page }) => {
            const appName = await registerTestApp(page, { fixtureURL: FONT_FIXTURE_URL });
            try {
                const appFrame = await gotoTestApp(page, appName);

                await appFrame.locator(`#${buttonId}`).click();
                const dialog = page.locator('.window[data-app="font-picker"]');
                await expect(dialog).toBeVisible({ timeout: 15_000 });

                // Exactly one preselected entry, and it is the default we sent
                // (defaultValue is passed lowercase on purpose: the match is
                // case-insensitive).
                const active = dialog.locator('.font-selector-active');
                await expect(active).toHaveCount(1);
                await expect(active).toHaveAttribute('data-font-family', 'Georgia');

                await dialog.locator('.select-btn').click();
                await expect(appFrame.locator('#log [data-entry="font:Georgia"]')).toBeVisible();
            } finally {
                await deleteTestApp(page, appName);
            }
        });
    }
});
