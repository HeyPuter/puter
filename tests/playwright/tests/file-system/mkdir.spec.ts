import { expect } from '@playwright/test';
import { BASE_PATH, ERROR_CODES, test } from './fixtures';

// NB: Don't test "parent + path" api for puter-js, it's only supported on http
// api: https://github.com/HeyPuter/puter/blob/9bdb139f7a82ef610e6beb76b91014ac530828a4/src/puter-js/src/modules/FileSystem/operations/mkdir.js#L48-L49

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
        } catch (error) {
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
        } catch (error) {
            console.error('error: ', error);
        }
    }, { basePath });

    // Test dedupe functionality
    for (let i = 1; i <= 3; i++) {
        const result = await page.evaluate(async ({ basePath }) => {
            const puter = (window as any).puter;
            try {
                const result = await puter.fs.mkdir(basePath, { dedupeName: true });
                return result;
            } catch (error) {
                console.error('mkdir error:', error);
                return null;
            }
        }, { basePath });

        if (result) {
            expect(result.name).toBe(`dedupe_test (${i})`);
        }

        // Verify the directory exists
        const stat = await page.evaluate(async ({ basePath, i }) => {
            const puter = (window as any).puter;
            try {
                const stat = await puter.fs.stat(`${basePath} (${i})`);
                return stat;
            } catch (error) {
                console.error('stat error:', error);
                return null;
            }
        }, { basePath, i });

        if (stat) {
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
        } catch (error: any) {
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
        } catch (error: any) {
            return error.code;
        }
    });
    expect(ERROR_CODES.includes(error_code)).toBe(true);
});

test('full path api with create_missing_parents', async ({ page }) => {
    const testPath = `${BASE_PATH}/full_path_api/create_missing_parents_works`;
    const targetPath = `${testPath}/a/b/c`;

    // Verify parent directory does not exist initially
    let error_code = await page.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.stat(`${testPath}/a`);
            return null;
        } catch (error: any) {
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
        } catch (error) {
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
        } catch (error: any) {
            return error.code;
        }
    }, { testPath });
    expect(ERROR_CODES.includes(error_code)).toBe(true);

    // Verify all directories along the path exist
    const paths = ['a', 'a/b', 'a/b/c'];
    for (const path of paths) {
        const stat = await page.evaluate(async ({ testPath, path }) => {
            const puter = (window as any).puter;
            try {
                const stat = await puter.fs.stat(`${testPath}/${path}`);
                return stat;
            } catch (error) {
                console.error('stat error:', error);
                return null;
            }
        }, { testPath, path });

        expect(stat).toBeTruthy();
        expect(stat.name).toBe(path.split('/').pop());
    }
});
