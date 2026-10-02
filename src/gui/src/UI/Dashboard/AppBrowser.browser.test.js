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
const appRows = Array.from({ length: 105 }, (_, i) => ({
    name: `app-${i}`, title: `App ${i}`, icon: null,
}));
const kv = {
    dashboard_apps_order: JSON.stringify(['app-104', 'app-1', 'app-2']),
    dashboard_app_groups: JSON.stringify([{ id: 'work', name: 'Work', apps: ['app-1', 'app-2'] }]),
    dashboard_removed_apps: JSON.stringify(['removed']),
};

beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'puter-app-browser-'));
    await new Promise((resolve, reject) => {
        const compiler = webpack({
            mode: 'development',
            entry: { 'apps-embed': path.join(guiRoot, 'src/appsEmbed.js'), 'toolbar-embed': path.join(guiRoot, 'src/toolbarEmbed.js'), 'toolbar-host': path.join(guiRoot, 'src/toolbarHost.js') },
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
    app.get('/get-launch-apps', (_req, res) => res.json({ recommended: [{ name: 'removed', title: 'Removed' }] }));
    app.get('/cache/last-change-timestamp', (_req, res) => res.json({ timestamp: 0 }));
    app.post('/drivers/call', (req, res) => {
        if ( req.body.auth_token !== sessionToken ) return res.sendStatus(401);
        res.json({ success: true, result: kv[req.body.args?.key] ?? null });
    });
    app.get('/whoami', (req, res) => {
        if ( req.headers.authorization === 'Bearer second-session' ) return res.json({ uuid: 'second', username: 'Second', subscription: { active: true } });
        if ( req.headers.authorization !== `Bearer ${sessionToken}` ) return res.sendStatus(401);
        res.json({ uuid: 'first', username: 'First', email: 'first@example.test' });
    });
    app.get('/profile', (_req, res) => res.json({}));
    app.get('/session/sync-cookie', (_req, res) => res.sendStatus(200));
    app.get('/get-anticsrf-token', (_req, res) => res.json({ token: 'csrf-token' }));
    app.post('/logout', (req, res) => res.sendStatus(req.body.anti_csrf === 'csrf-token' ? 200 : 403));
    app.get(['/dashboard', '/action/login'], (_req, res) => res.send('<title>Account action</title>'));
    app.get('/toolbar-host', (_req, res) => res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
        <header style="display:flex;justify-content:flex-end"><iframe data-puter-toolbar title="Puter" src="${origin}/embed/toolbar" style="border:0;width:244px;height:48px"></iframe></header>
        <button id="outside">Host app</button>
        <script>window.sessionChanges=0;document.addEventListener('puter:session-changed',()=>window.sessionChanges++);</script>
        <script defer src="${origin}/dist/toolbar-host.min.js"></script></body></html>`));
    app.get('/embed/toolbar', (_req, res) => {
        res.setHeader('Content-Security-Policy', `frame-ancestors 'self' http://*.puter.localhost:${port}`);
        res.send(`<!DOCTYPE html><html><head><link rel="stylesheet" href="/css/dashboard.css"><link rel="stylesheet" href="/css/toolbar-embed.css"></head><body>
            <main id="puter-toolbar" class="dashboard"></main>
            <script type="application/json" id="app-browser-config">${JSON.stringify({ apiOrigin: origin, domain: 'puter.localhost' })}</script>
            <script defer src="/dist/toolbar-embed.min.js"></script></body></html>`);
    });
    app.get('/app/:name', (_req, res) => res.send('<title>Opened app</title>'));
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
                await popup.waitForLoadState();
                expect(popup.url()).toBe(`${origin}/app/app-104`);
                expect(page.url()).toBe(parentUrl);
                expect(await popup.evaluate(() => window.opener)).toBeNull();
                expect(requests.filter(req => req.path === '/drivers/call').every(req => req.body.method === 'get')).toBe(true);
                expect(errors).toEqual([]);
            } finally {
                await context.close();
            }
        }, 30000,
    );

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


