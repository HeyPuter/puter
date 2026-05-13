import { test, expect } from '@playwright/test';
import { registerTestApp, deleteTestApp, gotoTestApp } from '../helpers/testApp.js';

test.describe('puter.ui.setMenubar (env=app)', () => {
    test('renders menubar items in Puter desktop and fires action on click', async ({ page }) => {
        const appName = await registerTestApp(page);
        try {
            const appFrame = await gotoTestApp(page, appName);

            await appFrame.locator('#set-menubar-btn').click();

            // Menubar is rendered by Puter desktop in the parent frame, not the app iframe.
            const menubar = page.locator('.window-menubar:visible');
            await expect(menubar).toBeVisible();

            const fileItem = menubar.locator('.window-menubar-item', { hasText: 'TestFile' });
            const editItem = menubar.locator('.window-menubar-item', { hasText: 'TestEdit' });
            await expect(fileItem).toBeVisible();
            await expect(editItem).toBeVisible();

            // Top-level item with a direct action: click should fire it.
            await fileItem.click();
            await expect(appFrame.locator('#log [data-entry="menubar:TestFile"]')).toBeVisible();

            // Top-level item with subitems: click opens a dropdown context menu.
            await editItem.click();
            const dropdown = page.locator('.context-menu:visible').last();
            await expect(dropdown).toBeVisible();
            await expect(dropdown.locator('.context-menu-item', { hasText: 'TestUndo' })).toBeVisible();
            await dropdown.locator('.context-menu-item', { hasText: 'TestUndo' }).click();
            await expect(appFrame.locator('#log [data-entry="menubar:TestUndo"]')).toBeVisible();
        } finally {
            await deleteTestApp(page, appName);
        }
    });
});
