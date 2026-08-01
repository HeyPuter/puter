import { test, expect } from '@playwright/test';
import { FIXTURE_URL } from '../helpers/testApp.js';

const FIXTURE = FIXTURE_URL.replace(
    'menubar-contextmenu.html',
    'boot-reauth.html',
);

// Any token the backend can't honor. Real visitors arrive with a legacy v1
// token, a revoked session, or an expired one; all three come back as
// `401 reauth_required`, which is the only thing that matters here.
const STALE_TOKEN = 'stale.boot.token';

/**
 * A stale token in localStorage used to turn a page load into a sign-in prompt:
 * the SDK's own boot requests (`/rao`, the `/whoami` cache) escalated their 401
 * through `triggerReauth`, which opens the popup — or, with no user activation
 * to open one with, renders the consent dialog. Either way a visitor who did
 * nothing but load the page was asked to sign in.
 *
 * The prompt belongs to calls the user initiates, so both are covered here.
 */
test.describe('a stale token does not raise sign-in UI at load', () => {
    const seedStaleToken = (page, key) =>
        page.addInitScript(
            ({ k, v }) => {
                try {
                    localStorage.setItem(k, v);
                } catch (e) {
                    /* nothing to seed into */
                }
            },
            { k: key, v: STALE_TOKEN },
        );

    for (const key of ['puter.auth.token', 'puter.auth.token.v2']) {
        test(`no popup or dialog on load with a stale ${key}`, async ({
            page,
        }) => {
            const popups = [];
            page.on('popup', (p) => popups.push(p.url()));

            await seedStaleToken(page, key);
            await page.goto(FIXTURE);
            await page.locator('body.ready').waitFor({ timeout: 60_000 });

            // Boot's own requests have gone out and been answered by now.
            await page.waitForFunction(() => !window.puter?.authToken, null, {
                timeout: 30_000,
            });
            // The token is dropped a tick before any UI would be attached, so
            // asserting the moment it clears can pass by racing the dialog.
            await page.waitForTimeout(2000);

            expect(popups).toEqual([]);
            await expect(page.locator('puter-dialog')).toHaveCount(0);

            // The dead token is dropped rather than left to fail every later
            // call, in memory and in storage.
            expect(
                await page.evaluate((k) => localStorage.getItem(k), key),
            ).toBeNull();
        });
    }

    test('a call the user makes still prompts', async ({ page }) => {
        const popupPromise = page.waitForEvent('popup', { timeout: 30_000 });

        await seedStaleToken(page, 'puter.auth.token.v2');
        await page.goto(FIXTURE);
        await page.locator('body.ready').waitFor({ timeout: 60_000 });
        await page.waitForFunction(() => !window.puter?.authToken, null, {
            timeout: 30_000,
        });

        await page.locator('#kv-get').click();

        const popup = await popupPromise;
        expect(popup.url()).toContain('/action/sign-in');
    });
});
