import { test, expect } from '@playwright/test';
import { registerTestApp, deleteTestApp, gotoTestApp } from '../helpers/testApp.js';

test.describe('puter.ui.contextMenu (env=app)', () => {
    test('renders context menu and fires action when item is clicked', async ({ page }) => {
        const appName = await registerTestApp(page);
        try {
            const appFrame = await gotoTestApp(page, appName);

            await appFrame.locator('#ctx-trigger').click();

            const menu = page.locator('.context-menu:visible').last();
            await expect(menu).toBeVisible();

            const itemAlpha = menu.locator('.context-menu-item', { hasText: 'CtxAlpha' });
            const itemBeta = menu.locator('.context-menu-item', { hasText: 'CtxBeta' });
            await expect(itemAlpha).toBeVisible();
            await expect(itemBeta).toBeVisible();

            // This is the regression test for commit aa5e398e: on mobile viewports the
            // sheet backdrop must sit BELOW the menu so taps reach the items. If the
            // z-index regresses, the backdrop swallows this click and the action never
            // fires, leaving the log empty.
            await itemAlpha.click();
            await expect(appFrame.locator('#log [data-entry="ctx:CtxAlpha"]')).toBeVisible();
        } finally {
            await deleteTestApp(page, appName);
        }
    });

    test('clicking outside the context menu dismisses it', async ({ page }) => {
        const appName = await registerTestApp(page);
        try {
            const appFrame = await gotoTestApp(page, appName);

            await appFrame.locator('#ctx-trigger').click();
            const menu = page.locator('.context-menu:visible').last();
            await expect(menu).toBeVisible();

            // Click somewhere far from the menu.
            await page.mouse.click(5, 5);
            await expect(menu).toBeHidden();
        } finally {
            await deleteTestApp(page, appName);
        }
    });
});
