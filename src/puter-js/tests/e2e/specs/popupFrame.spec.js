import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUTER_ORIGIN = process.env.PUTER_TEST_ORIGIN || 'http://puter.localhost:4100';
const API_ORIGIN = PUTER_ORIGIN.replace('://', '://api.');
// One label under the GUI origin: a first-party app page.
const FIRST_PARTY = PUTER_ORIGIN.replace('://', '://notes.');
const SDK = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../dist/puter.dev.js'),
    'utf8',
);

// Locally both origins are loopback, which Chromium's local network checks
// refuse to frame from a page the test serves itself.
test.use({
    launchOptions: {
        args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessForNavigations'],
    },
});

/** Opens the first-party page, serving it and the SDK from the test. */
const openFirstPartyPage = async (page) => {
    await page.context().route(`${FIRST_PARTY}/**`, (route) => {
        if ( new URL(route.request().url()).pathname === '/sdk.js' ) {
            return route.fulfill({ contentType: 'text/javascript', body: SDK });
        }
        return route.fulfill({
            contentType: 'text/html',
            body: `<!doctype html><meta charset="utf-8"><button id="go">Go</button>
<script>window.PUTER_ORIGIN = ${JSON.stringify(PUTER_ORIGIN)}; window.PUTER_API_ORIGIN = ${JSON.stringify(API_ORIGIN)};</script>
<script src="/sdk.js"></script>`,
        });
    });
    await page.goto(`${FIRST_PARTY}/`);
    await page.waitForFunction(() => !!window.puter);
};

/** Runs `expr` from a click on the page, settling into `window.__result`. */
const runFromClick = async (page, expr) => {
    await page.evaluate((expr) => {
        window.__result = undefined;
        document.getElementById('go').onclick = () => {
            Promise.resolve().then(() => (0, eval)(expr)).then(
                (value) => {
                    window.__result = { ok: true, value: JSON.parse(JSON.stringify(value ?? null)) };
                },
                (error) => {
                    window.__result = { ok: false, error: JSON.parse(JSON.stringify(error ?? null)) };
                },
            );
        };
    }, expr);
    await page.click('#go');
};
const result = (page) => page.waitForFunction(() => window.__result, null, { timeout: 60_000 }).then((h) => h.jsonValue());

const frame = (page) => page.frameLocator('dialog.puter-popup-frame iframe');
const frameReady = (page) => page.locator('dialog.puter-popup-frame[open]:not(.is-loading)').waitFor({ timeout: 60_000 });

test.describe('popups a first-party page shows framed', () => {
    test('signs in, then picks and saves files, without opening a window', async ({ page }) => {
        // The admin's Puter session, and a file of theirs to pick.
        await page.goto('/');
        await page.waitForFunction(() => !!window.user?.username && !!window.puter?.authToken, null, { timeout: 60_000 });
        const username = await page.evaluate(() => window.user.username);
        await page.evaluate((u) => puter.fs.write(`/${u}/Desktop/popup-frame.txt`, 'framed'), username);

        await openFirstPartyPage(page);
        const popups = [];
        page.on('popup', (p) => popups.push(p));

        await runFromClick(page, 'puter.auth.signIn()');
        await frameReady(page);
        await frame(page).locator('.auth-dialog [data-screen="accounts"] button').first().click();
        const signedIn = await result(page);
        expect(signedIn.ok).toBe(true);
        expect(signedIn.value).toMatchObject({ success: true, username });
        await expect(page.locator('dialog.puter-popup-frame')).toHaveCount(0);

        await runFromClick(page, 'puter.ui.showOpenFilePicker()');
        await frameReady(page);
        await frame(page).locator('.item[data-name="popup-frame.txt"]').dblclick();
        const picked = await result(page);
        expect(picked.value).toMatchObject({ name: 'popup-frame.txt' });
        await expect(page.locator('dialog.puter-popup-frame')).toHaveCount(0);

        // A name no earlier run left behind, so the save doesn't ask to replace it.
        const savedName = `popup-frame-${Date.now()}.txt`;
        await runFromClick(page, `puter.ui.showSaveFilePicker("saved in a frame", ${JSON.stringify(savedName)})`);
        await frameReady(page);
        await expect(frame(page).locator('.savefiledialog-filename')).toHaveValue(savedName);
        await frame(page).locator('.savefiledialog-save-btn').click();
        const saved = await result(page);
        expect(saved.value).toMatchObject({ name: savedName });

        await runFromClick(page, 'puter.ui.showDirectoryPicker().undefinedOnCancel');
        await frameReady(page);
        await frame(page).getByRole('button', { name: 'Cancel' }).click();
        expect(await result(page)).toEqual({ ok: true, value: null });

        // Escape closes the picker, and the frame goes with it.
        await runFromClick(page, 'puter.ui.showOpenFilePicker().undefinedOnCancel');
        await frameReady(page);
        await frame(page).locator('.window-filedialog').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('Escape');
        expect(await result(page)).toEqual({ ok: true, value: null });
        await expect(page.locator('dialog.puter-popup-frame')).toHaveCount(0);

        expect(popups).toHaveLength(0);
    });

    test('closing the framed sign-in rejects as closing its popup would', async ({ page }) => {
        await openFirstPartyPage(page);
        await page.evaluate(() => {
            document.body.style.minHeight = '4000px';
        });
        await runFromClick(page, 'puter.auth.signIn()');
        await frameReady(page);

        // Scrolling over the scrim leaves the page behind it where it was.
        await page.mouse.move(5, 300);
        await page.mouse.wheel(0, 800);
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => window.scrollY)).toBe(0);

        await page.locator('.puter-popup-frame-close').click();
        const closed = await result(page);
        expect(closed).toMatchObject({ ok: false, error: { error: 'auth_window_closed' } });
        await expect(page.locator('dialog.puter-popup-frame')).toHaveCount(0);
    });

    test('a page signed in as someone else gets the picker popup', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => !!window.puter?.authToken, null, { timeout: 60_000 });
        await openFirstPartyPage(page);
        await runFromClick(page, 'puter.auth.signIn()');
        await frameReady(page);
        await frame(page).locator('.auth-dialog [data-screen="accounts"] button').first().click();
        await result(page);
        // Name another user as the page's own, once sign-in's own whoami has landed.
        await page.evaluate(async () => {
            await puter.whoamiCache_;
            puter.whoami = { uuid: '00000000-0000-4000-8000-000000000000' };
        });

        const popup = page.waitForEvent('popup', { timeout: 60_000 });
        await runFromClick(page, 'puter.ui.showOpenFilePicker()');
        expect(new URL((await popup).url()).pathname).toBe('/action/show-open-file-picker');
        await expect(page.locator('dialog.puter-popup-frame')).toHaveCount(0);
    });
});
