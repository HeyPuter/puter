import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from '@playwright/test';
import express from 'express';
import webpack from 'webpack';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let browser;
let server;
let directory;
let origin;
let port;
const requests = [];
const guiRoot = fileURLToPath(new URL('../../../', import.meta.url));
const sessionToken = 'app-browser-test-session';
const sessionCookie = 'app-browser-test-cookie';
const sessionUser = '0b1c9a52-3f0e-4c7a-9a65-2f6d1e8b7c40';
const otherUser = '7d2e4f10-8a3b-4c5d-9e6f-0a1b2c3d4e5f';
const appRows = Array.from({ length: 105 }, (_, i) => ({
    name: `app-${i}`, title: `App ${i}`, icon: null,
}));
const kv = {
    dashboard_apps_order: JSON.stringify(['app-104', 'app-1', 'app-2']),
    dashboard_app_groups: JSON.stringify([{ id: 'work', name: 'Work', apps: ['app-1', 'app-2'] }]),
    dashboard_removed_apps: JSON.stringify(['removed']),
};
// The recommended apps the page carries for a visitor without a session; set per test.
let guestApps = [];
// What puter.apps.get returns for an app; set per test.
let appRead = name => ({ uid: `uid-${name}`, name, index_url: `http://${name}.puter.localhost:${port}/index` });

beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'puter-app-browser-'));
    await new Promise((resolve, reject) => {
        const compiler = webpack({
            mode: 'development',
            entry: { 'apps-embed': path.join(guiRoot, 'src/appsEmbed.js') },
            output: { path: directory, filename: '[name].min.js' },
            module: { rules: [{ test: /jquery-3\.6\.1\.min\.js$/, type: 'javascript/auto' }] },
        });
        compiler.run((error, stats) => compiler.close(closeError => {
            if ( error || closeError ) return reject(error || closeError);
            if ( stats.hasErrors() ) return reject(new Error(stats.toString()));
            resolve();
        }));
    });
    const app = express();
    app.use(express.json({ type: ['application/json', 'text/plain'] }));
    app.use((req, res, next) => {
        requests.push({ path: req.path, body: req.body, auth: req.headers.authorization });
        next();
    });
    app.use('/dist', express.static(directory));
    app.use('/css', express.static(path.join(guiRoot, 'src/css')));
    app.get('/sdk.js', (_req, res) => res.sendFile(path.resolve(guiRoot, '../puter-js/dist/puter.js')));
    app.get('/installedApps', (req, res) => {
        if ( req.headers.authorization !== `Bearer ${sessionToken}` ) return res.sendStatus(401);
        const offset = (Number(req.query.page) - 1) * 100;
        res.json(appRows.slice(offset, offset + 100));
    });
    app.get('/get-gui-token', (req, res) => {
        if ( ! req.headers.cookie?.includes(`puter_auth_token=${sessionCookie}`) ) return res.sendStatus(401);
        res.json({ token: sessionToken });
    });
    // The GUI session's token and the tokens of apps signed in on a sibling subdomain.
    const whoamiByToken = {
        [sessionToken]: { uuid: sessionUser, username: 'session-user' },
        'app-token-session-user': { uuid: sessionUser, username: 'session-user' },
        'app-token-other-user': { uuid: otherUser, username: 'other-user' },
    };
    // The SDK on a sibling subdomain sends credentialed cross-origin requests.
    app.use(['/whoami', '/profile', '/rao'], (req, res, next) => {
        if ( req.headers.origin ) res.set('Access-Control-Allow-Origin', req.headers.origin);
        res.set('Access-Control-Allow-Credentials', 'true');
        res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        if ( req.method === 'OPTIONS' ) return res.sendStatus(204);
        next();
    });
    app.get('/whoami', (req, res) => {
        const user = whoamiByToken[req.headers.authorization?.replace(/^Bearer /, '')];
        if ( ! user ) return res.sendStatus(401);
        res.json(user);
    });
    app.get('/get-launch-apps', (_req, res) => res.json({ recommended: [{ name: 'removed', title: 'Removed' }] }));
    app.get('/cache/last-change-timestamp', (_req, res) => res.json({ timestamp: 0 }));
    app.post('/drivers/call', (req, res) => {
        if ( req.body.auth_token !== sessionToken ) return res.sendStatus(401);
        if ( req.body.interface === 'puter-apps' ) {
            return res.json({ success: true, result: appRead(req.body.args.id.name) });
        }
        res.json({ success: true, result: kv[req.body.args?.key] ?? null });
    });
    app.post('/auth/get-user-app-token', (req, res) => {
        if ( req.headers.authorization !== `Bearer ${sessionToken}` ) return res.sendStatus(401);
        res.json({ token: `token-for-${req.body.app_uid}` });
    });
    app.post('/rao', (_req, res) => res.json({}));
    app.get('/app/:name', (_req, res) => res.send('<title>Opened app</title>'));
    // An app's own page, which signs in with the token the embed hands it.
    app.get('/index', (_req, res) => res.send(`<title>App</title>
        <script>window.PUTER_ORIGIN = '${origin}'; window.PUTER_API_ORIGIN = '${origin}';</script>
        <script src="/sdk.js"></script>`));
    // The host page names its signed-in user as `?user=`, as puter.js does in the fragment.
    app.get('/host', (req, res) => res.send(`<!DOCTYPE html><html><body style="margin:0">
        <iframe title="More apps" src="${origin}/embed/apps${req.query.user ? `#user=${req.query.user}` : ''}" style="border:0;width:100vw;height:100vh"></iframe>
    </body></html>`));
    // An app on a sibling subdomain, signed in with puter.js, with the SDK's user menu.
    app.get('/menu-host', (_req, res) => res.send(`<!DOCTYPE html><html><head>
        <script>window.PUTER_ORIGIN = '${origin}'; window.PUTER_API_ORIGIN = '${origin}';</script>
        <script src="${origin}/sdk.js"></script></head>
        <body><header><puter-user-menu></puter-user-menu></header></body></html>`));
    app.get('/embed/apps', (_req, res) => {
        res.setHeader('Content-Security-Policy', `frame-ancestors 'self' http://*.puter.localhost:${port}`);
        res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
            <link rel="stylesheet" href="/css/normalize.css"><link rel="stylesheet" href="/css/dashboard.css">
            <link rel="stylesheet" href="/css/apps-embed.css"></head><body>
            <main id="app-browser" class="dashboard"></main>
            <script type="application/json" id="app-browser-config">${JSON.stringify({ apiOrigin: origin, sdkUrl: '/sdk.js', guestApps })}</script>
            <script defer src="/dist/apps-embed.min.js"></script></body></html>`);
    });
    server = await new Promise(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    port = server.address().port;
    origin = `http://puter.localhost:${port}`;
    browser = await chromium.launch();
}, 60000);

afterAll(async () => {
    await browser?.close();
    if ( server ) await new Promise(resolve => server.close(resolve));
    if ( directory ) await rm(directory, { recursive: true, force: true });
});

