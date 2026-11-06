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
const appRows = Array.from({ length: 105 }, (_, i) => ({
    name: `app-${i}`, title: `App ${i}`, icon: null,
}));
const kv = {
    dashboard_apps_order: JSON.stringify(['app-104', 'app-1', 'app-2']),
    dashboard_app_groups: JSON.stringify([{ id: 'work', name: 'Work', apps: ['app-1', 'app-2'] }]),
    dashboard_removed_apps: JSON.stringify(['removed']),
};
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
    app.get('/host', (_req, res) => res.send(`<!DOCTYPE html><html><body style="margin:0">
        <iframe title="More apps" src="${origin}/embed/apps" style="border:0;width:100vw;height:100vh"></iframe>
    </body></html>`));
    app.get('/embed/apps', (_req, res) => {
        res.setHeader('Content-Security-Policy', `frame-ancestors 'self' http://*.puter.localhost:${port}`);
        res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
            <link rel="stylesheet" href="/css/normalize.css"><link rel="stylesheet" href="/css/dashboard.css">
            <link rel="stylesheet" href="/css/apps-embed.css"></head><body>
            <main id="app-browser" class="dashboard"></main>
            <script type="application/json" id="app-browser-config">${JSON.stringify({ apiOrigin: origin, sdkUrl: '/sdk.js' })}</script>
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
                const parentUrl = `http://spreadsheet.puter.localhost:${port}/host`;
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
            await page.goto(`http://spreadsheet.puter.localhost:${port}/host`);
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
            await page.goto(`${origin}/embed/apps`);
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

    it('shows an unavailable state if the SDK cannot load', async () => {
        const context = await browser.newContext({ storageState: {
            cookies: [], origins: [{ origin, localStorage: [{ name: 'auth_token_v2', value: sessionToken }] }],
        } });
        try {
            const page = await context.newPage();
            await page.route('**/sdk.js', route => route.abort());
            await page.goto(`${origin}/embed/apps`);
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
