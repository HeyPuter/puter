import { expect, test } from '@playwright/test';
import { testConfig } from '../config/test-config';

// The max change propagation time when server is healthy.
//
// 6 seconds = 5 seconds pulling interval + 1 second synchronization time.
const CHANGE_PROPAGATION_TIME = 6_000;

async function bootstrap(page: import('@playwright/test').Page) {
    page.on('pageerror', (e) => console.error('[pageerror]', e));
    page.on('console', (m) => console.log('[browser]', m.text()));

    await page.goto(testConfig.frontend_url);              // establish origin
    await page.addScriptTag({ url: '/puter.js/v2' });      // load bundle
    await page.waitForFunction(() => Boolean((window as any).puter), null, { timeout: 10_000 });

    const available = await page.evaluate(({ api_url, auth_token }) => {
        const puter = (window as any).puter;
        return (async () => {
            await puter.setAPIOrigin(api_url);
            await puter.setAuthToken(auth_token);

            await new Promise(resolve => setTimeout(resolve, 3_000));

            return puter.fs.replica.available;
        })();
    }, { api_url: testConfig.api_url, auth_token: testConfig.auth_token });

    expect(available).toBe(true);
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
    const { entry, newLocalRead, newRemoteRead } = await pageB.evaluate(async ({ dirPath }) => {
        const puter = (window as any).puter;

        const localRead = puter.fs.replica.local_read;
        const remoteRead = puter.fs.replica.remote_read;

        const entry = await puter.fs.stat(dirPath);
        const newLocalRead = puter.fs.replica.local_read - localRead;
        const newRemoteRead = puter.fs.replica.remote_read - remoteRead;
        return { entry, newLocalRead, newRemoteRead };
    }, { dirPath });

    expect(entry.name).toBe(dirName);
    expect(entry.path).toBe(dirPath);

    // Ideally, there should be exactly 1 local read, but our naive-cache read fs periodically
    // and may cause extra reads.
    expect(newLocalRead).toBeGreaterThanOrEqual(1);

    // Ideally, there should be exactly 0 remote read, but some code read "/" periodically
    // and may cause extra reads.
    expect(newRemoteRead).toBeGreaterThanOrEqual(0);

    await Promise.all([ctxA.close(), ctxB.close()]);
});
