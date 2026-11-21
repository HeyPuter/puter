import { test, expect } from '@playwright/test';
import { registerTestApp, deleteTestApp, gotoTestApp, FIXTURE_URL } from '../helpers/testApp.js';

const PICKER_FIXTURE_URL = FIXTURE_URL.replace(
    'menubar-contextmenu.html',
    'file-picker.html',
);

const FOLDER = 'picker-e2e-folder';

// Opens the picker from the test app, on the Desktop folder with FOLDER in it.
async function openPicker (page, appName) {
    await page.evaluate(async (name) => {
        await window.puter.fs.mkdir(`~/Desktop/${name}`, { dedupeName: false }).catch(() => {});
    }, FOLDER);
    const appFrame = await gotoTestApp(page, appName);
    await appFrame.locator('#open-file').click();
    const picker = page.locator('.window[data-is_openFileDialog="true"]');
    await expect(picker.locator(`.item[data-name="${FOLDER}"]`)).toBeVisible({ timeout: 15_000 });
    return picker;
}

test.describe('puter.ui.showOpenFilePicker folders (env=app)', () => {
    // Right-click and ctrl/cmd + click have no touch equivalent.
    test.skip(({ isMobile }) => isMobile, 'desktop pointer and keyboard only');

    test('a folder\'s menu has no Open in New Window', async ({ page }) => {
        const appName = await registerTestApp(page, { fixtureURL: PICKER_FIXTURE_URL });
        try {
            const picker = await openPicker(page, appName);

            await picker.locator(`.item[data-name="${FOLDER}"]`).click({ button: 'right' });
            const menu = page.locator('.context-menu').last();
            await expect(menu).toBeVisible();
            await expect(menu).toContainText('Open');
            await expect(menu).not.toContainText('Open in New Window');
        } finally {
            await deleteTestApp(page, appName);
        }
    });

    test('ctrl/cmd + double-click opens a folder in the picker, not in a new window', async ({ page }) => {
        const appName = await registerTestApp(page, { fixtureURL: PICKER_FIXTURE_URL });
        try {
            const picker = await openPicker(page, appName);
            const windowCount = await page.locator('.window').count();

            await picker.locator(`.item[data-name="${FOLDER}"]`).dblclick({ modifiers: ['ControlOrMeta'] });

            await expect(picker).toHaveAttribute('data-path', new RegExp(`/Desktop/${FOLDER}$`));
            await expect(page.locator('.window')).toHaveCount(windowCount);
        } finally {
            await deleteTestApp(page, appName);
        }
    });

    test('ctrl/cmd + click on a sidebar folder opens it in the picker, not in a new window', async ({ page }) => {
        const appName = await registerTestApp(page, { fixtureURL: PICKER_FIXTURE_URL });
        try {
            const picker = await openPicker(page, appName);
            const windowCount = await page.locator('.window').count();

            await picker.locator('.window-sidebar-item[data-path$="/Documents"]').click({ modifiers: ['ControlOrMeta'] });

            await expect(picker).toHaveAttribute('data-path', /\/Documents$/);
            await expect(page.locator('.window')).toHaveCount(windowCount);
        } finally {
            await deleteTestApp(page, appName);
        }
    });
});
