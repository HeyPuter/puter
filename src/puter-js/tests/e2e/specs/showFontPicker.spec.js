import { test, expect } from '@playwright/test';
import { registerTestApp, deleteTestApp, gotoTestApp, FIXTURE_URL } from '../helpers/testApp.js';

const FONT_PICKER_FIXTURE_URL = FIXTURE_URL.replace(
    'menubar-contextmenu.html',
    'font-picker.html',
);

test.describe('puter.ui.showFontPicker (env=app)', () => {
    let appName;

    test.beforeEach(async ({ page }) => {
        appName = await registerTestApp(page, { fixtureURL: FONT_PICKER_FIXTURE_URL });
    });

    test.afterEach(async ({ page }) => {
        await deleteTestApp(page, appName);
    });

    // The preselected font sits far down the list, so the picker must scroll to
    // it once the window is shown and still accept a different choice.
    for ( const trigger of ['#pick-default-font', '#pick-default-value', '#pick-string'] ) {
        test(`${trigger} preselects the default font and resolves the chosen one`, async ({ page }) => {
            const appFrame = await gotoTestApp(page, appName);
            await appFrame.locator(trigger).click();

            const picker = page.locator('.window[data-app="font-picker"]');
            const active = picker.locator('.font-selector-active');
            await expect(active).toHaveAttribute('data-font-family', 'Verdana');
            await expect(active).toBeInViewport();

            await picker.locator('.font-selector[data-font-family="Arial"]').click();
            await picker.locator('.select-btn').click();

            await expect(appFrame.locator('#log [data-entry="font:Arial"]')).toBeVisible();
            await expect(picker).toHaveCount(0);
        });
    }
});
