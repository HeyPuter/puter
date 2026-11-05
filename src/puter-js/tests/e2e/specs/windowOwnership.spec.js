import { test, expect } from '@playwright/test';
import { registerTestApp, deleteTestApp, gotoTestApp, FIXTURE_URL } from '../helpers/testApp.js';

const WINDOW_OWNERSHIP_FIXTURE_URL = FIXTURE_URL.replace(
    'menubar-contextmenu.html',
    'window-ownership.html',
);

const entry = (log, value) => log.locator(`[data-entry="${value}"]`);

// Desktop windows show the title in their head; headless dashboard windows
// show it in the control drawer.
const titleOf = (win) => win.evaluate(el => (
    el.querySelector('.window-head-title, .dashboard-app-drawer-title')?.textContent ?? null
));

const logValue = async (log, prefix) => {
    const text = await log.locator(`[data-entry^="${prefix}"]`).first().textContent();
    return text.slice(prefix.length);
};

test.describe('setWindowTitle / setWindow* window ownership (env=app)', () => {
    let appName;
    let appFrame;
    let log;

    test.beforeEach(async ({ page }) => {
        appName = await registerTestApp(page, { fixtureURL: WINDOW_OWNERSHIP_FIXTURE_URL });
        await gotoTestApp(page, appName);
        // The fixture's own window is the first one open; created windows and
        // launched children add iframes after it.
        appFrame = page.frameLocator('iframe.window-app-iframe').first();
        log = appFrame.locator('#log');
    });

    test.afterEach(async ({ page }) => {
        await deleteTestApp(page, appName);
    });

    test("an app can still retitle and resize its own window", async ({ page }) => {
        await appFrame.locator('#own').click();
        await expect(entry(log, 'own-title:replied')).toBeAttached();
        await expect(entry(log, 'own-size:replied')).toBeAttached();

        const own = page.locator(`.window[data-app="${appName}"]`).first();
        await expect.poll(() => titleOf(own)).toBe('own-retitled');
    });

    test('an app can retitle and move a window it created', async ({ page }) => {
        await appFrame.locator('#created').click();
        await expect(entry(log, 'created-title:replied')).toBeAttached();
        await expect(entry(log, 'created-position:replied')).toBeAttached();

        const id = await logValue(log, 'created-id:');
        const created = page.locator(`.window[data-element_uuid="${id}"]`);
        await expect.poll(() => titleOf(created)).toBe('created-retitled');
    });

    test('an app cannot retitle or resize an app it launched', async ({ page }) => {
        await appFrame.locator('#child').click();
        await expect(entry(log, 'child-title:no-reply')).toBeAttached({ timeout: 30_000 });
        await expect(entry(log, 'child-width:no-reply')).toBeAttached();

        const id = await logValue(log, 'child-id:');
        const child = page.locator(`.window[data-element_uuid="${id}"]`);
        await expect(child).toHaveCount(1);
        expect(await titleOf(child)).not.toBe('hijacked');
        expect(await child.evaluate(el => el.style.width)).not.toBe('201px');
    });
});
