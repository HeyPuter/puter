import { test, expect, devices } from '@playwright/test';
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
            body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><button id="go">Go</button>
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

/** The red channel of a screenshot of `clip`, row by row, decoded in the page. */
const screenshotRed = async (page, clip) => {
    const png = await page.screenshot({ clip });
    return page.evaluate(async (base64) => {
        const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const context = new OffscreenCanvas(image.width, image.height).getContext('2d');
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, 0, image.width, image.height);
        return { width: image.width, red: Array.from(data.filter((_, i) => i % 4 === 0)) };
    }, png.toString('base64'));
};

/** Waits for the box's fade-in to finish, so screenshots show it as it stays. */
const boxSettled = (page) => page.waitForFunction(() =>
    document.querySelector('.puter-popup-frame-box')?.getAnimations().length === 0);

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
        const suggestedName = `popup-frame-${Date.now()}.txt`;
        await runFromClick(page, `puter.ui.showSaveFilePicker("saved in a frame", ${JSON.stringify(suggestedName)})`);
        await frameReady(page);
        await expect(frame(page).locator('.savefiledialog-filename')).toHaveValue(suggestedName);
        // As in the popup, the name has focus with all but its extension
        // selected, so typing renames it straight away.
        const savedName = `renamed-${suggestedName}`;
        await page.keyboard.type(savedName.replace(/\.txt$/, ''));
        await expect(frame(page).locator('.savefiledialog-filename')).toHaveValue(savedName);
        await frame(page).locator('.savefiledialog-save-btn').click();
        const saved = await result(page);
        expect(saved.value).toMatchObject({ name: savedName });

        // Escape on the alert asking to replace that file goes back to the
        // picker, as its Cancel does, rather than leaving it behind its mask.
        await runFromClick(page, `puter.ui.showSaveFilePicker("again", ${JSON.stringify(savedName)}).undefinedOnCancel`);
        await frameReady(page);
        await frame(page).locator('.savefiledialog-save-btn').click();
        await expect(frame(page).locator('.window-alert')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await expect(frame(page).locator('.window-alert')).toHaveCount(0);
        await expect(frame(page).locator('.window-filedialog .window-disable-mask')).toBeHidden();
        await frame(page).getByRole('button', { name: 'Cancel' }).click();
        expect(await result(page)).toEqual({ ok: true, value: null });

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

    test('the page\'s own dialog, frame and button styles leave the framed sign-in as it is', async ({ page }) => {
        await openFirstPartyPage(page);
        await page.addStyleTag({
            content: `dialog { top: 50%; left: 50%; transform: translate(-50%, -50%); border-radius: 24px; }
iframe { max-width: 420px; margin: 12px; }
button { margin: 0 6px 8px 0; min-width: 88px; min-height: 44px; box-shadow: 0 1px 2px #000; }`,
        });
        await runFromClick(page, 'puter.auth.signIn()');
        await frameReady(page);

        const viewport = page.viewportSize();
        const dialog = await page.locator('dialog.puter-popup-frame').boundingBox();
        expect(dialog).toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height });
        const box = await page.locator('.puter-popup-frame-box').boundingBox();
        expect(await page.locator('.puter-popup-frame-box iframe').boundingBox()).toEqual(box);
        const close = await page.locator('.puter-popup-frame-close').boundingBox();
        expect([close.width, close.height]).toEqual([32, 32]);
        expect(box.x + box.width - (close.x + close.width)).toBe(10);
        await expect(page.locator('.puter-popup-frame-close')).toHaveCSS('box-shadow', 'none');
    });

    test.describe('in dark mode', () => {
        test.use({ colorScheme: 'dark', deviceScaleFactor: 2 });

        test('the framed sign-in\'s rounded corners show no light fringe', async ({ page }) => {
            await openFirstPartyPage(page);
            await runFromClick(page, 'puter.auth.signIn()');
            await frameReady(page);
            await boxSettled(page);

            // The bottom-left corner: the dialog at the top right, the scrim
            // at the bottom left, and the curve between them.
            const box = await page.locator('.puter-popup-frame-box').boundingBox();
            const { width, red } = await screenshotRed(page, { x: box.x, y: box.y + box.height - 12, width: 12, height: 12 });
            const inside = red[width - 1];
            const outside = red[red.length - width];
            expect(Math.max(...red)).toBeLessThanOrEqual(Math.max(inside, outside) + 3);
        });
    });

    test.describe('on a phone with a fractional pixel ratio', () => {
        // A describe group can't switch browsers; the profile's is Chromium anyway.
        const { defaultBrowserType: _browser, ...pixel7 } = devices['Pixel 7'];
        test.use(pixel7);

        test('the framed sign-in fills the screen with no line of scrim along its edge', async ({ page }) => {
            await openFirstPartyPage(page);
            await runFromClick(page, 'puter.auth.signIn()');
            await frameReady(page);
            await boxSettled(page);

            // A column down the middle of the top: the white sign-in all the way up.
            const { width } = page.viewportSize();
            const { red } = await screenshotRed(page, { x: width / 2, y: 0, width: 1, height: 4 });
            expect(red[0]).toBe(red[red.length - 1]);
        });

        test('the framed save picker keeps its file name and buttons on screen', async ({ page }) => {
            await page.goto('/');
            await page.waitForFunction(() => !!window.puter?.authToken, null, { timeout: 60_000 });
            await openFirstPartyPage(page);
            await runFromClick(page, 'puter.auth.signIn()');
            await frameReady(page);
            await frame(page).locator('.auth-dialog [data-screen="accounts"] button').first().click();
            expect((await result(page)).ok).toBe(true);

            await runFromClick(page, 'puter.ui.showSaveFilePicker("x", "a-long-suggested-file-name.txt")');
            await frameReady(page);
            const { width } = page.viewportSize();
            for ( const control of ['.savefiledialog-filename', '.filedialog-cancel-btn', '.savefiledialog-save-btn'] ) {
                const box = await frame(page).locator(control).boundingBox();
                expect(box.x).toBeGreaterThanOrEqual(0);
                expect(box.x + box.width).toBeLessThanOrEqual(width);
            }
        });
    });

    test.describe('on a small phone', () => {
        const { defaultBrowserType: _browser, ...iPhoneSE } = devices['iPhone SE'];
        test.use(iPhoneSE);

        test('the framed open picker keeps its buttons on one line inside its bar', async ({ page }) => {
            await page.goto('/');
            await page.waitForFunction(() => !!window.puter?.authToken, null, { timeout: 60_000 });
            await openFirstPartyPage(page);
            await runFromClick(page, 'puter.auth.signIn()');
            await frameReady(page);
            await frame(page).locator('.auth-dialog [data-screen="accounts"] button').first().click();
            expect((await result(page)).ok).toBe(true);

            await runFromClick(page, 'puter.ui.showOpenFilePicker()');
            await frameReady(page);
            const bar = await frame(page).locator('.window-filedialog-prompt').boundingBox();
            const cancel = await frame(page).locator('.filedialog-cancel-btn').boundingBox();
            const open = await frame(page).locator('.openfiledialog-open-btn').boundingBox();
            expect(open.y).toBe(cancel.y);
            expect(open.x).toBeGreaterThan(cancel.x + cancel.width);
            expect(open.y + open.height).toBeLessThan(bar.y + bar.height);

            // With German's longer labels, the upload label gives way so both
            // buttons stay whole on screen.
            await frame(page).locator('.window-filedialog-prompt').evaluate((el) => {
                el.querySelector('.window-filedialog-upload-here').lastChild.textContent = ' Hochladen';
                el.querySelector('.filedialog-cancel-btn').textContent = 'Abbrechen';
                el.querySelector('.openfiledialog-open-btn').textContent = 'Öffnen';
            });
            const germanOpen = await frame(page).locator('.openfiledialog-open-btn').boundingBox();
            expect(germanOpen.x + germanOpen.width).toBeLessThanOrEqual(bar.x + bar.width);
        });
    });

    test('a provider picked in the framed sign-in opens straight in the popup', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => !!window.user?.username && !!window.puter?.authToken, null, { timeout: 60_000 });
        const username = await page.evaluate(() => window.user.username);
        // Offer Google, and stand in for its round trip: the provider returns
        // the popup to the sign-in popup for the same attempt.
        await page.context().route('**/auth/oidc/providers', (route) =>
            route.fulfill({ contentType: 'application/json', body: JSON.stringify({ providers: ['google'] }) }));
        let started = null;
        await page.context().route('**/auth/oidc/google/start?*', (route) => {
            started = new URL(route.request().url());
            const back = new URL('/action/sign-in', PUTER_ORIGIN);
            back.searchParams.set('embedded_in_popup', 'true');
            back.searchParams.set('msg_id', started.searchParams.get('msg_id'));
            return route.fulfill({ status: 302, headers: { location: back.href } });
        });

        await openFirstPartyPage(page);
        const popups = [];
        page.on('popup', (p) => popups.push(p));
        await runFromClick(page, 'puter.auth.signIn()');
        await frameReady(page);
        const frameMsgId = await page.evaluate(() =>
            new URLSearchParams(new URL(document.querySelector('dialog.puter-popup-frame iframe').src).hash.slice(1)).get('msg_id'));
        await frame(page).locator('.auth-dialog [data-screen="accounts"]').waitFor();
        await frame(page).locator('.auth-dialog .auth-to-login').click();
        await frame(page).locator('.oidc-google-btn').click();

        await expect.poll(() => popups.length).toBe(1);
        await expect(page.locator('dialog.puter-popup-frame')).toHaveCount(0);
        expect(started.origin + started.pathname).toBe(`${PUTER_ORIGIN}/auth/oidc/google/start`);
        expect(started.searchParams.get('msg_id')).toBe(frameMsgId);
        expect(started.searchParams.get('embedded_in_popup')).toBe('true');
        expect(started.searchParams.get('opener_origin')).toBe(FIRST_PARTY);

        const popup = popups[0];
        await popup.locator('.auth-dialog [data-screen="accounts"] button').first().click();
        const signedIn = await result(page);
        expect(signedIn).toMatchObject({ ok: true, value: { success: true, username } });
        expect(popups).toHaveLength(1);
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

