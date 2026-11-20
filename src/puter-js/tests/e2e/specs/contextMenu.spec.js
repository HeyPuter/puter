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

    test('choosing an item in a submenu of a submenu closes the whole menu', async ({ page }) => {
        const appName = await registerTestApp(page);
        try {
            const appFrame = await gotoTestApp(page, appName);

            await appFrame.locator('#ctx-trigger-nested').click();

            // Each submenu opens a moment after its row is pointed at or tapped.
            const row = (label) => page.locator('.context-menu:visible .context-menu-item', { hasText: label }).last();
            await row('CtxOuter').click();
            await expect(row('CtxOuterItem')).toBeVisible();
            await row('CtxInner').click();
            await expect(row('CtxInnerItem')).toBeVisible();

            await row('CtxInnerItem').click();

            await expect(page.locator('.context-menu')).toHaveCount(0);
            // On a phone the menu is a sheet over a backdrop, which goes with it.
            await expect(page.locator('.context-menu-sheet-backdrop')).toHaveCount(0);
        } finally {
            await deleteTestApp(page, appName);
        }
    });

    test('a submenu of a submenu closes with the submenu it belongs to', async ({ page, isMobile }) => {
        // A phone shows one sheet at a time, so there is no row to point back at.
        test.skip(isMobile, 'pointer only');
        const appName = await registerTestApp(page);
        try {
            const appFrame = await gotoTestApp(page, appName);

            await appFrame.locator('#ctx-trigger-nested').click();

            const row = (label) => page.locator('.context-menu:visible .context-menu-item', { hasText: label }).last();
            await row('CtxOuter').click();
            await expect(row('CtxOuterItem')).toBeVisible();
            await row('CtxInner').click();
            await expect(row('CtxInnerItem')).toBeVisible();
            await expect(page.locator('.context-menu')).toHaveCount(3);

            // Move onto another row of the root menu, as a hand does: in steps.
            const plain = await row('CtxPlain').boundingBox();
            await page.mouse.move(plain.x + 20, plain.y + plain.height / 2, { steps: 5 });
            await page.mouse.move(plain.x + 40, plain.y + plain.height / 2, { steps: 5 });

            await expect(page.locator('.context-menu')).toHaveCount(1);
        } finally {
            await deleteTestApp(page, appName);
        }
    });
});
