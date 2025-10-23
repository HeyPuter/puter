import { test as base, expect, Page } from '@playwright/test';
import { validate as isValidUUID } from 'uuid';
import { FSEntry } from '../../../src/backend/src/filesystem/definitions/ts/fsentry';
import { testConfig } from '../config/test-config';

// The maximum time needed for file-system change to be propagated from
// one session to others.
const CHANGE_PROPAGATION_TIME = 0;

const BASE_PATH = '/admin/tests';

const ERROR_CODES = [
    'forbidden',
    'dest_does_not_exist',
    'subject_does_not_exist',
];

const test = base.extend<{ page: Page }>({
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

test('recursive mkdir', async ({ page }) => {
    // Test recursive mkdir with create_missing_parents
    const path = `${BASE_PATH}/a/b/c/d/e/f/g`;
    const result = await page.evaluate(async ({ path }) => {
        const puter = (window as any).puter;
        try {
            const result = await puter.fs.mkdir(path, {
                createMissingParents: true,
            });
            console.log('mkdir result?', result);
            return result;
        } catch( error ) {
            console.error('error?', error);
            return null;
        }
    }, { path });

    console.log('result?', result);
});

test('mkdir dedupe name', async ({ page }) => {
    const basePath = `${BASE_PATH}/dedupe_test`;

    // Create initial directory
    await page.evaluate(async ({ basePath }) => {
        const puter = (window as any).puter;

        try {
            await puter.fs.mkdir(basePath);
        } catch( error ) {
            console.error('error: ', error);
        }
    }, { basePath });

    // Test dedupe functionality
    for ( let i = 1; i <= 3; i++ ) {
        const result = await page.evaluate(async ({ basePath }) => {
            const puter = (window as any).puter;
            try {
                const result = await puter.fs.mkdir(basePath, { dedupeName: true });
                return result;
            } catch( error ) {
                console.error('mkdir error:', error);
                return null;
            }
        }, { basePath });

        if ( result ) {
            expect(result.name).toBe(`dedupe_test (${i})`);
        }

        // Verify the directory exists
        const stat = await page.evaluate(async ({ basePath, i }) => {
            const puter = (window as any).puter;
            try {
                const stat = await puter.fs.stat(`${basePath} (${i})`);
                return stat;
            } catch( error ) {
                console.error('stat error:', error);
                return null;
            }
        }, { basePath, i });

        if ( stat ) {
            expect(stat.name).toBe(`dedupe_test (${i})`);
        }
    }
});

test('mkdir in root directory is prohibited', async ({ page }) => {
    // Test full path format
    let error_code = await page.evaluate(async () => {
        const puter = (window as any).puter;
        try {
            await puter.fs.mkdir('/a');
            return null;
        } catch( error: any ) {
            return error.code;
        }
    });
    expect(ERROR_CODES.includes(error_code)).toBe(true);

    // Test parent + path format
    error_code = await page.evaluate(async () => {
        const puter = (window as any).puter;
        try {
            await puter.fs.mkdir('a', { parent: '/' });
            return null;
        } catch( error: any ) {
            return error.code;
        }
    });
    expect(ERROR_CODES.includes(error_code)).toBe(true);
});

// NB: Don't test "parent + path" api for puter-js, it's only supported on http
// api: https://github.com/HeyPuter/puter/blob/9bdb139f7a82ef610e6beb76b91014ac530828a4/src/puter-js/src/modules/FileSystem/operations/mkdir.js#L48-L49
test('full path api with create_missing_parents', async ({ page }) => {
    const testPath = `${BASE_PATH}/full_path_api/create_missing_parents_works`;
    const targetPath = `${testPath}/a/b/c`;

    // Verify parent directory does not exist initially
    let error_code = await page.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.stat(`${testPath}/a`);
            return null;
        } catch( error: any ) {
            console.error('stat error:', error);
            return error.code;
        }
    }, { testPath });
    expect(ERROR_CODES.includes(error_code)).toBe(true);

    // Test mkdir with create_missing_parents
    const result = await page.evaluate(async ({ targetPath }) => {
        const puter = (window as any).puter;
        try {
            const result = await puter.fs.mkdir(targetPath, {
                createMissingParents: true,
            });
            return result;
        } catch( error ) {
            console.error('mkdir error:', error);
            return null;
        }
    }, { targetPath });

    expect(result).toBeTruthy();
    expect(result.name).toBe('c');

    // Test mkdir without create_missing_parents should fail
    error_code = await page.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.mkdir(`${testPath}/x/y/z`);
            return null;
        } catch( error: any ) {
            return error.code;
        }
    }, { testPath });
    expect(ERROR_CODES.includes(error_code)).toBe(true);

    // Verify all directories along the path exist
    const paths = ['a', 'a/b', 'a/b/c'];
    for ( const path of paths ) {
        const stat = await page.evaluate(async ({ testPath, path }) => {
            const puter = (window as any).puter;
            try {
                const stat = await puter.fs.stat(`${testPath}/${path}`);
                return stat;
            } catch( error ) {
                console.error('stat error:', error);
                return null;
            }
        }, { testPath, path });

        expect(stat).toBeTruthy();
        expect(stat.name).toBe(path.split('/').pop());
    }
});