// The open-source GUI has no upgrade dialog, so the frame gets a stand-in for
// the deployment's: it records what prompted it and closes from its buttons.
const STUB_UPGRADE_DIALOG = () => {
    if ( location.pathname !== '/embed/upgrade' ) return;
    window.UIUpgradeAccount = class {
        static embeddable = true;
        constructor ({ attribution, onClose }) {
            window.__upgradeAttribution = attribution;
            this.onClose = onClose;
        }
        async open_as_window () {
            const dialog = document.createElement('div');
            dialog.className = 'stub-upgrade';
            dialog.setAttribute('role', 'dialog');
            dialog.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5)';
            dialog.innerHTML = '<button id="buy">Buy</button><button id="done">Close</button>';
            dialog.querySelector('#buy').onclick = () => {
                this.upgraded = true;
            };
            dialog.querySelector('#done').onclick = () => {
                dialog.remove();
                this.onClose({ upgraded: this.upgraded === true });
            };
            document.body.append(dialog);
        }
    };
};

/** Signs the first-party page in as the admin, whose Puter session the GUI holds. */
const signInFirstPartyPage = async (page) => {
    await page.goto('/');
    await page.waitForFunction(() => !!window.puter?.authToken, null, { timeout: 60_000 });
    await openFirstPartyPage(page);
    await runFromClick(page, 'puter.auth.signIn()');
    await frameReady(page);
    await frame(page).locator('.auth-dialog [data-screen="accounts"] button').first().click();
    expect(await result(page)).toMatchObject({ ok: true });
    await expect(page.locator('dialog.puter-popup-frame')).toHaveCount(0);
};

