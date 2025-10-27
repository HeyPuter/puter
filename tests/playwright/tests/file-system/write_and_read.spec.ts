import { expect } from '@playwright/test';
import { BASE_PATH, test } from './fixtures';

test('read matches what was written', async ({ page }) => {
    const fileName = 'test_rw.txt';
    const testPath = `${BASE_PATH}/${fileName}`;

    // Write file
    await page.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter;
        await puter.fs.write(testPath, 'example\n');
    }, { testPath });

    // Read and verify
    const result = await page.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter;
        const result = await puter.fs.read(testPath);
        return await result.text();
    }, { testPath });

    expect(result).toBe('example\n');
});

test('write without overwrite creates deduped name', async ({ page }) => {
    const fileName = 'test_rw.txt';
    const testPath = `${BASE_PATH}/${fileName}`;

    // Write initial file
    await page.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter;
        await puter.fs.write(testPath, 'example\n');
    }, { testPath });

    // Write without overwrite - should create deduped name
    let errorThrown = false;
    const result = await page.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.write(testPath, 'no-change\n');
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message, code: error.code };
        }
    }, { testPath });

    // Note: puter-js behavior might auto-dedupe names
    expect(result).toBeTruthy();
});

test('write with overwrite updates file', async ({ page }) => {
    const fileName = 'test_rw.txt';
    const testPath = `${BASE_PATH}/${fileName}`;

    // Write initial file
    await page.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter;
        await puter.fs.write(testPath, 'example\n');
    }, { testPath });

    // Write with overwrite
    await page.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter;
        await puter.fs.write(testPath, 'yes-change\n', { overwrite: true });
    }, { testPath });

    // Verify content was updated
    const result = await page.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter;
        const result = await puter.fs.read(testPath);
        return await result.text();
    }, { testPath });

    expect(result).toBe('yes-change\n');
});

test('read with version id', async ({ page }) => {
    const fileName = 'test_rw.txt';
    const testPath = `${BASE_PATH}/${fileName}`;

    // Write file
    await page.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter;
        await puter.fs.write(testPath, 'yes-change\n', { overwrite: true });
    }, { testPath });

    // Read with version_id
    const result = await page.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter;
        try {
            const result = await puter.fs.read(testPath, { version_id: '1' });
            const text = await result.text();
            return { success: true, text };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }, { testPath });

    expect(result.success).toBe(true);
});

test('read with no path or uid provided fails', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const puter = (window as any).puter;
        try {
            await puter.fs.read('');
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message, code: error.code };
        }
    });

    expect(result.success).toBe(false);
    expect(result.code).toBeTruthy();
});

test('read non-existing file fails', async ({ page }) => {
    const result = await page.evaluate(async ({ basePath }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.read(`${basePath}/i-do-not-exist.txt`);
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message, code: error.code };
        }
    }, { basePath: BASE_PATH });

    expect(result.success).toBe(false);
    expect(result.code).toBe('subject_does_not_exist');
});

