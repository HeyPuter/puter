import { test, expect } from '@playwright/test';
import { FIXTURE_URL } from '../helpers/testApp.js';

const FIXTURE = FIXTURE_URL.replace(
    'menubar-contextmenu.html',
    'boot-reauth.html',
);

// Any token the backend can't honor — an unrecognized token comes back as
// `401 token_auth_failed`, a revoked or expired session as `401
// reauth_required`. Either way boot must not turn a page load into a sign-in
// prompt, which is the only thing that matters here.
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

    test.describe('with push support', () => {
        // Playwright's WebKit has no PushManager or Notification.
        test.skip(
            ({ browserName }) => browserName !== 'chromium',
            'Needs the Push API, which only Chromium has here',
        );

        test('no popup or dialog on load from a page that keeps push current', async ({
            playwright,
        }) => {
            // Headless shell keeps notifications denied, so use full Chromium.
            const browser = await playwright.chromium.launch({
                channel: 'chromium',
            });
            try {
                const context = await browser.newContext();
                const page = await context.newPage();
                await keepsPushCurrent(page, context);
            } finally {
                await browser.close();
            }
        });
    });

    async function keepsPushCurrent(page, context) {
        const popups = [];
        page.on('popup', (p) => popups.push(p.url()));
        const fixtureOrigin = new URL(FIXTURE).origin;
        await context.grantPermissions(['notifications'], {
            origin: fixtureOrigin,
        });
        // The opt-in the fixture's user recorded when they turned push on.
        await page.addInitScript(() => {
            const open = indexedDB.open('puter-push', 1);
            open.onupgradeneeded = () => {
                open.result.createObjectStore('handlers');
                open.result.createObjectStore('clicks');
            };
            open.onsuccess = () => {
                const tx = open.result.transaction('handlers', 'readwrite');
                tx.objectStore('handlers').put(
                    true,
                    'puter:opt-in:boot-reauth-user',
                );
                tx.oncomplete = () => open.result.close();
            };
        });
        // The push routes answer the stale token as Puter's API does.
        let keyRequests = 0;
        const cors = {
            'Access-Control-Allow-Origin': fixtureOrigin,
            'Access-Control-Allow-Credentials': 'true',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': 'GET, POST, DELETE',
        };
        await page.route('**/push/web/**', (route) => {
            if (route.request().method() === 'OPTIONS')
                return route.fulfill({ status: 204, headers: cors });
            keyRequests++;
            return route.fulfill({
                status: 401,
                headers: cors,
                contentType: 'application/json',
                body: JSON.stringify({
                    code: 'token_auth_failed',
                    message: 'Authentication failed',
                }),
            });
        });

        // Boot's own 401s come later, so the sync starts while signed in.
        await page.route(/\/(whoami|rao)(\?|$)/, async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            await route.continue();
        });

        await seedStaleToken(page, 'puter.auth.token.v2');
        await page.goto(`${FIXTURE}?push`);
        await page.locator('body.ready').waitFor({ timeout: 60_000 });
        const canPush = await page.evaluate(
            () =>
                'PushManager' in window &&
                globalThis.Notification?.permission === 'granted',
        );
        test.skip(
            !canPush,
            'This browser has no Push API or no notification permission, so onPush() has no sync to run',
        );
        await page.waitForFunction(() => !window.puter?.authToken, null, {
            timeout: 30_000,
        });
        await page.waitForTimeout(2000);

        expect(keyRequests).toBeGreaterThan(0);
        expect(popups).toEqual([]);
        await expect(page.locator('puter-dialog')).toHaveCount(0);
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
