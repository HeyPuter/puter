import { test, expect } from '@playwright/test';
import { registerTestApp, deleteTestApp, gotoTestApp, FIXTURE_URL } from '../helpers/testApp.js';

const PICKER_FIXTURE_URL = FIXTURE_URL.replace(
    'menubar-contextmenu.html',
    'file-picker.html',
);

const FOLDER = 'picker-e2e-folder';
const TEXT_FILE = 'picker-e2e-note.txt';
const IMAGE_FILE = 'picker-e2e-image.png';
const OTHER_FILE = 'picker-e2e-other.txt';
const SAVED_FILE = 'fixture-save.txt';

const pickerWindow = (page) => page.locator('.window.window-filedialog');
const row = (picker, name) => picker.locator(`.files .row.item[data-name="${name}"]`);
const logged = (appFrame) => appFrame.locator('[data-testid="log"] div');

// The Desktop with a folder, two text files and an image, and no earlier save.
async function seedDesktop (page) {
    await page.evaluate(async ({ folder, files, saved }) => {
        const desktop = `/${window.user.username}/Desktop`;
        await window.puter.fs.mkdir(`${desktop}/${folder}`, { dedupeName: false }).catch(() => {});
        for ( const name of files ) {
            await window.puter.fs.write(`${desktop}/${name}`, 'e2e', { overwrite: true });
        }
        await window.puter.fs.delete(`${desktop}/${saved}`).catch(() => {});
    }, { folder: FOLDER, files: [TEXT_FILE, IMAGE_FILE, OTHER_FILE], saved: SAVED_FILE });
}

// Opens a picker from the test app with one of the fixture's buttons, on the
// Desktop with FOLDER in it.
async function openPicker (page, appName, button = '#open-file') {
    await seedDesktop(page);
    const appFrame = await gotoTestApp(page, appName);
    await appFrame.locator(button).click();
    const picker = pickerWindow(page);
    await expect(row(picker, FOLDER)).toBeVisible({ timeout: 15_000 });
    return { picker, appFrame };
}

