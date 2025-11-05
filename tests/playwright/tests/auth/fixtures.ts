import { test as base, expect, Page } from '@playwright/test';
import { testConfig } from '../../config/test-config';

/**
 * Helper function to log in a page with the test account.
 * This is used internally by fixtures to avoid code duplication.
 */
async function loginPage(page: Page): Promise<void> {
    page.on('pageerror', (e) => console.error('[pageerror]', e));
    page.on('console', (m) => console.log('[browser]', m.text()));

    await page.goto(testConfig.frontend_url);
    await page.waitForFunction(() => Boolean((window as any).puter), null, { timeout: 10_000 });

    // Wait until a temporary user is created.
    // 
    // Q: Why we have to wait the completion of this step?
    // A: Since this action triggers a `puter.setAuthToken` call and may
    // conflict with the user profile used for test.
    await expect
        .poll(async () => {
            return await page.evaluate(async () => {
                const puter = (window as any).puter;
                return await puter.auth.whoami();
            });
        }, { timeout: 10_000, intervals: [1000] })
        .toBeTruthy();

    // Wait for the side effects of "temporary user creation", otherwise
    // it may overwrite our test logic.
    await new Promise(resolve => setTimeout(resolve, 3000));

    // switch to the test account
    await page.evaluate(async ({ api_url, auth_token }) => {
        const puter = (window as any).puter;
        await puter.setAPIOrigin(api_url);
        await puter.setAuthToken(auth_token);
        return;
    }, { api_url: testConfig.api_url, auth_token: testConfig.auth_token });

    // verify we are logged in
    const whoami = await page.evaluate(async () => {
        const puter = (window as any).puter;
        return await puter.auth.whoami();
    });
    expect(whoami?.username).toBe(testConfig.username);
}

/**
 * Logged-in Playwright test instance.
 *
 * This fixture ensures the user is authenticated before each test.
 * It extends the base Playwright `test` with a pre-logged-in `page`
 * so tests can directly access authenticated routes or APIs.
 *
 * Example:
 * ```ts
 * loggedIn('example test', async ({ page }) => {
 *     const result = await page.evaluate(async () => {
 *         const puter = (window as any).puter;
 *         return await puter.auth.whoami();
 *     });
 * });
 * ```
 */
export const loggedIn = base.extend<{ page: Page }>({
    page: async ({ page }, use) => {
        await loginPage(page);

        const debug = false;
        if (debug) {
            // check whoami every 1 second, for 10 seconds
            for (let i = 0; i < 10; i++) {
                const whoami = await page.evaluate(async () => {
                    const puter = (window as any).puter;
                    return await puter.auth.whoami();
                });
                console.log(`checking whoami ${i}, username: ${whoami?.username}`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        await use(page);
    },
});

/**
 * Two pages logged-in Playwright test instance.
 *
 * This fixture ensures both pages are authenticated as the same user before each test.
 * It extends the base Playwright `test` with two pre-logged-in pages (`page1` and `page2`)
 * so tests can directly access authenticated routes or APIs from both pages.
 *
 * Example:
 * ```ts
 * twoPagesLoggedIn('example test', async ({ page1, page2 }) => {
 *     const result1 = await page1.evaluate(async () => {
 *         const puter = (window as any).puter;
 *         return await puter.auth.whoami();
 *     });
 *     const result2 = await page2.evaluate(async () => {
 *         const puter = (window as any).puter;
 *         return await puter.auth.whoami();
 *     });
 *     // Both result1 and result2 should have the same username
 * });
 * ```
 */
export const twoPagesLoggedIn = base.extend<{ page1: Page; page2: Page }>({
    page1: async ({ browser }, use) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        
        await loginPage(page);
        
        await use(page);
        
        await context.close();
    },
    page2: async ({ browser }, use) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        
        await loginPage(page);
        
        await use(page);
        
        await context.close();
    },
});
