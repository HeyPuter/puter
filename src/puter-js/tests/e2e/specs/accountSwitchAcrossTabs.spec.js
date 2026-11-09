import { test, expect } from '@playwright/test';
import { waitForPuterReady } from '../helpers/testApp.js';

/**
 * Every tab shares one stored session, so switching accounts in one tab hands
 * the others a token for a different account. A tab that kept running would
 * show its old account's desktop while its requests acted as the new one.
 */
test.describe('an account switch in another tab', () => {
    test('reloads this tab as the new account instead of adopting its token', async ({ browser, context, page }) => {
        // A second account: what a first-time visitor is given.
        const visitorContext = await browser.newContext({
            storageState: { cookies: [], origins: [] },
        });
        const visitorPage = await visitorContext.newPage();
        await visitorPage.goto('/');
        await waitForPuterReady(visitorPage);
        const other = await visitorPage.evaluate(() => ({
            token: localStorage.getItem('auth_token_v2'),
            user: JSON.parse(localStorage.getItem('user')),
        }));
        await visitorContext.close();

        const switchingTab = page;
        const otherTab = await context.newPage();
        for ( const tab of [switchingTab, otherTab] ) {
            await tab.goto('/');
            await waitForPuterReady(tab);
        }
        const firstUser = await otherTab.evaluate(() => window.user.uuid);
        expect(firstUser).not.toBe(other.user.uuid);

        // Record what this tab holds once it has handled the new token.
        // Session storage outlives the reload; `__beforeSwitch` doesn't.
        await otherTab.evaluate(() => {
            window.__beforeSwitch = true;
            window.addEventListener('storage', (event) => {
                if ( event.key !== 'auth_token_v2' || !event.newValue ) return;
                sessionStorage.setItem('seenOnSwitch', JSON.stringify({
                    adopted: window.auth_token === event.newValue,
                    user: window.user?.uuid,
                }));
            });
        });

        await switchingTab.evaluate(
            ({ token, user }) => window.update_auth_data(token, user),
            other,
        );

        await otherTab.waitForFunction(
            (uuid) => !window.__beforeSwitch && window.user?.uuid === uuid,
            other.user.uuid,
            { timeout: 60_000 },
        );
        await waitForPuterReady(otherTab);
        expect(
            await otherTab.evaluate(() => JSON.parse(sessionStorage.getItem('seenOnSwitch'))),
        ).toEqual({ adopted: false, user: firstUser });

        // Booting renews the token for the same account, which the tab that
        // switched picks up without reloading.
        await expect.poll(() => switchingTab.evaluate(() => ({
            user: window.user?.uuid,
            current: window.auth_token === localStorage.getItem('auth_token_v2'),
        }))).toEqual({ user: other.user.uuid, current: true });
    });
});
