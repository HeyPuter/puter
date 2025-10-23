import { expect, test } from '@playwright/test';
import { testConfig } from '../config/test-config';

test('puter.auth.whoami', async ({ page }) => {
    if ( !testConfig.auth_token ) {
        throw new Error('authToken is required in client-config.yaml');
    }

    page.on('pageerror', (err) => console.error('[pageerror]', err));
    page.on('console', (msg) => console.log('[browser]', msg.text()));

    // 1) Open any page served by your backend to establish same-origin
    await page.goto(testConfig.frontend_url); // even a 404 page is fine; origin is set

    // 2) Load the real bundle from the same origin
    await page.addScriptTag({ url: '/puter.js/v2' });

    // 3) Wait for global
    await page.waitForFunction(() => Boolean((window as any).puter), null, { timeout: 10000 });

    // 4) Call whoami in the browser context
    const result = await page.evaluate(async (testConfig) => {
        const puter = (window as any).puter;

        await puter.setAPIOrigin(testConfig.api_url);
        await puter.setAuthToken(testConfig.auth_token);

        return await puter.auth.whoami();
    }, testConfig);

    expect(result?.username).toBe(testConfig.username);

    const result2 = await page.evaluate(async () => {
        const puter = (window as any).puter;
        return await puter.auth.whoami();
    });

    expect(result2?.username).toBe(testConfig.username);
});

test('connect to prod puter', async ({ page }) => {
    page.on('pageerror', (err) => console.error('[pageerror]', err));
    page.on('console', (msg) => console.log('[browser]', msg.text()));

    const prodURL = 'https://puter.com';

    // Go to production URL
    await page.goto(prodURL);

    // Wait for 5 seconds then exit
    await page.waitForTimeout(5000);
});