/** Stands in for the dashboard the upgrade falls back to, so no request leaves the machine. */
const routeDashboard = (page) => page.context().route('https://puter.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>dashboard</title>' }));

test.describe('the upgrade a first-party page shows framed', () => {
    test('requestUpgrade() shows it over the page and resolves whether the user upgraded', async ({ page }) => {
        await page.context().addInitScript(STUB_UPGRADE_DIALOG);
        await signInFirstPartyPage(page);
        const popups = [];
        page.on('popup', (p) => popups.push(p));

        await runFromClick(page, 'puter.ui.requestUpgrade({ reason: "funds", method: "puter.ai.chat", message: "x" })');
        await frameReady(page);
        const upgradeFrame = page.frames().find((f) => new URL(f.url()).pathname === '/embed/upgrade');
        // The app it credits is the page's own, resolved from its origin.
        expect(await upgradeFrame.evaluate(() => window.__upgradeAttribution)).toEqual({
            appUid: expect.stringMatching(/^app-/),
            reason: 'funds',
            method: 'puter.ai.chat',
        });
        // The page shows through around the dialog.
        expect(await upgradeFrame.evaluate(() => [
            getComputedStyle(document.documentElement).backgroundColor,
            getComputedStyle(document.body).backgroundColor,
        ])).toEqual(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);

        await frame(page).locator('#buy').click();
        await frame(page).locator('#done').click();
        expect(await result(page)).toEqual({ ok: true, value: { upgraded: true } });
        await expect(page.locator('dialog.puter-popup-frame')).toHaveCount(0);
        expect(popups).toHaveLength(0);
    });

    test('the usage limit dialog\'s Upgrade button shows it instead of a tab', async ({ page }) => {
        await page.context().addInitScript(STUB_UPGRADE_DIALOG);
        await signInFirstPartyPage(page);
        const popups = [];
        page.on('popup', (p) => popups.push(p));
        // The account is out of credit.
        await page.route(`${API_ORIGIN}/drivers/call`, (route) => route.fulfill({
            status: route.request().method() === 'OPTIONS' ? 204 : 402,
            headers: {
                'access-control-allow-origin': FIRST_PARTY,
                'access-control-allow-headers': '*',
                'access-control-allow-credentials': 'true',
            },
            contentType: 'application/json',
            body: JSON.stringify({ success: false, error: { code: 'insufficient_funds', message: 'Not enough credit.' } }),
        }));

        await page.evaluate(() => puter.kv.set('upgrade-frame', 'x').catch(() => {}));
        await page.locator('usage-limit-dialog #upgrade-btn').click();
        await frameReady(page);
        await expect(page.locator('usage-limit-dialog')).toHaveCount(0);
        const upgradeFrame = page.frames().find((f) => new URL(f.url()).pathname === '/embed/upgrade');
        expect(await upgradeFrame.evaluate(() => window.__upgradeAttribution)).toMatchObject({ reason: 'funds' });

        await frame(page).locator('#done').click();
        await expect(page.locator('dialog.puter-popup-frame')).toHaveCount(0);
        expect(popups).toHaveLength(0);
    });

    test('a call refused while the upgrade shows leaves it uncovered', async ({ page }) => {
        await page.context().addInitScript(STUB_UPGRADE_DIALOG);
        await signInFirstPartyPage(page);
        await page.route(`${API_ORIGIN}/drivers/call`, (route) => route.fulfill({
            status: route.request().method() === 'OPTIONS' ? 204 : 402,
            headers: {
                'access-control-allow-origin': FIRST_PARTY,
                'access-control-allow-headers': '*',
                'access-control-allow-credentials': 'true',
            },
            contentType: 'application/json',
            body: JSON.stringify({ success: false, error: { code: 'insufficient_funds', message: 'Not enough credit.' } }),
        }));

        await runFromClick(page, 'puter.ui.requestUpgrade({ reason: "funds" })');
        await frameReady(page);
        const refused = await page.evaluate(() => puter.kv.set('upgrade-frame', 'x').then(() => false, () => true));
        expect(refused).toBe(true);
        await expect(page.locator('usage-limit-dialog')).toHaveCount(0);

        await frame(page).locator('#done').click();
        expect(await result(page)).toEqual({ ok: true, value: { upgraded: false } });
        await page.evaluate(() => puter.kv.set('upgrade-frame', 'x').catch(() => {}));
        await expect(page.locator('usage-limit-dialog')).toHaveCount(1);
    });

    test('a deployment without an upgrade dialog opens the dashboard upgrade in a tab', async ({ page }) => {
        await routeDashboard(page);
        await signInFirstPartyPage(page);

        const popup = page.waitForEvent('popup', { timeout: 60_000 });
        await runFromClick(page, 'puter.ui.requestUpgrade({ reason: "storage", method: "puter.fs.upload" })');
        const url = new URL((await popup).url());
        expect(url.origin + url.pathname).toBe('https://puter.com/dashboard/');
        expect(url.searchParams.get('upgrade')).toBe('storage');
        expect(url.searchParams.get('upgrade_method')).toBe('puter.fs.upload');
        expect(await result(page)).toEqual({ ok: true, value: { upgraded: false } });
        await expect(page.locator('dialog.puter-popup-frame')).toHaveCount(0);
    });

    test('an upgrade dialog that fails to open leaves the dashboard upgrade in a tab', async ({ page }) => {
        await page.context().addInitScript(STUB_UPGRADE_DIALOG);
        await page.context().addInitScript(() => {
            if ( location.pathname !== '/embed/upgrade' ) return;
            window.UIUpgradeAccount.prototype.open_as_window = async () => {
                throw new Error('broken dialog');
            };
        });
        await routeDashboard(page);
        await signInFirstPartyPage(page);

        const popup = page.waitForEvent('popup', { timeout: 60_000 });
        await runFromClick(page, 'puter.ui.requestUpgrade({ reason: "funds" })');
        expect(new URL((await popup).url()).pathname).toBe('/dashboard/');
        expect(await result(page)).toEqual({ ok: true, value: { upgraded: false } });
        await expect(page.locator('dialog.puter-popup-frame')).toHaveCount(0);
    });

    test('a page signed in as someone else gets the dashboard upgrade in a tab', async ({ page }) => {
        await page.context().addInitScript(STUB_UPGRADE_DIALOG);
        await routeDashboard(page);
        await signInFirstPartyPage(page);
        await page.evaluate(async () => {
            await puter.whoamiCache_;
            puter.whoami = { uuid: '00000000-0000-4000-8000-000000000000' };
        });

        const popup = page.waitForEvent('popup', { timeout: 60_000 });
        await runFromClick(page, 'puter.ui.requestUpgrade({ reason: "funds" })');
        expect(new URL((await popup).url()).pathname).toBe('/dashboard/');
        expect(await result(page)).toEqual({ ok: true, value: { upgraded: false } });
        await expect(page.locator('dialog.puter-popup-frame')).toHaveCount(0);
    });
});

