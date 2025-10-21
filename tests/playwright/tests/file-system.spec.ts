import { expect, test } from '@playwright/test';
import { FSEntry } from '../../../src/backend/src/filesystem/definitions/ts/fsentry';
import { testConfig } from '../config/test-config';

// The maximum time needed for file-system change to be propagated from
// one session to others.
const CHANGE_PROPAGATION_TIME = 0;

async function bootstrap(page: import('@playwright/test').Page) {
    page.on('pageerror', (e) => console.error('[pageerror]', e));
    page.on('console', (m) => console.log('[browser]', m.text()));

    await page.goto(testConfig.frontend_url);              // establish origin
    await page.addScriptTag({ url: '/puter.js/v2' });      // load bundle
    await page.waitForFunction(() => Boolean((window as any).puter), null, { timeout: 10_000 });

    await page.evaluate(async ({ api_url, auth_token }) => {
        const puter = (window as any).puter;
        await puter.setAPIOrigin(api_url);
        await puter.setAuthToken(auth_token);
        return;
    }, { api_url: testConfig.api_url, auth_token: testConfig.auth_token });

}

test('change-propagation - mkdir', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await Promise.all([bootstrap(pageA), bootstrap(pageB)]);

    // Paths
    const testPath = `/${testConfig.username}/Desktop`;
    const dirName = `_test_dir_${Date.now()}`;
    const dirPath = `${testPath}/${dirName}`;

    // --- Session A: perform the action (mkdir) ---
    await pageA.evaluate(async ({ dirPath }) => {
        const puter = (window as any).puter;
        await puter.fs.mkdir(dirPath);
    }, { dirPath });

    // Wait for change to be propagated.
    await pageB.waitForTimeout(CHANGE_PROPAGATION_TIME);

    // --- Session B: observe AFTER mkdir ---
    const { entry }: { entry: FSEntry } = await pageB.evaluate(async ({ dirPath }) => {
        const puter = (window as any).puter;

        const entry = await puter.fs.stat(dirPath);
        return { entry };
    }, { dirPath });

    // Print the complete FSEntry object
    console.log('FSEntry object:', JSON.stringify(entry, null, 2));

    expect(entry.name).toBe(dirName);
    expect(entry.path).toBe(dirPath);

    await Promise.all([ctxA.close(), ctxB.close()]);
});
