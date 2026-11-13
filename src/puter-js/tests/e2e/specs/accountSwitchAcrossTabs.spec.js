import { test, expect } from '@playwright/test';
import { createVisitorAccount, waitForPuterReady } from '../helpers/testApp.js';

// A second account: what a first-time visitor is given. Created once for the
// whole file, because sign-ups are rate limited.
let visitor;
const visitorAccount = (browser) => (visitor ??= createVisitorAccount(browser));

/**
 * Every tab shares one stored session, so switching accounts in one tab hands
 * the others a token for a different account. A tab that kept running would
 * show its old account's desktop while its requests acted as the new one.
 */
test.describe('an account switch in another tab', () => {
    test('reloads this tab as the new account instead of adopting its token', async ({ browser, context, page }) => {
        const other = await visitorAccount(browser);

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

    test('reloads this tab only once the session cookie names the new account', async ({ browser, context, page }) => {
        const other = await visitorAccount(browser);

        const switchingTab = page;
        const otherTab = await context.newPage();
        for ( const tab of [switchingTab, otherTab] ) {
            await tab.goto('/');
            await waitForPuterReady(tab);
        }

        // A tab signs in from the cookie when it boots, so one that reloaded
        // while the cookie still named the first account would stay on it.
        await context.route('**/session/sync-cookie', async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await route.continue();
        });
        await otherTab.evaluate(() => {
            window.__beforeSwitch = true;
        });

        await switchingTab.evaluate(
            ({ token, user }) => window.update_auth_data(token, user),
            other,
        );

        await otherTab.waitForFunction(
            (uuid) => !window.__beforeSwitch && window.user?.uuid === uuid,
            other.user.uuid,
            { timeout: 30_000 },
        );
        await waitForPuterReady(otherTab);
        await expect.poll(() => switchingTab.evaluate(() => ({
            user: window.user?.uuid,
            current: window.auth_token === localStorage.getItem('auth_token_v2'),
            storedFor: JSON.parse(localStorage.getItem('user')).uuid,
        }))).toEqual({ user: other.user.uuid, current: true, storedFor: other.user.uuid });
    });
});

test.describe('a token another tab stores during an account switch', () => {
    test('does not replace the token of the account being switched to', async ({ browser, context, page }) => {
        const other = await visitorAccount(browser);

        const switchingTab = page;
        const otherTab = await context.newPage();
        for ( const tab of [switchingTab, otherTab] ) {
            await tab.goto('/');
            await waitForPuterReady(tab);
        }
        const firstToken = await switchingTab.evaluate(() => window.auth_token);

        let releaseSync;
        const syncHeld = new Promise((resolve) => {
            releaseSync = resolve;
        });
        await context.route('**/session/sync-cookie', async (route) => {
            await syncHeld;
            await route.continue();
        });

        const switched = switchingTab.evaluate(
            ({ token, user }) => window.update_auth_data(token, user),
            other,
        );

        // Booting renews the first account's token while the switch waits.
        // A token issued in the same second as the stored one is identical.
        await otherTab.waitForTimeout(1100);
        await otherTab.reload();
        await expect.poll(() => switchingTab.evaluate(
            () => localStorage.getItem('auth_token_v2'),
        )).not.toBe(firstToken);

        releaseSync();
        await switched;

        expect(await switchingTab.evaluate(() => ({
            token: window.auth_token,
            saved: window.logged_in_users.find((known) => known.uuid === window.user.uuid).auth_token,
        }))).toEqual({ token: other.token, saved: other.token });
    });
});
