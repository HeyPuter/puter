import { expect } from '@playwright/test';
import { BASE_PATH, test } from './fixtures';

test('delete for normal file', async ({ page }) => {
    const testPath = `${BASE_PATH}/delete_test_1`;
    const testFile = `${testPath}/test_delete.txt`;

    await page.evaluate(async ({ testPath, testFile }) => {
        const puter = (window as any).puter;
        await puter.fs.mkdir(testPath);
        await puter.fs.write(testFile, 'delete test\n');
    }, { testPath, testFile });

    await page.evaluate(async ({ testFile }) => {
        const puter = (window as any).puter;
        await puter.fs.delete(testFile);
    }, { testFile });

    let threw = false;
    const result = await page.evaluate(async ({ testFile }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.stat(testFile);
            return { exists: true };
        } catch (e) {
            return { exists: false, error: (e as any).code || (e as any).message };
        }
    }, { testFile });

    expect(result.exists).toBe(false);
});

test('error for non-existing file', async ({ page }) => {
    const testPath = `${BASE_PATH}/delete_test_2`;
    const testFile = `${testPath}/test_delete.txt`;

    await page.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter;
        await puter.fs.mkdir(testPath);
    }, { testPath });

    let threw = false;
    const result = await page.evaluate(async ({ testFile }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.delete(testFile);
            return { success: true };
        } catch (e) {
            return { success: false, error: (e as any).code || (e as any).message };
        }
    }, { testFile });

    expect(result.success).toBe(false);
});

test('delete for directory', async ({ page }) => {
    const testPath = `${BASE_PATH}/delete_test_3`;
    const testDir = `${testPath}/test_delete_dir`;

    await page.evaluate(async ({ testPath, testDir }) => {
        const puter = (window as any).puter;
        await puter.fs.mkdir(testPath);
        await puter.fs.mkdir(testDir);
    }, { testPath, testDir });

    await page.evaluate(async ({ testDir }) => {
        const puter = (window as any).puter;
        await puter.fs.delete(testDir);
    }, { testDir });

    const result = await page.evaluate(async ({ testDir }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.stat(testDir);
            return { exists: true };
        } catch (e) {
            return { exists: false, error: (e as any).code || (e as any).message };
        }
    }, { testDir });

    expect(result.exists).toBe(false);
});

test('delete for non-empty directory with recursive=true', async ({ page }) => {
    const testPath = `${BASE_PATH}/delete_test_5`;
    const testDir = `${testPath}/test_delete_dir`;
    const testFile = `${testDir}/test.txt`;

    await page.evaluate(async ({ testPath, testDir, testFile }) => {
        const puter = (window as any).puter;
        await puter.fs.mkdir(testPath);
        await puter.fs.mkdir(testDir);
        await puter.fs.write(testFile, 'delete test\n');
    }, { testPath, testDir, testFile });

    await page.evaluate(async ({ testDir }) => {
        const puter = (window as any).puter;
        await puter.fs.delete(testDir, { recursive: true });
    }, { testDir });

    // Wait for deletion to complete
    await page.waitForTimeout(500);

    const result = await page.evaluate(async ({ testDir }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.stat(testDir);
            return { exists: true };
        } catch (e) {
            return { exists: false, error: (e as any).code || (e as any).message };
        }
    }, { testDir });

    expect(result.exists).toBe(false);
});
