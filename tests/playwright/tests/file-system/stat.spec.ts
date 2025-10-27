import { expect } from '@playwright/test';
import { BASE_PATH, test } from './fixtures';

test('stat with path (no flags)', async ({ page }) => {
    const TEST_FILENAME = 'test_stat.txt';
    const testPath = `${BASE_PATH}/${TEST_FILENAME}`;

    // Write the test file
    await page.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.write(testPath, 'stat test\n', { overwrite: true });
        } catch (error) {
            console.error('write error:', error);
            throw error;
        }
    }, { testPath });

    // Stat the file
    const result = await page.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter;
        try {
            const result = await puter.fs.stat(testPath);
            return result;
        } catch (error) {
            console.error('stat error:', error);
            return null;
        }
    }, { testPath });

    expect(result).toBeTruthy();
    expect(result.name).toBe('test_stat.txt');
    expect(result.is_dir).toBe(false);
    expect(result.uid).toBeDefined();
});

test('stat with uid', async ({ page }) => {
    const TEST_FILENAME = 'test_stat.txt';
    const testPath = `${BASE_PATH}/${TEST_FILENAME}`;

    // Write the test file
    await page.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.write(testPath, 'stat test\n', { overwrite: true });
        } catch (error) {
            console.error('write error:', error);
            throw error;
        }
    }, { testPath });

    // Get uid from first stat
    const firstStat = await page.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter;
        try {
            const result = await puter.fs.stat(testPath);
            return result;
        } catch (error) {
            console.error('stat error:', error);
            return null;
        }
    }, { testPath });

    const uid = firstStat.uid;

    // Stat using uid
    const result = await page.evaluate(async ({ uid }) => {
        const puter = (window as any).puter;
        try {
            const result = await puter.fs.stat(uid);
            return result;
        } catch (error) {
            console.error('statu error:', error);
            return null;
        }
    }, { uid });

    expect(result).toBeTruthy();
    expect(result.name).toBe('test_stat.txt');
    expect(result.uid).toBe(uid);
});

test('stat with no path or uid provided fails', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const puter = (window as any).puter;
        try {
            const result = await puter.fs.stat('');
            return { success: true, result };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    expect(result.success).toBe(false);
});

test('stat with versions', async ({ page }) => {
    const TEST_FILENAME = 'test_stat.txt';
    const testPath = `${BASE_PATH}/${TEST_FILENAME}`;

    // Write the test file
    await page.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.write(testPath, 'stat test\n', { overwrite: true });
        } catch (error) {
            console.error('write error:', error);
            throw error;
        }
    }, { testPath });

    // Stat with returnVersions flag
    const result = await page.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter;
        try {
            console.log('STAT WITH VERSIONS', testPath);
            const result = await puter.fs.stat({
                path: testPath,
                returnVersions: true,
            });
            return result;
        } catch (error) {
            console.error('stat error:', error);
            return null;
        }
    }, { testPath });

    expect(result).toBeTruthy();
    expect(result.name).toBe('test_stat.txt');
    console.log('RESULT', result);
    expect(Array.isArray(result.versions)).toBe(true);
});

test('stat with shares', async ({ page }) => {
    const TEST_FILENAME = 'test_stat.txt';
    const testPath = `${BASE_PATH}/${TEST_FILENAME}`;

    // Write the test file
    await page.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.write(testPath, 'stat test\n', { overwrite: true });
        } catch (error) {
            console.error('write error:', error);
            throw error;
        }
    }, { testPath });

    // Stat with returnPermissions flag (returns shares info)
    const result = await page.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter;
        try {
            const result = await puter.fs.stat({
                path: testPath,
                returnPermissions: true,
            });
            return result;
        } catch (error) {
            console.error('stat error:', error);
            return null;
        }
    }, { testPath });

    expect(result).toBeTruthy();
    expect(result.name).toBe('test_stat.txt');
    // returnPermissions returns shares info
    expect('shares' in result).toBe(true);
    expect(Array.isArray(result.shares.users)).toBe(true);
    expect(Array.isArray(result.shares.apps)).toBe(true);
});

test('stat with subdomains', async ({ page }) => {
    const dirName = 'test_stat_subdomains';
    const testPath = `${BASE_PATH}/${dirName}`;

    // Create directory
    await page.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.mkdir(testPath, { overwrite: true });
        } catch (error) {
            console.error('mkdir error:', error);
            throw error;
        }
    }, { testPath });

    // Stat with returnSubdomains flag
    const result = await page.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter;
        try {
            const result = await puter.fs.stat({
                path: testPath,
                returnSubdomains: true,
            });
            return result;
        } catch (error) {
            console.error('stat error:', error);
            return null;
        }
    }, { testPath });

    expect(result).toBeTruthy();
    expect(result.name).toBe('test_stat_subdomains');
    expect(Array.isArray(result.subdomains)).toBe(true);
    console.log('RESULT', result);
});

test('stat with size', async ({ page }) => {
    const TEST_FILENAME = 'test_stat.txt';
    const testPath = `${BASE_PATH}/${TEST_FILENAME}`;

    // Write the test file
    await page.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.write(testPath, 'stat test\n', { overwrite: true });
        } catch (error) {
            console.error('write error:', error);
            throw error;
        }
    }, { testPath });

    // Stat with returnSize flag
    const result = await page.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter;
        try {
            const result = await puter.fs.stat({
                path: testPath,
                returnSize: true,
            });
            return result;
        } catch (error) {
            console.error('stat error:', error);
            return null;
        }
    }, { testPath });

    expect(result).toBeTruthy();
    expect(result.name).toBe('test_stat.txt');
    console.log('RESULT', result);
});