describe('embedded toolbar', () => {
    async function openToolbar (viewport = { width: 1100, height: 720 }, token = sessionToken, storage = []) {
        const context = await browser.newContext({ viewport, storageState: {
            cookies: [], origins: [{ origin, localStorage: [
                ...storage,
                { name: 'auth_token_v2', value: token },
                { name: 'logged_in_users', value: JSON.stringify([
                    { uuid: 'first', username: 'First', auth_token: sessionToken },
                    { uuid: 'second', username: 'Second', auth_token: 'second-session' },
                ]) },
            ] }],
        } });
        const page = await context.newPage();
        page.setDefaultTimeout(7000);
        await page.goto(`http://spreadsheet.puter.localhost:${port}/toolbar-host`);
        return { context, page, toolbar: page.frameLocator('iframe[data-puter-toolbar]') };
    }
    it.each([{ width: 1100, height: 720 }, { width: 390, height: 700 }])('expands and closes apps without changing host layout at $width px', async viewport => {
        const { context, page, toolbar } = await openToolbar(viewport);
        try {
            const before = await page.locator('#outside').boundingBox();
            await toolbar.getByRole('button', { name: 'Your apps', exact: true }).click();
            const apps = toolbar.frameLocator('.toolbar-apps');
            await apps.locator('.myapps-group-tile').waitFor();
            const bounds = await page.locator('iframe[data-puter-toolbar]').boundingBox();
            expect(bounds.width).toBeGreaterThan(300);
            expect(bounds.x + bounds.width).toBe(viewport.width - 8);
            expect(await page.locator('#outside').boundingBox()).toEqual(before);
            await page.screenshot({ path: path.join(tmpdir(), `puter-toolbar-${viewport.width}.png`), animations: 'disabled' });
            await apps.locator('.myapps-group-tile').click();
            await apps.locator('.myapps-group-panel .myapps-tile').first().press('Escape');
            await apps.locator('.myapps-group-overlay').waitFor({ state: 'detached' });
            expect(await toolbar.locator('.toolbar-panel').count()).toBe(1);
            await apps.locator('.myapps-search').fill('App 104');
            const popupPromise = context.waitForEvent('page');
            await apps.locator('.myapps-tile').click();
            const popup = await popupPromise;
            await popup.waitForLoadState();
            expect(popup.url()).toBe(`${origin}/app/app-104`);
            expect(await popup.evaluate(() => window.opener)).toBeNull();
            await apps.locator('.myapps-search').press('Escape');
            await toolbar.locator('.toolbar-panel').waitFor({ state: 'detached' });
            await expect.poll(async () => (await page.locator('iframe[data-puter-toolbar]').boundingBox()).height).toBe(48);
            await toolbar.getByRole('button', { name: 'Account', exact: true }).click();
            await toolbar.getByText('first@example.test').waitFor();
            await page.screenshot({ path: path.join(tmpdir(), `puter-toolbar-account-${viewport.width}.png`), animations: 'disabled' });
            await page.mouse.click(2, viewport.height - 2);
            await toolbar.locator('.toolbar-panel').waitFor({ state: 'detached' });
        } finally { await context.close(); }
    }, 30000);
    it.each(['apps', 'account'])('keeps the toolbar row stationary before the host expands the %s menu', async panel => {
        const { context, toolbar } = await openToolbar();
        try {
            await toolbar.getByRole('button', { name: 'Your apps', exact: true }).waitFor();
            const positions = await toolbar.locator('body').evaluate((body, panel) => {
                const row = body.querySelector('.toolbar-row');
                const before = row.getBoundingClientRect().top;
                body.querySelector(`[data-panel="${panel}"]`).click();
                return { before, after: row.getBoundingClientRect().top, scroll: window.scrollY, focused: document.activeElement.className };
            }, panel);
            expect(positions.after).toBe(positions.before);
            expect(positions.scroll).toBe(0);
            expect(positions.focused).toBe('toolbar-close');
        } finally { await context.close(); }
    });

    it('leaves focus on the host page that closed the menu, and returns it to the toggle on Escape', async () => {
        const { context, page, toolbar } = await openToolbar();
        try {
            await toolbar.getByRole('button', { name: 'Account', exact: true }).click();
            await toolbar.locator('.toolbar-panel').waitFor();
            await page.locator('#outside').click();
            await toolbar.locator('.toolbar-panel').waitFor({ state: 'detached' });
            await page.waitForTimeout(100);
            expect(await page.evaluate(() => document.activeElement.id)).toBe('outside');
            await toolbar.getByRole('button', { name: 'Account', exact: true }).click();
            await toolbar.locator('.toolbar-close').press('Escape');
            await toolbar.locator('.toolbar-panel').waitFor({ state: 'detached' });
            expect(await toolbar.locator('body').evaluate(() => document.activeElement.dataset.panel)).toBe('account');
        } finally { await context.close(); }
    });

    it('closes when the empty part of the expanded frame is pressed', async () => {
        const { context, page, toolbar } = await openToolbar();
        try {
            await toolbar.getByRole('button', { name: 'Your apps', exact: true }).click();
            await expect.poll(async () => (await page.locator('iframe[data-puter-toolbar]').boundingBox()).width).toBeGreaterThan(300);
            const frame = await page.locator('iframe[data-puter-toolbar]').boundingBox();
            await page.mouse.click(frame.x + 10, frame.y + 10);
            await toolbar.locator('.toolbar-panel').waitFor({ state: 'detached' });
        } finally { await context.close(); }
    });

    it('labels controls with translated text encoded once', async () => {
        const { context, toolbar } = await openToolbar(undefined, sessionToken, [{ name: 'user_preferences', value: '{"language":"de"}' }]);
        try {
            await toolbar.getByRole('button', { name: 'Konto', exact: true }).click();
            await toolbar.getByRole('button', { name: 'Schließen', exact: true }).waitFor();
        } finally { await context.close(); }
    });

    it('opens upgrade, settings, and add-account in new tabs', async () => {
        const { context, page, toolbar } = await openToolbar();
        try {
            for ( const [label, suffix] of [['Upgrade', '/dashboard?upgrade=1#usage'], ['Account settings', '/dashboard#account'], ['Add another account', '/action/login']] ) {
                if ( label !== 'Upgrade' && !(await toolbar.locator('.toolbar-panel').count()) ) await toolbar.getByRole('button', { name: 'Account', exact: true }).click();
                const popupPromise = context.waitForEvent('page');
                await toolbar.getByRole('link', { name: label, exact: true }).click();
                const popup = await popupPromise;
                await popup.waitForLoadState();
                expect(popup.url()).toBe(`${origin}${suffix}`);
                expect(await popup.evaluate(() => window.opener)).toBeNull();
                await popup.close();
            }
            expect(page.url()).toContain('/toolbar-host');
        } finally { await context.close(); }
    });
    it('switches accounts, syncs the session, and hides Upgrade for a subscriber', async () => {
        const { context, page, toolbar } = await openToolbar();
        try {
            await toolbar.getByRole('button', { name: 'Account', exact: true }).click();
            await toolbar.locator('[data-account="0"]').click();
            await page.waitForFunction(() => window.sessionChanges === 1);
            await toolbar.getByRole('button', { name: 'Account', exact: true }).waitFor();
            expect(await toolbar.getByRole('link', { name: 'Upgrade', exact: true }).count()).toBe(0);
            await toolbar.getByRole('button', { name: 'Account', exact: true }).click();
            expect(await toolbar.locator('.toolbar-current strong').textContent()).toBe('Second');
            expect(requests.some(req => req.path === '/session/sync-cookie' && req.auth === 'Bearer second-session')).toBe(true);
        } finally { await context.close(); }
    });
    it('preserves the current session on failed switching and signs out only after confirmation', async () => {
        const { context, page, toolbar } = await openToolbar();
        try {
            await page.route('**/session/sync-cookie', route => route.fulfill({ status: 500 }));
            await toolbar.getByRole('button', { name: 'Account', exact: true }).click();
            await toolbar.locator('[data-account="0"]').click();
            await toolbar.getByRole('status').waitFor();
            expect(await page.evaluate(() => window.sessionChanges)).toBe(0);
            await toolbar.locator('.toolbar-logout').click();
            await toolbar.getByRole('button', { name: 'Cancel', exact: true }).click();
            expect(await toolbar.locator('.toolbar-current strong').textContent()).toBe('First');
            await toolbar.locator('.toolbar-logout').click();
            await toolbar.locator('.toolbar-confirm-logout').click();
            await toolbar.getByText('Puter session unavailable').waitFor();
            expect(await page.evaluate(() => window.sessionChanges)).toBe(1);
        } finally { await context.close(); }
    });
    it('ignores messages from an unrelated window and updates after another tab changes the account', async () => {
        const { context, page, toolbar } = await openToolbar();
        try {
            await toolbar.getByRole('button', { name: 'Account', exact: true }).waitFor();
            await page.evaluate(() => window.postMessage({ channel: 'puter-toolbar', action: 'panel', panel: 'apps' }, location.origin));
            await expect.poll(async () => (await page.locator('iframe[data-puter-toolbar]').boundingBox()).height).toBe(48);
            const other = await context.newPage();
            await other.goto(`${origin}/dashboard`);
            await other.evaluate(() => localStorage.setItem('auth_token_v2', 'second-session'));
            await page.waitForFunction(() => window.sessionChanges === 1);
            await toolbar.getByRole('button', { name: 'Account', exact: true }).click();
            expect(await toolbar.locator('.toolbar-current strong').textContent()).toBe('Second');
        } finally { await context.close(); }
    });
});