describe('embedded app browser', () => {
    it.each([{ width: 1100, height: 720 }, { width: 390, height: 700 }])(
        'browses and launches apps across subdomains at $width px', async viewport => {
            const context = await browser.newContext({ viewport, storageState: {
                cookies: [], origins: [{ origin, localStorage: [
                    { name: 'auth_token_v2', value: sessionToken },
                    { name: 'user_preferences', value: viewport.width < 500 ? '{invalid' : '{"language":"en"}' },
                ] }],
            } });
            const page = await context.newPage();
            page.setDefaultTimeout(6000);
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            requests.length = 0;
            try {
                const parentUrl = `http://spreadsheet.puter.localhost:${port}/host?user=${sessionUser}`;
                await page.goto(parentUrl);
                const frame = page.frameLocator('iframe');
                await frame.locator('.myapps-group-tile').waitFor();
                expect(await frame.locator('.myapps-reorder-btn, .myapps-add-tile, .myapps-tile-remove').count()).toBe(0);
                expect(await frame.locator('.myapps-search-wrap').evaluate(el => getComputedStyle(el).paddingTop)).toBe('16px');
                expect(await frame.locator('.myapps-tile').first().getAttribute('data-app-name')).toBe('app-104');
                expect(await frame.locator('[data-app-name="removed"]').count()).toBe(0);
                expect(requests.filter(req => req.path === '/installedApps')).toHaveLength(2);
                await frame.locator('.myapps-group-tile').click();
                const name = frame.locator('.myapps-group-name');
                expect(await name.getAttribute('readonly')).not.toBeNull();
                await frame.locator('.myapps-group-panel .myapps-tile').first().waitFor();
                await frame.locator('.myapps-group-open').waitFor();
                await page.screenshot({ path: path.join(tmpdir(), `puter-app-browser-${viewport.width}.png`), animations: 'disabled' });
                const panel = await frame.locator('.myapps-group-panel').boundingBox();
                expect(panel.width).toBeGreaterThan(150);
                expect(panel.x).toBeGreaterThanOrEqual(0);
                expect(panel.x + panel.width).toBeLessThanOrEqual(viewport.width + 1);
                await frame.locator('.myapps-group-panel .myapps-tile').first().press('Escape');
                await frame.locator('.myapps-group-overlay').waitFor({ state: 'detached' });
                await frame.locator('.myapps-search').fill('App 104');
                expect(await frame.locator('.myapps-tile').count()).toBe(1);
                const popupPromise = context.waitForEvent('page');
                await frame.locator('.myapps-tile').click();
                const popup = await popupPromise;
                await popup.waitForURL(/\/index\?/);
                const appUrl = new URL(popup.url());
                expect(appUrl.origin).toBe(`http://app-104.puter.localhost:${port}`);
                expect(appUrl.searchParams.get('puter.app.name')).toBe('app-104');
                expect(appUrl.searchParams.get('puter.origin')).toBe(origin);
                expect(appUrl.searchParams.has('puter.auth.token')).toBe(false);
                expect(appUrl.searchParams.get('utm_campaign')).toBe('app_browser_embed');
                expect(page.url()).toBe(parentUrl);
                await popup.waitForFunction(() => window.puter?.authToken === 'token-for-uid-app-104');
                expect(await popup.evaluate(() => window.opener)).toBeNull();
                // The app's own SDK reports its open too; this is the embed's.
                const embedOpens = requests.filter(req => req.path === '/rao' && req.auth === `Bearer ${sessionToken}`);
                expect(embedOpens.map(req => req.body.app_uid)).toEqual(['uid-app-104']);
                expect(requests.filter(req => req.path === '/drivers/call' && req.body.interface !== 'puter-apps')
                    .every(req => req.body.method === 'get')).toBe(true);
                expect(errors).toEqual([]);
            } finally {
                await context.close();
            }
        }, 30000,
    );

    it('falls back to the session cookie when its local storage holds no session', async () => {
        // Safari gives the frame its own empty storage under a sibling subdomain.
        const context = await browser.newContext({ storageState: {
            cookies: [{
                name: 'puter_auth_token', value: sessionCookie, domain: 'puter.localhost', path: '/',
                expires: -1, httpOnly: true, secure: false, sameSite: 'Lax',
            }],
            origins: [],
        } });
        try {
            const page = await context.newPage();
            page.setDefaultTimeout(6000);
            await page.goto(`http://spreadsheet.puter.localhost:${port}/host?user=${sessionUser}`);
            const frame = page.frameLocator('iframe');
            await frame.locator('.myapps-group-tile').waitFor();
            expect(await frame.locator('[data-app-name="app-104"]').count()).toBe(1);
        } finally {
            await context.close();
        }
    });

    it('opens the desktop landing, cut off from the embed, for an app it can\'t launch itself', async () => {
        const context = await browser.newContext({ storageState: {
            cookies: [], origins: [{ origin, localStorage: [{ name: 'auth_token_v2', value: sessionToken }] }],
        } });
        const previousRead = appRead;
        appRead = name => ({ ...previousRead(name), privateAccess: { hasAccess: false } });
        try {
            const page = await context.newPage();
            page.setDefaultTimeout(6000);
            await page.goto(`${origin}/embed/apps#user=${sessionUser}`);
            await page.locator('.myapps-search').fill('App 104');
            const popupPromise = context.waitForEvent('page');
            await page.locator('.myapps-tile').click();
            const popup = await popupPromise;
            await popup.waitForURL(`${origin}/app/app-104`);
            expect(await popup.evaluate(() => window.opener)).toBeNull();
        } finally {
            appRead = previousRead;
            await context.close();
        }
    });

    it('does not start login or load the SDK when the existing session is absent', async () => {
        const page = await browser.newPage();
        requests.length = 0;
        try {
            await page.goto(`${origin}/embed/apps`);
            await page.getByRole('status').waitFor();
            expect(requests.some(req => ['/sdk.js', '/installedApps', '/login', '/signup'].includes(req.path))).toBe(false);
        } finally {
            await page.close();
        }
    });

    it('shows the recommended apps without a session and opens them cut off from the embed', async () => {
        guestApps = [
            { name: 'notes', title: 'Notes', uuid: 'uid-notes', index_url: `http://notes.puter.localhost:${port}/index`, icon: null },
            { name: 'editor', title: 'Editor', uuid: 'uid-editor', index_url: 'https://builtins.namespaces.puter.com/editor', icon: null },
        ];
        const context = await browser.newContext();
        requests.length = 0;
        try {
            const page = await context.newPage();
            page.setDefaultTimeout(6000);
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(`http://spreadsheet.puter.localhost:${port}/host`);
            const frame = page.frameLocator('iframe');
            await frame.locator('[data-app-name="notes"]').waitFor();
            expect(await frame.locator('.myapps-tile').count()).toBe(2);
            expect(requests.some(req => ['/sdk.js', '/installedApps', '/get-launch-apps', '/drivers/call'].includes(req.path))).toBe(false);

            let popupPromise = context.waitForEvent('page');
            await frame.locator('[data-app-name="notes"]').click();
            let popup = await popupPromise;
            await popup.waitForURL(/\/index\?/);
            const appUrl = new URL(popup.url());
            expect(appUrl.origin).toBe(`http://notes.puter.localhost:${port}`);
            expect(appUrl.searchParams.get('utm_campaign')).toBe('app_browser_embed');
            expect(await popup.evaluate(() => window.opener)).toBeNull();

            popupPromise = context.waitForEvent('page');
            await frame.locator('[data-app-name="editor"]').click();
            popup = await popupPromise;
            await popup.waitForURL(`${origin}/app/editor`);
            expect(requests.some(req => ['/auth/get-user-app-token', '/rao'].includes(req.path))).toBe(false);
            expect(errors).toEqual([]);
        } finally {
            guestApps = [];
            await context.close();
        }
    });

    it('shows the recommended apps when the browser refuses access to storage', async () => {
        guestApps = [{ name: 'notes', title: 'Notes', uuid: 'uid-notes', index_url: `http://notes.puter.localhost:${port}/index`, icon: null }];
        const context = await browser.newContext();
        try {
            await context.addInitScript(() => {
                Object.defineProperty(window, 'localStorage', {
                    get () { throw new DOMException('Access is denied for this document.', 'SecurityError'); },
                });
            });
            const page = await context.newPage();
            page.setDefaultTimeout(6000);
            await page.goto(`${origin}/embed/apps#user=${sessionUser}`);
            await page.locator('[data-app-name="notes"]').waitFor();
        } finally {
            guestApps = [];
            await context.close();
        }
    });

    it.each([429, 503])('does not show the signed-out list when the session lookup fails with %i', async status => {
        guestApps = [{ name: 'notes', title: 'Notes', uuid: 'uid-notes', index_url: `http://notes.puter.localhost:${port}/index`, icon: null }];
        const context = await browser.newContext();
        try {
            const page = await context.newPage();
            page.setDefaultTimeout(6000);
            await page.route('**/get-gui-token', route => route.fulfill({ status }));
            await page.goto(`${origin}/embed/apps#user=${sessionUser}`);
            await page.getByRole('status').waitFor();
            expect(await page.getByRole('status').textContent()).toContain('Apps are unavailable');
            expect(await page.locator('.myapps-tile').count()).toBe(0);
        } finally {
            guestApps = [];
            await context.close();
        }
    });

    describe('only shows the session to the host\'s own user', () => {
        const notes = () => ({ name: 'notes', title: 'Notes', uuid: 'uid-notes', index_url: `http://notes.puter.localhost:${port}/index`, icon: null });
        const signedInContext = () => browser.newContext({ storageState: {
            cookies: [], origins: [{ origin, localStorage: [{ name: 'auth_token_v2', value: sessionToken }] }],
        } });

        it.each([
            ['names no user', ''],
            ['names another user', `?user=${otherUser}`],
            ['names a malformed user', '?user=session-user'],
        ])('shows the signed-out list when the host %s', async (_label, query) => {
            guestApps = [notes()];
            const context = await signedInContext();
            requests.length = 0;
            try {
                const page = await context.newPage();
                page.setDefaultTimeout(6000);
                await page.goto(`http://spreadsheet.puter.localhost:${port}/host${query}`);
                const frame = page.frameLocator('iframe');
                await frame.locator('[data-app-name="notes"]').waitFor();
                expect(await frame.locator('.myapps-tile').count()).toBe(1);
                expect(requests.some(req => ['/sdk.js', '/installedApps', '/drivers/call'].includes(req.path))).toBe(false);

                const popupPromise = context.waitForEvent('page');
                await frame.locator('[data-app-name="notes"]').click();
                const popup = await popupPromise;
                await popup.waitForURL(/\/index\?/);
                expect(await popup.evaluate(() => window.opener)).toBeNull();
                expect(requests.some(req => ['/auth/get-user-app-token', '/rao'].includes(req.path))).toBe(false);
            } finally {
                guestApps = [];
                await context.close();
            }
        });

        it('shows the signed-out list when the API refuses the stored session', async () => {
            guestApps = [notes()];
            const context = await browser.newContext({ storageState: {
                cookies: [], origins: [{ origin, localStorage: [{ name: 'auth_token_v2', value: 'revoked-session' }] }],
            } });
            try {
                const page = await context.newPage();
                page.setDefaultTimeout(6000);
                await page.goto(`${origin}/embed/apps#user=${sessionUser}`);
                await page.locator('[data-app-name="notes"]').waitFor();
                expect(await page.locator('.myapps-tile').count()).toBe(1);
            } finally {
                guestApps = [];
                await context.close();
            }
        });

        it('shows a spinner while it checks the session', async () => {
            const context = await signedInContext();
            let respond;
            try {
                const page = await context.newPage();
                page.setDefaultTimeout(6000);
                await page.route('**/whoami', route => { respond = () => route.continue(); });
                await page.goto(`${origin}/embed/apps#user=${sessionUser}`);
                await expect.poll(() => typeof respond).toBe('function');
                const spinner = () => page.locator('#app-browser').evaluate(root => getComputedStyle(root, '::after').animationName);
                expect(await spinner()).not.toBe('none');
                await respond();
                await page.locator('[data-app-name="app-104"]').waitFor();
                expect(await spinner()).toBe('none');
            } finally {
                await context.close();
            }
        });

        it('shows an unavailable state when the session check fails', async () => {
            guestApps = [notes()];
            const context = await signedInContext();
            try {
                const page = await context.newPage();
                page.setDefaultTimeout(6000);
                await page.route('**/whoami', route => route.fulfill({ status: 503 }));
                await page.goto(`${origin}/embed/apps#user=${sessionUser}`);
                await page.getByRole('status').waitFor();
                expect(await page.getByRole('status').textContent()).toContain('Apps are unavailable');
                expect(await page.locator('.myapps-tile').count()).toBe(0);
            } finally {
                guestApps = [];
                await context.close();
            }
        });

        it('reloads for the user a changed fragment names', async () => {
            guestApps = [notes()];
            const context = await signedInContext();
            try {
                const page = await context.newPage();
                page.setDefaultTimeout(6000);
                await page.goto(`${origin}/embed/apps#user=${sessionUser}`);
                await page.locator('[data-app-name="app-104"]').waitFor();
                await page.evaluate(user => { window.location.hash = `user=${user}`; }, otherUser);
                await page.locator('[data-app-name="notes"]').waitFor();
                expect(await page.locator('[data-app-name="app-104"]').count()).toBe(0);
            } finally {
                guestApps = [];
                await context.close();
            }
        });
    });

    describe('opened from the SDK\'s user menu', () => {
        const menuContext = async (appToken, options = {}) => {
            guestApps = [{ name: 'notes', title: 'Notes', uuid: 'uid-notes', index_url: `http://notes.puter.localhost:${port}/index`, icon: null }];
            const host = `http://spreadsheet.puter.localhost:${port}`;
            return browser.newContext({ ...options, storageState: {
                cookies: [],
                origins: [
                    { origin, localStorage: [{ name: 'auth_token_v2', value: sessionToken }] },
                    { origin: host, localStorage: appToken ? [
                        { name: 'puter.auth.token.v2', value: appToken },
                        { name: 'puter.auth.token.origin.v2', value: origin },
                    ] : [] },
                ],
            } });
        };

        it('shows the user\'s apps to the same user and the signed-out list once the app signs out', async () => {
            const context = await menuContext('app-token-session-user');
            try {
                const page = await context.newPage();
                page.setDefaultTimeout(6000);
                const errors = [];
                page.on('pageerror', error => errors.push(error.message));
                await page.goto(`http://spreadsheet.puter.localhost:${port}/menu-host`);
                await page.locator('puter-user-menu .avatar').waitFor();
                expect(await page.locator('puter-user-menu .avatar').textContent()).toBe('S');

                await page.locator('puter-user-menu .apps-button').click();
                const iframe = page.locator('puter-user-menu iframe');
                expect(await iframe.getAttribute('src')).toBe(`${origin}/embed/apps#user=${sessionUser}`);
                await page.frameLocator('puter-user-menu iframe').locator('[data-app-name="app-104"]').waitFor();

                // The panel hangs under its button, inside the viewport.
                const button = await page.locator('puter-user-menu .apps-button').boundingBox();
                const panel = await page.locator('puter-user-menu .apps-panel').boundingBox();
                const viewport = page.viewportSize();
                expect(panel.y).toBeGreaterThan(button.y + button.height);
                expect(panel.x).toBeGreaterThanOrEqual(0);
                expect(panel.x + panel.width).toBeLessThanOrEqual(viewport.width);

                // Closing keeps the embed, so reopening shows the same page.
                const embed = page.frames().find(frame => frame.url().startsWith(`${origin}/embed/apps`));
                await embed.evaluate(() => { window.keptAcrossOpens = true; });
                await page.locator('puter-user-menu .apps-close').click();
                await page.locator('puter-user-menu .apps-panel').waitFor({ state: 'hidden' });
                await page.locator('puter-user-menu .apps-button').click();
                expect(await embed.evaluate(() => window.keptAcrossOpens)).toBe(true);

                await page.evaluate(() => puter.auth.signOut());
                await iframe.waitFor({ state: 'detached' });
                await page.locator('puter-user-menu .sign-in').waitFor();
                await page.locator('puter-user-menu .apps-button').click();
                expect(await iframe.getAttribute('src')).toBe(`${origin}/embed/apps`);
                const frame = page.frameLocator('puter-user-menu iframe');
                await frame.locator('[data-app-name="notes"]').waitFor();
                expect(await frame.locator('[data-app-name="app-104"]').count()).toBe(0);
                expect(errors).toEqual([]);
            } finally {
                guestApps = [];
                await context.close();
            }
        });

        it('shows the signed-out list to an app signed in as another user', async () => {
            const context = await menuContext('app-token-other-user');
            try {
                const page = await context.newPage();
                page.setDefaultTimeout(6000);
                await page.goto(`http://spreadsheet.puter.localhost:${port}/menu-host`);
                await page.locator('puter-user-menu .avatar').waitFor();
                await page.locator('puter-user-menu .apps-button').click();
                const frame = page.frameLocator('puter-user-menu iframe');
                await frame.locator('[data-app-name="notes"]').waitFor();
                expect(await frame.locator('[data-app-name="app-104"]').count()).toBe(0);
            } finally {
                guestApps = [];
                await context.close();
            }
        });

        it('closes the account menu when Tab leaves it', async () => {
            const context = await menuContext('app-token-session-user');
            try {
                const page = await context.newPage();
                page.setDefaultTimeout(6000);
                await page.goto(`http://spreadsheet.puter.localhost:${port}/menu-host`);
                await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<button id="after">After</button>'));
                const menu = page.locator('puter-user-menu .menu');
                await page.locator('puter-user-menu .avatar').click();
                await menu.waitFor();
                await page.keyboard.press('Tab');
                await menu.waitFor({ state: 'hidden' });
                expect(await page.evaluate(() => document.activeElement.id)).toBe('after');

                await page.locator('puter-user-menu .avatar').click();
                await menu.waitFor();
                await page.keyboard.press('Shift+Tab');
                await menu.waitFor({ state: 'hidden' });
                expect(await page.evaluate(() => document.activeElement.shadowRoot?.activeElement?.className)).toBe('apps-button');
            } finally {
                guestApps = [];
                await context.close();
            }
        });

        it('moves focus to Sign in after signing out from the keyboard', async () => {
            const context = await menuContext('app-token-session-user');
            try {
                const page = await context.newPage();
                page.setDefaultTimeout(6000);
                await page.goto(`http://spreadsheet.puter.localhost:${port}/menu-host`);
                await page.locator('puter-user-menu .avatar').focus();
                await page.keyboard.press('Enter');
                await page.locator('puter-user-menu .menu').waitFor();
                await page.keyboard.press('Enter');
                await page.locator('puter-user-menu .sign-in').waitFor();
                await expect.poll(() => page.evaluate(() => document.activeElement.shadowRoot?.activeElement?.className)).toBe('sign-in');
            } finally {
                guestApps = [];
                await context.close();
            }
        });

        it('shows the app browser in a theme the page forces', async () => {
            const context = await menuContext('app-token-session-user');
            try {
                const page = await context.newPage();
                page.setDefaultTimeout(6000);
                await page.emulateMedia({ colorScheme: 'light' });
                await page.goto(`http://spreadsheet.puter.localhost:${port}/menu-host`);
                const menu = page.locator('puter-user-menu');
                await menu.evaluate(el => el.setAttribute('theme', 'dark'));
                await page.locator('puter-user-menu .apps-button').click();
                const frame = page.frameLocator('puter-user-menu iframe');
                await frame.locator('[data-app-name="app-104"]').waitFor();
                const background = () => frame.locator('body').evaluate(body => getComputedStyle(body).backgroundColor);
                expect(await background()).toBe('rgb(30, 30, 30)');

                await menu.evaluate(el => el.setAttribute('theme', 'light'));
                await expect.poll(background).toBe('rgb(255, 255, 255)');
                await frame.locator('[data-app-name="app-104"]').waitFor();
                expect(await page.locator('puter-user-menu .apps-panel').isVisible()).toBe(true);
            } finally {
                guestApps = [];
                await context.close();
            }
        });

        it('leaves no hover shading on the Apps button once a tap closes it', async () => {
            const context = await menuContext('app-token-session-user', {
                viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true,
            });
            try {
                const page = await context.newPage();
                page.setDefaultTimeout(6000);
                await page.goto(`http://spreadsheet.puter.localhost:${port}/menu-host`);
                const button = page.locator('puter-user-menu .apps-button');
                await button.tap();
                await page.locator('puter-user-menu .apps-panel').waitFor();
                await button.tap();
                await page.locator('puter-user-menu .apps-panel').waitFor({ state: 'hidden' });
                expect(await button.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
            } finally {
                guestApps = [];
                await context.close();
            }
        });

        it('shows Sign in pressed and the account hovered', async () => {
            const context = await menuContext(null);
            try {
                const page = await context.newPage();
                page.setDefaultTimeout(6000);
                await page.goto(`http://spreadsheet.puter.localhost:${port}/menu-host`);
                const signIn = page.locator('puter-user-menu .sign-in');
                await signIn.hover();
                await page.mouse.down();
                expect(await signIn.evaluate(el => getComputedStyle(el).color)).toBe('rgb(190, 222, 245)');
                await page.mouse.move(0, 0);
                await page.mouse.up();

                await page.evaluate(() => puter.setAuthToken('app-token-session-user'));
                const avatar = page.locator('puter-user-menu .avatar');
                await avatar.waitFor();
                expect(await avatar.evaluate(el => getComputedStyle(el).boxShadow)).toBe('none');
                await avatar.hover();
                expect(await avatar.evaluate(el => getComputedStyle(el).boxShadow)).not.toBe('none');
            } finally {
                guestApps = [];
                await context.close();
            }
        });

        it('shows the account before its picture arrives', async () => {
            const context = await menuContext('app-token-session-user');
            let respond;
            try {
                const page = await context.newPage();
                page.setDefaultTimeout(6000);
                await page.route('**/profile', route => { respond = () => route.fulfill({
                    status: 200,
                    headers: { 'Access-Control-Allow-Origin': `http://spreadsheet.puter.localhost:${port}`, 'Access-Control-Allow-Credentials': 'true' },
                    contentType: 'application/json',
                    body: JSON.stringify({ picture: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }),
                }); });
                await page.goto(`http://spreadsheet.puter.localhost:${port}/menu-host`);
                await page.locator('puter-user-menu .avatar').waitFor({ timeout: 2000 });
                expect(await page.locator('puter-user-menu .avatar').textContent()).toBe('S');
                expect(await page.locator('puter-user-menu .apps-button').isVisible()).toBe(true);
                await expect.poll(() => typeof respond).toBe('function');
                await respond();
                await page.locator('puter-user-menu .avatar img').waitFor();
            } finally {
                guestApps = [];
                await context.close();
            }
        });

        it('names the user an app signs in as after loading', async () => {
            const context = await menuContext(null);
            try {
                const page = await context.newPage();
                page.setDefaultTimeout(6000);
                await page.goto(`http://spreadsheet.puter.localhost:${port}/menu-host`);
                await page.locator('puter-user-menu .sign-in').waitFor();
                // What `puter.auth.signIn()` does with the token its popup hands back.
                await page.evaluate(() => puter.setAuthToken('app-token-session-user'));
                await page.locator('puter-user-menu .avatar').waitFor();
                await expect.poll(() => page.locator('puter-user-menu .avatar').textContent()).toBe('S');
                await page.locator('puter-user-menu .apps-button').click();
                expect(await page.locator('puter-user-menu iframe').getAttribute('src')).toBe(`${origin}/embed/apps#user=${sessionUser}`);
                await page.frameLocator('puter-user-menu iframe').locator('[data-app-name="app-104"]').waitFor();
            } finally {
                guestApps = [];
                await context.close();
            }
        });
    });

    it('shows an unavailable state if the SDK cannot load', async () => {
        const context = await browser.newContext({ storageState: {
            cookies: [], origins: [{ origin, localStorage: [{ name: 'auth_token_v2', value: sessionToken }] }],
        } });
        try {
            const page = await context.newPage();
            await page.route('**/sdk.js', route => route.abort());
            await page.goto(`${origin}/embed/apps#user=${sessionUser}`);
            await page.getByRole('status').waitFor();
            expect(await page.getByRole('status').textContent()).toContain('Apps are unavailable');
        } finally {
            await context.close();
        }
    });

    it('blocks a parent outside the deployment domain', async () => {
        const page = await browser.newPage();
        requests.length = 0;
        try {
            await page.goto(`http://outside.localhost:${port}/host`);
            expect(requests.some(req => req.path === '/embed/apps')).toBe(true);
            expect(requests.some(req => req.path === '/dist/apps-embed.min.js')).toBe(false);
        } finally {
            await page.close();
        }
    });
});