const EMAIL_FRAME = '/embed/request-email-confirmation';

/** Has the email confirmation frame's session read as `patch` says, so the account can need a code. */
const routeFrameSession = (page, patch) => page.context().route(`${API_ORIGIN}/whoami**`, async (route) => {
    let frameUrl = '';
    try {
        frameUrl = route.request().frame().url();
    } catch {
        // A request from no frame, such as a service worker's.
    }
    if ( route.request().method() !== 'GET' || ! frameUrl.includes(EMAIL_FRAME) ) return route.fallback();
    const response = await route.fetch();
    return route.fulfill({ response, json: { ...(await response.json()), ...patch } });
});

/**
 * Answers the code check as the server would for a right code, so no email has
 * to be read. Given `until`, it answers once that settles.
 */
const routeConfirmEmail = (page, until) => page.context().route(`${API_ORIGIN}/confirm-email`, async (route) => {
    const preflight = route.request().method() === 'OPTIONS';
    if ( ! preflight ) await until;
    await route.fulfill({
        status: preflight ? 204 : 200,
        headers: {
            'access-control-allow-origin': PUTER_ORIGIN,
            'access-control-allow-headers': '*',
            'access-control-allow-credentials': 'true',
        },
        contentType: 'application/json',
        body: JSON.stringify({ email_confirmed: true }),
    });
});