test.describe('file pickers (env=app)', () => {
    // Right-click, double-click and the keyboard have no touch equivalent.
    test.skip(({ isMobile }) => isMobile, 'desktop pointer and keyboard only');

    let appName;
    test.beforeEach(async ({ page }) => {
        appName = await registerTestApp(page, { fixtureURL: PICKER_FIXTURE_URL });
    });
    test.afterEach(async ({ page }) => {
        await deleteTestApp(page, appName);
    });

    test('a folder\'s menu has Open and no Open in New Window', async ({ page }) => {
        const { picker } = await openPicker(page, appName);

        await row(picker, FOLDER).click({ button: 'right' });
        const menu = page.locator('.context-menu').last();
        await expect(menu).toBeVisible();
        await expect(menu).toContainText('Open');
        await expect(menu).not.toContainText('Open in New Window');
    });

    test('ctrl/cmd + double-click opens a folder in the picker, not in a new window', async ({ page }) => {
        const { picker } = await openPicker(page, appName);
        const windowCount = await page.locator('.window').count();

        await row(picker, FOLDER).dblclick({ modifiers: ['ControlOrMeta'] });

        await expect(picker).toHaveAttribute('data-path', new RegExp(`/Desktop/${FOLDER}$`));
        await expect(page.locator('.window')).toHaveCount(windowCount);
    });

    test('ctrl/cmd + click on a sidebar folder opens it in the picker, not in a new window', async ({ page }) => {
        const { picker } = await openPicker(page, appName);
        const windowCount = await page.locator('.window').count();

        await picker.locator('.directories [data-folder="Documents"]').click({ modifiers: ['ControlOrMeta'] });

        await expect(picker).toHaveAttribute('data-path', /\/Documents$/);
        await expect(picker.locator('.directories [data-folder="Documents"]')).toHaveClass(/active/);
        await expect(page.locator('.window')).toHaveCount(windowCount);
    });

    test('a double-clicked file is the one picked', async ({ page }) => {
        const { picker, appFrame } = await openPicker(page, appName);

        await row(picker, TEXT_FILE).dblclick();

        await expect(logged(appFrame).last()).toHaveText(`file:~/Desktop/${TEXT_FILE}`);
        await expect(picker).toHaveCount(0);
    });

    test('Open is enabled once a file is selected, and picks it', async ({ page }) => {
        const { picker, appFrame } = await openPicker(page, appName);
        const open = picker.locator('.openfiledialog-open-btn');

        await expect(open).toBeDisabled();
        await row(picker, FOLDER).click();
        await expect(open).toBeDisabled();
        await row(picker, TEXT_FILE).click();
        await expect(row(picker, TEXT_FILE)).toHaveClass(/selected/);
        await expect(open).toBeEnabled();

        await open.click();
        await expect(logged(appFrame).last()).toHaveText(`file:~/Desktop/${TEXT_FILE}`);
    });

    test('Enter picks the file the arrow keys move to', async ({ page }) => {
        const { picker, appFrame } = await openPicker(page, appName);

        await row(picker, FOLDER).click();
        await page.keyboard.press('ArrowDown');
        const selected = picker.locator('.files .row.selected');
        await expect(selected).toHaveCount(1);
        await expect(selected).not.toHaveAttribute('data-name', FOLDER);
        const name = await selected.getAttribute('data-name');

        await page.keyboard.press('Enter');
        await expect(logged(appFrame).last()).toHaveText(`file:~/Desktop/${name}`);
    });

    test('typing a name selects it', async ({ page }) => {
        const { picker } = await openPicker(page, appName);

        await picker.locator('.files').focus();
        await page.keyboard.type('picker-e2e-o');

        await expect(picker.locator('.files .row.selected')).toHaveAttribute('data-name', OTHER_FILE);
    });

    test('several files can be picked when the app asks for them', async ({ page }) => {
        const { picker, appFrame } = await openPicker(page, appName, '#open-files');

        await row(picker, TEXT_FILE).click();
        await row(picker, OTHER_FILE).click({ modifiers: ['ControlOrMeta'] });
        await expect(picker.locator('.files .row.selected')).toHaveCount(2);
        await picker.locator('.openfiledialog-open-btn').click();

        await expect(logged(appFrame)).toContainText([`files:${OTHER_FILE}`, `files:${TEXT_FILE}`].sort());
    });

    test('a picker that takes one file keeps one selected', async ({ page }) => {
        const { picker } = await openPicker(page, appName);

        await row(picker, TEXT_FILE).click();
        await row(picker, OTHER_FILE).click({ modifiers: ['ControlOrMeta'] });

        await expect(picker.locator('.files .row.selected')).toHaveCount(1);
        await expect(row(picker, OTHER_FILE)).toHaveClass(/selected/);
    });

    test('files of other types than the app accepts can\'t be picked', async ({ page }) => {
        const { picker, appFrame } = await openPicker(page, appName, '#open-images');

        await expect(row(picker, TEXT_FILE)).toHaveClass(/item-disabled/);
        await expect(row(picker, IMAGE_FILE)).not.toHaveClass(/item-disabled/);
        await row(picker, TEXT_FILE).click();
        await expect(picker.locator('.openfiledialog-open-btn')).toBeDisabled();

        await row(picker, IMAGE_FILE).dblclick();
        await expect(logged(appFrame).last()).toHaveText(`image:${IMAGE_FILE}`);
    });

    test('Back, Forward and Up move between folders', async ({ page }) => {
        const { picker } = await openPicker(page, appName);

        await row(picker, FOLDER).dblclick();
        await expect(picker).toHaveAttribute('data-path', new RegExp(`/Desktop/${FOLDER}$`));
        await picker.locator('.path-btn-back').click();
        await expect(picker).toHaveAttribute('data-path', /\/Desktop$/);
        await picker.locator('.path-btn-forward').click();
        await expect(picker).toHaveAttribute('data-path', new RegExp(`/Desktop/${FOLDER}$`));
        await picker.locator('.path-btn-up').click();
        await expect(picker).toHaveAttribute('data-path', /\/Desktop$/);
        await expect(picker.locator('.path-breadcrumbs .dirname').last()).toHaveText('Desktop');
    });

    test('a typed path opens that folder', async ({ page }) => {
        const { picker } = await openPicker(page, appName);

        await picker.locator('.files').focus();
        await page.keyboard.press('/');
        const editor = picker.locator('.path-editor');
        await expect(editor).toBeFocused();
        await expect(editor).toHaveValue('/');
        await editor.fill(`~/Desktop/${FOLDER}`);
        await page.keyboard.press('Enter');

        await expect(picker).toHaveAttribute('data-path', new RegExp(`/Desktop/${FOLDER}$`));
    });

    test('New Folder makes a folder with its name open for editing', async ({ page }) => {
        const { picker } = await openPicker(page, appName);
        await row(picker, FOLDER).dblclick();
        await expect(picker.locator('.files-empty-notice')).toBeVisible();

        await picker.locator('.new-folder-btn').click();

        const editor = picker.locator('.files .row.item .item-name-editor-active');
        await expect(editor).toBeFocused();
        await page.keyboard.type('made-in-picker');
        await page.keyboard.press('Enter');
        await expect(row(picker, 'made-in-picker')).toBeVisible();
        await page.evaluate(async (folder) => {
            await window.puter.fs.delete(`/${window.user.username}/Desktop/${folder}/made-in-picker`).catch(() => {});
        }, FOLDER);
    });

    test('the grid view shows the same rows', async ({ page }) => {
        const { picker } = await openPicker(page, appName);

        await picker.locator('.view-toggle-btn').click();
        await page.locator('.context-menu .context-menu-item', { hasText: 'Grid' }).last().click();

        await expect(picker.locator('.files')).toHaveClass(/files-grid-view/);
        await expect(row(picker, FOLDER)).toBeVisible();
    });

    test('Escape cancels the picker', async ({ page }) => {
        const { picker, appFrame } = await openPicker(page, appName, '#open-files');

        await picker.locator('.files').focus();
        await page.keyboard.press('Escape');

        await expect(picker).toHaveCount(0);
        await expect(logged(appFrame).last()).toHaveText('files:cancelled');
    });

    test('the save picker saves under the name given, where it\'s open', async ({ page }) => {
        const { picker, appFrame } = await openPicker(page, appName, '#save-file');
        const filename = picker.locator('.savefiledialog-filename');
        await expect(filename).toHaveValue(SAVED_FILE);
        await expect(filename).toBeFocused();

        // A file clicked in the listing names the save.
        await row(picker, TEXT_FILE).click();
        await expect(filename).toHaveValue(TEXT_FILE);
        await filename.fill(SAVED_FILE);

        await row(picker, FOLDER).dblclick();
        await expect(picker).toHaveAttribute('data-path', new RegExp(`/Desktop/${FOLDER}$`));
        await picker.locator('.savefiledialog-save-btn').click();

        await expect(logged(appFrame).last()).toHaveText(`saved:${SAVED_FILE}`);
        const saved = await page.evaluate(async ({ folder, name }) => (await window.puter.fs.stat(`/${window.user.username}/Desktop/${folder}/${name}`)).name, { folder: FOLDER, name: SAVED_FILE });
        expect(saved).toBe(SAVED_FILE);
        await page.evaluate(async ({ folder, name }) => {
            await window.puter.fs.delete(`/${window.user.username}/Desktop/${folder}/${name}`).catch(() => {});
        }, { folder: FOLDER, name: SAVED_FILE });
    });

    test('the save picker can\'t save into the Shared view', async ({ page }) => {
        const { picker } = await openPicker(page, appName, '#save-file');

        await picker.locator('.directories [data-folder="Shared"]').click();

        await expect(picker.locator('.savefiledialog-save-btn')).toBeDisabled();
    });

    test('the directory picker picks the folder it\'s in, or the one selected', async ({ page }) => {
        const { picker, appFrame } = await openPicker(page, appName, '#pick-directory');

        await expect(row(picker, TEXT_FILE)).toHaveClass(/item-disabled/);
        await picker.locator('.directorypicker-select-btn').click();
        await expect(logged(appFrame).last()).toHaveText('dir:Desktop');
        // The answered picker is still closing; the next one is a new window.
        await expect(picker).toHaveCount(0);

        await appFrame.locator('#pick-directory').click();
        await expect(row(picker, FOLDER)).toBeVisible();
        await row(picker, FOLDER).click();
        await picker.locator('.directorypicker-select-btn').click();
        await expect(logged(appFrame).last()).toHaveText(`dir:${FOLDER}`);
    });
});
