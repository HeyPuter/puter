import { Page } from '@playwright/test';
import { loggedIn } from '../auth/fixtures';

// The maximum time needed for file-system change to be propagated from
// one session to others.
export const CHANGE_PROPAGATION_TIME = 0;

export const BASE_PATH = '/admin/tests';

export const ERROR_CODES = [
    'forbidden',
    'dest_does_not_exist',
    'subject_does_not_exist',
    'source_does_not_exist',
];

/**
 * A Playwright test fixture that ensures a clean test directory on the server.
 *
 * This fixture extends the {@link loggedIn} test, guaranteeing the user is already authenticated.
 * Before each test, it creates (or resets) the `/admin/tests` directory on the backend,
 * ensuring it exists and is completely empty.
 *
 * Use this when your test logic depends on a known-clean workspace for file-system operations.
 *
 * Example:
 * ```ts
 * testDirCleaned('demo test', async ({ page }) => {
 *   await page.evaluate(async () => {
 *     const puter = (window as any).puter;
 *     const result = await puter.fs.stat('/admin/tests');
 *     console.log('result:', result);
 *   });
 * });
 * ```
 */
export const testDirCleaned = loggedIn.extend<{ page: Page }>({
    page: async ({ page }, use) => {
        await page.evaluate(async ({ BASE_PATH }) => {
            const puter = (window as any).puter;

            try {
                await puter.fs.delete(BASE_PATH, { recursive: true });
            } catch (error) {
                // ignore error
                console.error('delete error:', error);
            }

            try {
                await puter.fs.mkdir(BASE_PATH);
            } catch (error) {
                console.error('mkdir error:', error);
                throw error;
            }
        }, { BASE_PATH });

        await use(page);
    },
});