const UNCONFIRMED = { email_confirmed: false, requires_email_confirmation: true };

/** Has the page's own whoami read the email as unconfirmed, as it does for such an account. */
const pageReadsUnconfirmed = (page) => page.evaluate(async () => {
    puter.whoami = { ...(await puter.whoamiCache_), email_confirmed: false };
});
const codeWindow = (page) => frame(page).locator('.window-confirm-email-using-code');

test.describe('the email confirmation a first-party page shows framed', () => {
    test('a confirmed email resolves true without a frame', async ({ page }) => {
        await signInFirstPartyPage(page);
        const popups = [];
        page.on('popup', (p) => popups.push(p));
        const framed = [];
        page.on('request', (r) => {
            if ( new URL(r.url()).pathname === EMAIL_FRAME ) framed.push(r.url());
        });
        await page.evaluate(() => {
            window.__mounted = false;
            new MutationObserver(() => {
                if ( document.querySelector('dialog.puter-popup-frame') ) window.__mounted = true;
            }).observe(document.body, { childList: true });
        });

        await runFromClick(page, 'puter.ui.requestEmailConfirmation()');
        expect(await result(page)).toEqual({ ok: true, value: { response: true } });
        // No loading scrim flashes over the page.
        expect(await page.evaluate(() => window.__mounted)).toBe(false);
        expect(framed).toHaveLength(0);
        expect(popups).toHaveLength(0);
    });

    test('an email confirmed since the page loaded resolves true without showing a window', async ({ page }) => {
        await routeFrameSession(page, { email_confirmed: true, requires_email_confirmation: false });
        await signInFirstPartyPage(page);
        // Read before the email was confirmed.
        await pageReadsUnconfirmed(page);
        const popups = [];
        page.on('popup', (p) => popups.push(p));

        await runFromClick(page, 'puter.ui.requestEmailConfirmation()');
        expect(await result(page)).toEqual({ ok: true, value: { response: true } });
        await expect(page.locator('dialog.puter-popup-frame')).toHaveCount(0);
        expect(popups).toHaveLength(0);
    });

    test('entering the code in one window over the page resolves true', async ({ page }) => {
        await routeFrameSession(page, UNCONFIRMED);
        await routeConfirmEmail(page);
        await signInFirstPartyPage(page);
        await pageReadsUnconfirmed(page);
        const popups = [];
        page.on('popup', (p) => popups.push(p));

        await runFromClick(page, 'puter.ui.requestEmailConfirmation()');
        await frameReady(page);
        // One window the user can close, not the boot's email gate as well.
        await expect(codeWindow(page)).toHaveCount(1);
        await expect(codeWindow(page).locator('.generic-close-window-button')).toBeVisible();
        const emailFrame = page.frames().find((f) => new URL(f.url()).pathname === EMAIL_FRAME);
        // The page shows through around the window.
        expect(await emailFrame.evaluate(() => [
            getComputedStyle(document.documentElement).backgroundColor,
            getComputedStyle(document.body).backgroundColor,
        ])).toEqual(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);

        await codeWindow(page).locator('.digit-input').first().click();
        await page.keyboard.type('123456');
        expect(await result(page)).toEqual({ ok: true, value: { response: true } });
        await expect(page.locator('dialog.puter-popup-frame')).toHaveCount(0);
        expect(popups).toHaveLength(0);
    });

    test('closing the window resolves false', async ({ page }) => {
        await routeFrameSession(page, UNCONFIRMED);
        await signInFirstPartyPage(page);
        await pageReadsUnconfirmed(page);

        await runFromClick(page, 'puter.ui.requestEmailConfirmation()');
        await frameReady(page);
        await codeWindow(page).locator('.generic-close-window-button').click();
        expect(await result(page)).toEqual({ ok: true, value: { response: false } });
        await expect(page.locator('dialog.puter-popup-frame')).toHaveCount(0);
    });

    test('Escape on the window resolves false', async ({ page }) => {
        await routeFrameSession(page, UNCONFIRMED);
        await signInFirstPartyPage(page);
        await pageReadsUnconfirmed(page);

        await runFromClick(page, 'puter.ui.requestEmailConfirmation()');
        await frameReady(page);
        await codeWindow(page).locator('.digit-input').first().click();
        await page.keyboard.press('Escape');
        expect(await result(page)).toEqual({ ok: true, value: { response: false } });
        await expect(page.locator('dialog.puter-popup-frame')).toHaveCount(0);
    });

    test('Escape while a code is being checked resolves with the check\'s answer', async ({ page }) => {
        await routeFrameSession(page, UNCONFIRMED);
        let answer;
        await routeConfirmEmail(page, new Promise((resolve) => {
            answer = resolve;
        }));
        await signInFirstPartyPage(page);
        await pageReadsUnconfirmed(page);

        await runFromClick(page, 'puter.ui.requestEmailConfirmation()');
        await frameReady(page);
        await codeWindow(page).locator('.digit-input').first().click();
        const sent = page.waitForRequest((r) => r.method() === 'POST' && r.url() === `${API_ORIGIN}/confirm-email`);
        await page.keyboard.type('123456');
        await sent;
        await page.keyboard.press('Escape');
        answer();
        expect(await result(page)).toEqual({ ok: true, value: { response: true } });
        await expect(page.locator('dialog.puter-popup-frame')).toHaveCount(0);
    });

    test('Escape on the save-account window a temporary account sees resolves false', async ({ page }) => {
        await routeFrameSession(page, { ...UNCONFIRMED, is_temp: true, email: null });
        await signInFirstPartyPage(page);
        await pageReadsUnconfirmed(page);

        await runFromClick(page, 'puter.ui.requestEmailConfirmation()');
        await frameReady(page);
        await frame(page).locator('.window-save-account .username').click();
        await page.keyboard.press('Escape');
        expect(await result(page)).toEqual({ ok: true, value: { response: false } });
        await expect(page.locator('dialog.puter-popup-frame')).toHaveCount(0);
    });

    test('a temporary account saves itself, then enters the code in the only window showing', async ({ page }) => {
        await routeFrameSession(page, { ...UNCONFIRMED, is_temp: true, email: null });
        await routeConfirmEmail(page);
        let user;
        // Saves the account as the server would, leaving the test's own account as it is.
        await page.context().route(`${API_ORIGIN}/save_account`, (route) => route.fulfill({
            status: route.request().method() === 'OPTIONS' ? 204 : 200,
            headers: {
                'access-control-allow-origin': PUTER_ORIGIN,
                'access-control-allow-headers': '*',
                'access-control-allow-credentials': 'true',
            },
            contentType: 'application/json',
            body: JSON.stringify({ user: { ...user, ...UNCONFIRMED, is_temp: false, email: 'saved@example.com' } }),
        }));
        await signInFirstPartyPage(page);
        user = await page.evaluate(() => puter.whoamiCache_);
        await pageReadsUnconfirmed(page);

        await runFromClick(page, 'puter.ui.requestEmailConfirmation()');
        await frameReady(page);
        const saveWindow = frame(page).locator('.window-save-account');
        await saveWindow.locator('.username').fill('saved');
        await saveWindow.locator('.email').fill('saved@example.com');
        await saveWindow.locator('.password').fill('a long enough password');
        await saveWindow.locator('.signup-btn').click();

        await expect(codeWindow(page)).toBeVisible();
        // One window over one scrim, not the code window over the save-account window's.
        await expect(saveWindow).toBeHidden();
        await expect(frame(page).locator('.window-backdrop:visible')).toHaveCount(1);
        await codeWindow(page).locator('.digit-input').first().click();
        await page.keyboard.type('123456');
        expect(await result(page)).toEqual({ ok: true, value: { response: true } });
        await expect(page.locator('dialog.puter-popup-frame')).toHaveCount(0);
    });

    test('an account with another check waiting resolves false', async ({ page }) => {
        await routeFrameSession(page, { ...UNCONFIRMED, requires_phone_verification: true });
        await signInFirstPartyPage(page);
        await pageReadsUnconfirmed(page);

        await runFromClick(page, 'puter.ui.requestEmailConfirmation()');
        expect(await result(page)).toEqual({ ok: true, value: { response: false } });
        await expect(page.locator('dialog.puter-popup-frame')).toHaveCount(0);
    });

    test('a page signed in as someone else resolves false', async ({ page }) => {
        await routeFrameSession(page, UNCONFIRMED);
        await signInFirstPartyPage(page);
        await page.evaluate(async () => {
            await puter.whoamiCache_;
            puter.whoami = { uuid: '00000000-0000-4000-8000-000000000000' };
        });
        const popups = [];
        page.on('popup', (p) => popups.push(p));

        await runFromClick(page, 'puter.ui.requestEmailConfirmation()');
        expect(await result(page)).toEqual({ ok: true, value: { response: false } });
        await expect(page.locator('dialog.puter-popup-frame')).toHaveCount(0);
        expect(popups).toHaveLength(0);
    });
});
