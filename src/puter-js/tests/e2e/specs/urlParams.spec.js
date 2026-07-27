import { test, expect } from '@playwright/test';
import { registerTestApp, deleteTestApp, gotoTestApp } from '../helpers/testApp.js';

const FIXTURE_ORIGIN = process.env.PUTER_TEST_FIXTURE_ORIGIN || 'http://localhost:8080';
const FIXTURE_URL = `${FIXTURE_ORIGIN}/tests/e2e/fixtures/url-params.html`;

const entry = (appFrame, name) => appFrame.locator(`#log [data-entry^="${name}:"]`);

test.describe('puter.ui.setURLParams (env=app)', () => {
    test('writes the query string of the top-level URL, and only the query string', async ({ page }) => {
        const appName = await registerTestApp(page, { fixtureURL: FIXTURE_URL });
        try {
            const appFrame = await gotoTestApp(page, appName);
            const appPath = `/app/${appName}`;

            await appFrame.locator('#set-params-btn').click();

            // The address bar — the parent frame's URL, not the app iframe's.
            await expect(page).toHaveURL(new RegExp(`${appPath}\\?doc=readme&line=10$`));
            await expect(entry(appFrame, 'set')).toContainText('applied:');

            // A second call replaces the whole query string.
            await appFrame.locator('#set-other-params-btn').click();
            await expect(page).toHaveURL(new RegExp(`${appPath}\\?doc=changelog$`));

            // ...and clearing returns to the bare app URL.
            await appFrame.locator('#clear-params-btn').click();
            await expect(page).toHaveURL(new RegExp(`${appPath}$`));
        } finally {
            await deleteTestApp(page, appName);
        }
    });

    test('refuses a param Puter interprets on load', async ({ page }) => {
        const appName = await registerTestApp(page, { fixtureURL: FIXTURE_URL });
        try {
            const appFrame = await gotoTestApp(page, appName);

            await appFrame.locator('#set-reserved-btn').click();

            await expect(entry(appFrame, 'reserved')).toHaveAttribute(
                'data-entry', 'reserved:error:param_reserved');
            // The URL must be untouched — no auth_token anywhere in it.
            expect(page.url()).not.toContain('auth_token');
            await expect(page).toHaveURL(new RegExp(`/app/${appName}$`));
        } finally {
            await deleteTestApp(page, appName);
        }
    });

    test('cannot escape the query string into the path or fragment', async ({ page }) => {
        const appName = await registerTestApp(page, { fixtureURL: FIXTURE_URL });
        try {
            const appFrame = await gotoTestApp(page, appName);

            await appFrame.locator('#set-escaping-btn').click();
            await expect(entry(appFrame, 'escaping')).toContainText('applied:');

            const url = new URL(page.url());
            expect(url.pathname).toBe(`/app/${appName}`);
            expect(url.hash).toBe('');
            expect(url.searchParams.has('auth_token')).toBe(false);
            expect([...url.searchParams.keys()]).toEqual(['evil']);
        } finally {
            await deleteTestApp(page, appName);
        }
    });

    test('does not add a history entry, so Back still leaves the app', async ({ page }) => {
        const appName = await registerTestApp(page, { fixtureURL: FIXTURE_URL });
        try {
            const appFrame = await gotoTestApp(page, appName);

            const before = await page.evaluate(() => history.length);
            await appFrame.locator('#set-params-btn').click();
            await expect(page).toHaveURL(new RegExp(`\\?doc=readme&line=10$`));
            await appFrame.locator('#set-other-params-btn').click();
            await expect(page).toHaveURL(new RegExp(`\\?doc=changelog$`));

            expect(await page.evaluate(() => history.length)).toBe(before);

            // Back leaves the app rather than stepping through its params.
            await page.goBack();
            await expect(page).not.toHaveURL(new RegExp(`/app/${appName}`));
        } finally {
            await deleteTestApp(page, appName);
        }
    });

    test('hands a deep link\'s params to the app it opens', async ({ page }) => {
        const appName = await registerTestApp(page, { fixtureURL: FIXTURE_URL });
        try {
            await page.goto(`/app/${appName}?doc=readme&line=10`);
            const appFrame = page.frameLocator('iframe.window-app-iframe').last();
            await appFrame.locator('body.ready').waitFor({ timeout: 60_000 });

            // The app receives the params on its own URL, which is what an
            // app reads with URLSearchParams at startup.
            const search = await appFrame.locator('#launch-search').textContent();
            const params = new URLSearchParams(search);
            expect(params.get('doc')).toBe('readme');
            expect(params.get('line')).toBe('10');
        } finally {
            await deleteTestApp(page, appName);
        }
    });
});
