import { test as base, expect, Page } from '@playwright/test';
import { validate as isValidUUID } from 'uuid';
import { FSEntry } from '../../../../src/backend/src/filesystem/definitions/ts/fsentry';
import { testConfig } from '../../config/test-config';

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

export const test = base.extend<{ page: Page }>({
    page: async ({ browser }, use) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await bootstrap(page);

        await page.evaluate(async ({ BASE_PATH }) => {
            const puter = (window as any).puter;

            try {
                await puter.fs.delete(BASE_PATH, { recursive: true });
            } catch( error ) {
                // ignore error
                console.error('delete error:', error);
            }

            try {
                await puter.fs.mkdir(BASE_PATH);
            } catch( error ) {
                console.error('mkdir error:', error);
                throw error;
            }
        }, { BASE_PATH });

        await use(page);
    },
});

// Check the integrity of the FSEntry object.
function checkIntegrity(entry: FSEntry): string | null {
    // check essential fields
    if ( !entry.uid || !isValidUUID(entry.uid) ) {
        return `Invalid UID: ${entry.uid}`;
    }
    if ( !entry.name || entry.name.trim() === '' ) {
        return `Invalid name: ${entry.name}`;
    }
    if ( !entry.path || entry.path.trim() === '' ) {
        return `Invalid path: ${entry.path}`;
    }
    if ( !entry.parent_id || !isValidUUID(entry.parent_id) ) {
        return `Invalid parent_id: ${entry.parent_id}`;
    }
    if ( entry.size < 0 ) {
        return `Invalid size: ${entry.size}`;
    }
    if ( typeof entry.is_dir !== 'boolean' ) {
        return `Invalid is_dir type: ${typeof entry.is_dir}`;
    }
    return null;
}

async function bootstrap(page: Page) {
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

base('change-propagation - mkdir', async ({ browser }) => {
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

    const integrityError = checkIntegrity(entry);
    expect(integrityError).toBeNull();

    await Promise.all([ctxA.close(), ctxB.close()]);
});
