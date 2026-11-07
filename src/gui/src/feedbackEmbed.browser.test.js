import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from '@playwright/test';
import express from 'express';
import webpack from 'webpack';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

let browser;
let server;
let directory;
let origin;
let hostOrigin;
let port;
const requests = [];
const guiRoot = fileURLToPath(new URL('../', import.meta.url));
const sessionToken = 'feedback-embed-test-session';
const unconfirmedToken = 'feedback-embed-test-unconfirmed';
const sessionUser = '0b1c9a52-3f0e-4c7a-9a65-2f6d1e8b7c40';
const unconfirmedUser = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const otherUser = '7d2e4f10-8a3b-4c5d-9e6f-0a1b2c3d4e5f';

beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'puter-feedback-embed-'));
    await new Promise((resolve, reject) => {
        const compiler = webpack({
            mode: 'development',
            entry: { 'feedback-embed': path.join(guiRoot, 'src/feedbackEmbed.js') },
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
    app.use(express.json());
    app.use((req, res, next) => {
        requests.push({ path: req.path, query: req.query, body: req.body, auth: req.headers.authorization });
        next();
    });
    app.use('/dist', express.static(directory));
    app.use('/css', express.static(path.join(guiRoot, 'src/css')));
    app.get('/get-gui-token', (_req, res) => res.sendStatus(401));
    const whoamiByToken = {
        [sessionToken]: { uuid: sessionUser, username: 'session-user', email: 'a@b.test', email_confirmed: true },
        [unconfirmedToken]: {
            uuid: unconfirmedUser, username: 'new-user', email_confirmed: false, requires_email_confirmation: true,
        },
    };
    app.get('/whoami', (req, res) => {
        const user = whoamiByToken[req.headers.authorization?.replace(/^Bearer /, '')];
        if ( ! user ) return res.sendStatus(401);
        res.json(user);
    });
    app.get('/app-feedback/target', (req, res) => {
        if ( req.headers.authorization !== `Bearer ${sessionToken}` ) return res.sendStatus(401);
        if ( req.query.origin !== hostOrigin ) return res.json({ enabled: false });
        res.json({ enabled: true, app: { name: 'notes', title: 'Notes' } });
    });
    app.post('/app-feedback', (req, res) => {
        if ( req.headers.authorization !== `Bearer ${sessionToken}` ) return res.sendStatus(401);
        res.json({});
    });
    // A first-party page that frames the dialog as puter.js does, recording what the embed tells it.
    app.get('/host', (req, res) => res.send(`<!DOCTYPE html><html><body style="margin:0;background:rgb(255,0,0)">
        <script>
            window.received = [];
            addEventListener('message', (e) => {
                if ( e.origin === '${origin}' ) window.received.push(e.data);
            });
        </script>
        <iframe referrerpolicy="origin" title="Send feedback" src="${origin}/embed/feedback#user=${req.query.user ?? ''}"
            style="display:block;border:0;width:100vw;height:100vh;color-scheme:light dark"></iframe>
        <div style="height:3000px"></div>
    </body></html>`));
    app.get('/embed/feedback', (_req, res) => {
        res.setHeader('Content-Security-Policy', `frame-ancestors 'self' ${hostOrigin}`);
        res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
            <link rel="stylesheet" href="/css/normalize.css"><link rel="stylesheet" href="/css/dashboard.css">
            <link rel="stylesheet" href="/css/feedback-embed.css"></head><body>
            <main id="feedback-embed"></main>
            <script type="application/json" id="feedback-embed-config">${JSON.stringify({ apiOrigin: origin, hostOrigin })}</script>
            <script defer src="/dist/feedback-embed.min.js"></script></body></html>`);
    });
    server = await new Promise(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    port = server.address().port;
    origin = `http://puter.localhost:${port}`;
    hostOrigin = `http://notes.puter.localhost:${port}`;
    browser = await chromium.launch();
}, 60000);

afterAll(async () => {
    await browser?.close();
    if ( server ) await new Promise(resolve => server.close(resolve));
    if ( directory ) await rm(directory, { recursive: true, force: true });
});

/** A browser whose GUI origin is signed in with `token`, if any. */
const signedIn = (token, options = {}) => browser.newContext({ ...options, storageState: {
    cookies: [],
    origins: token ? [{ origin, localStorage: [{ name: 'auth_token_v2', value: token }] }] : [],
} });

const received = page => page.evaluate(() => window.received);

/** The [r, g, b] of one pixel of the page, from a screenshot. */
const pixel = async (page, x, y) => {
    const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 }, animations: 'disabled' });
    const data = [];
    for ( let at = 8; at < png.length; ) {
        const length = png.readUInt32BE(at);
        if ( png.toString('ascii', at + 4, at + 8) === 'IDAT' ) data.push(png.subarray(at + 8, at + 8 + length));
        at += 12 + length;
    }
    // One pixel: a filter byte, then its channels unchanged.
    return [...inflateSync(Buffer.concat(data)).subarray(1, 4)];
};

describe('feedback embed', () => {
    it('sends feedback for the framing page as the user it names, then tells it', async () => {
        const context = await signedIn(sessionToken);
        try {
            const page = await context.newPage();
            page.setDefaultTimeout(6000);
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            requests.length = 0;
            await page.goto(`${hostOrigin}/host?user=${sessionUser}`);
            const frame = page.frameLocator('iframe');
            await frame.locator('.app-feedback-form').waitFor();
            expect(await frame.locator('.app-feedback-target-title').textContent()).toBe('Notes');
            expect(await received(page)).toEqual([
                { msg: 'feedbackEmbed', state: 'loading' },
                { msg: 'feedbackEmbed', state: 'ready' },
            ]);
            // The page behind shows through around the dialog, under its scrim.
            expect(await frame.locator('body').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
            await page.screenshot({ path: path.join(tmpdir(), 'puter-feedback-embed.png'), animations: 'disabled' });

            await frame.locator('.app-feedback-message').fill('Love the new editor');
            await frame.locator('.app-feedback-send-btn').click();
            await frame.locator('.app-feedback-success').waitFor();
            await page.waitForFunction(() => window.received.some(m => m.msg === 'feedbackDialogClosed'));
            expect((await received(page)).at(-1)).toEqual({ msg: 'feedbackDialogClosed', sent: true });
            expect(await frame.locator('.app-feedback-overlay').count()).toBe(0);

            const submit = requests.find(req => req.path === '/app-feedback');
            expect(submit.body).toEqual({ origin: hostOrigin, message: 'Love the new editor', context: 'web' });
            expect(submit.auth).toBe(`Bearer ${sessionToken}`);
            expect(errors).toEqual([]);
        } finally {
            await context.close();
        }
    }, 30000);

    it('answers not sent when the user dismisses it', async () => {
        const context = await signedIn(sessionToken);
        try {
            const page = await context.newPage();
            page.setDefaultTimeout(6000);
            await page.goto(`${hostOrigin}/host?user=${sessionUser}`);
            const frame = page.frameLocator('iframe');
            await frame.locator('.app-feedback-form').waitFor();
            await frame.locator('.app-feedback-message').press('Escape');
            await page.waitForFunction(() => window.received.some(m => m.msg === 'feedbackDialogClosed'));
            expect((await received(page)).at(-1)).toEqual({ msg: 'feedbackDialogClosed', sent: false });
        } finally {
            await context.close();
        }
    }, 30000);

    it.each(['light', 'dark'])('lets the page show through under the scrim in %s mode', async (colorScheme) => {
        const context = await signedIn(sessionToken, { colorScheme });
        try {
            const page = await context.newPage();
            page.setDefaultTimeout(6000);
            await page.goto(`${hostOrigin}/host?user=${sessionUser}`);
            const frame = page.frameLocator('iframe');
            await frame.locator('.app-feedback-form').waitFor();
            expect(await frame.locator('body').evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches))
                .toBe(colorScheme === 'dark');
            await page.waitForTimeout(300);
            // The red page, dimmed by the scrim, rather than an opaque frame.
            const [red, green, blue] = await pixel(page, 10, 10);
            expect(red).toBeGreaterThan(green + 40);
            expect(green).toBe(blue);
        } finally {
            await context.close();
        }
    }, 30000);

    it('keeps the page behind from scrolling under the scrim', async () => {
        const context = await signedIn(sessionToken);
        try {
            const page = await context.newPage();
            page.setDefaultTimeout(6000);
            await page.goto(`${hostOrigin}/host?user=${sessionUser}`);
            await page.frameLocator('iframe').locator('.app-feedback-form').waitFor();
            await page.mouse.move(10, 10);
            await page.mouse.wheel(0, 600);
            await page.waitForTimeout(300);
            expect(await page.evaluate(() => window.scrollY)).toBe(0);
        } finally {
            await context.close();
        }
    }, 30000);

    it.each([
        ['no Puter session', null, sessionUser],
        ['a session for another user', sessionToken, otherUser],
        ['a host that names no user', sessionToken, ''],
        ['an email still to confirm', unconfirmedToken, unconfirmedUser],
    ])('tells the host it is unavailable with %s', async (_label, token, user) => {
        const context = await signedIn(token);
        try {
            const page = await context.newPage();
            page.setDefaultTimeout(6000);
            requests.length = 0;
            await page.goto(`${hostOrigin}/host?user=${user}`);
            await page.waitForFunction(() => window.received.length >= 2);
            expect(await received(page)).toEqual([
                { msg: 'feedbackEmbed', state: 'loading' },
                { msg: 'feedbackEmbed', state: 'unavailable' },
            ]);
            expect(await page.frameLocator('iframe').locator('.app-feedback-overlay').count()).toBe(0);
            expect(requests.some(req => req.path.startsWith('/app-feedback'))).toBe(false);
        } finally {
            await context.close();
        }
    }, 30000);

    it('does nothing when opened on its own', async () => {
        const context = await signedIn(sessionToken);
        try {
            const page = await context.newPage();
            requests.length = 0;
            await page.goto(`${origin}/embed/feedback#user=${sessionUser}`);
            await page.waitForLoadState('networkidle');
            expect(await page.locator('.app-feedback-overlay').count()).toBe(0);
            expect(requests.some(req => req.path === '/whoami')).toBe(false);
        } finally {
            await context.close();
        }
    }, 30000);
});
