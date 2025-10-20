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

    await page.evaluate(({ api_url, auth_token }) => {
        const puter = (window as any).puter;
        return (async () => {
            console.log('[xiaochen-debug] puter.setAPIOrigin', api_url);
            console.log('[xiaochen-debug] puter.setAuthToken', auth_token);

            await puter.setAPIOrigin(api_url);
            await puter.setAuthToken(auth_token);

            console.log('[xiaochen-debug] puter.fs.setAPIOrigin', api_url);
            console.log('[xiaochen-debug] puter.fs.setAuthToken', auth_token);

            await puter.fs.setAPIOrigin(api_url);
            await puter.fs.setAuthToken(auth_token);

            // sleep 10 seconds
            await new Promise(resolve => setTimeout(resolve, 10_000));

            console.log('[xiaochen-debug] puter.fs.replica.available, point 1', puter.fs.replica.available);
        })();
    }, { api_url: testConfig.api_url, auth_token: testConfig.auth_token });

    // // Wait for replica to be available.
    // await page.waitForFunction(() => {
    //     const puter = (window as any).puter;

    //     console.log('[xiaochen-debug] puter.fs.replica.available, point 2 ', puter?.fs?.replica?.available);

    //     return puter?.fs?.replica?.available === true;
    // }, null, { timeout: 10_000 });
}

test('multi-session - mkdir', async ({ browser }) => {
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
    const entries = await pageB.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter;
        return await puter.fs.readdir(testPath);
    }, { testPath });

    expect(entries.some((e: any) => e.name === dirName)).toBe(true);

    await Promise.all([ctxA.close(), ctxB.close()]);
});
