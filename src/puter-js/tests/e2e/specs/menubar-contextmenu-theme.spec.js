import { test, expect } from '@playwright/test';
import { FIXTURE_URL } from '../helpers/testApp.js';

// The `theme` option on setMenubar()/contextMenu() only applies when puter.js
// runs standalone (puter.env === 'web'). Loading the fixture directly on its
// own origin (rather than as an app inside the Puter desktop) puts the SDK in
// env=web, which renders the web components locally — exactly the path that
// reads spec.theme and forwards it as the `theme` attribute.
test.describe('puter.ui setMenubar/contextMenu theme option (env=web)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(FIXTURE_URL);
        await page.locator('body.ready').waitFor({ timeout: 30_000 });
        // Sanity: confirm we are actually in the standalone web environment.
        const env = await page.evaluate(() => window.puter?.env);
        expect(env).toBe('web');
    });

    test('setMenubar({ theme: "dark" }) forwards theme to <puter-menubar>', async ({ page }) => {
        await page.locator('#set-menubar-dark-btn').click();

        const menubar = page.locator('puter-menubar');
        await expect(menubar).toHaveAttribute('theme', 'dark');
        // The base component resolves theme → toggles .puter-theme-dark on the host.
        await expect(menubar).toHaveClass(/puter-theme-dark/);
    });

    test('contextMenu({ theme: "dark" }) forwards theme to <puter-context-menu>', async ({ page }) => {
        await page.locator('#ctx-trigger-dark').click();

        const menu = page.locator('puter-context-menu').last();
        await expect(menu).toHaveAttribute('theme', 'dark');
        await expect(menu).toHaveClass(/puter-theme-dark/);
    });

    test('omitting theme leaves no forced theme attribute on the menubar', async ({ page }) => {
        await page.locator('#set-menubar-btn').click();

        const menubar = page.locator('puter-menubar');
        await expect(menubar).toBeAttached();
        // No explicit theme → the component follows the system preference rather
        // than a forced one, so the attribute must be absent.
        await expect(menubar).not.toHaveAttribute('theme', /.*/);
    });
});
