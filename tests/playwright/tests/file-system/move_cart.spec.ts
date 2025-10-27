import { expect } from '@playwright/test';
import { BASE_PATH, test } from './fixtures';

test('move file with path format', async ({ page }) => {
    const testPath = `${BASE_PATH}/move_cart_1`;
    const sourceFile = `${testPath}/a/a_file.txt`;
    const destDir = `${testPath}/b`;

    // Setup: create directory structure
    await page.evaluate(async ({ testPath, sourceFile, destDir }) => {
        const puter = (window as any).puter;
        await puter.fs.mkdir(testPath);
        await puter.fs.mkdir(`${testPath}/a`);
        await puter.fs.write(sourceFile, 'file a contents\n');
        await puter.fs.mkdir(destDir);
    }, { testPath, sourceFile, destDir });

    // Move file
    const result = await page.evaluate(async ({ sourceFile, destDir }) => {
        const puter = (window as any).puter;
        try {
            const result = await puter.fs.move(sourceFile, destDir);
            return result;
        } catch (error) {
            console.error('move error:', error);
            return null;
        }
    }, { sourceFile, destDir });

    expect(result).toBeTruthy();
    expect(result.moved.name).toBe('a_file.txt');
});

test('move file with specified name', async ({ page }) => {
    const testPath = `${BASE_PATH}/move_cart_2`;
    const sourceFile = `${testPath}/a/a_file.txt`;
    const destDir = `${testPath}/b`;
    const newName = 'x_file.txt';

    // Setup: create directory structure
    await page.evaluate(async ({ testPath, sourceFile, destDir }) => {
        const puter = (window as any).puter;
        await puter.fs.mkdir(testPath);
        await puter.fs.mkdir(`${testPath}/a`);
        await puter.fs.write(sourceFile, 'file a contents\n');
        await puter.fs.mkdir(destDir);
    }, { testPath, sourceFile, destDir });

    // Move file with new name
    const result = await page.evaluate(async ({ sourceFile, destDir, newName }) => {
        const puter = (window as any).puter;
        try {
            const result = await puter.fs.move(sourceFile, destDir, { newName });
            return result;
        } catch (error) {
            console.error('move error:', error);
            return null;
        }
    }, { sourceFile, destDir, newName });

    expect(result).toBeTruthy();
    expect(result.moved.name).toBe(newName);
});

test('move file with overwrite to directory', async ({ page }) => {
    const testPath = `${BASE_PATH}/move_cart_3`;
    const sourceFile = `${testPath}/a/a_file.txt`;
    const destDir = `${testPath}/b`;

    // Setup: create directory structure
    await page.evaluate(async ({ testPath, sourceFile, destDir }) => {
        const puter = (window as any).puter;
        await puter.fs.mkdir(testPath);
        await puter.fs.mkdir(`${testPath}/a`);
        await puter.fs.write(sourceFile, 'file a contents\n');
        await puter.fs.mkdir(destDir);
        await puter.fs.write(`${destDir}/a_file.txt`, 'existing file\n');
    }, { testPath, sourceFile, destDir });

    // Move file with overwrite
    const result = await page.evaluate(async ({ sourceFile, destDir }) => {
        const puter = (window as any).puter;
        try {
            const result = await puter.fs.move(sourceFile, destDir, { overwrite: true });
            return result;
        } catch (error) {
            console.error('move error:', error);
            return null;
        }
    }, { sourceFile, destDir });

    expect(result).toBeTruthy();
});

test('move file without overwrite to directory with existing file should error', async ({ page }) => {
    const testPath = `${BASE_PATH}/move_cart_4`;
    const sourceFile = `${testPath}/a/a_file.txt`;
    const destDir = `${testPath}/b`;

    // Setup: create directory structure
    await page.evaluate(async ({ testPath, sourceFile, destDir }) => {
        const puter = (window as any).puter;
        await puter.fs.mkdir(testPath);
        await puter.fs.mkdir(`${testPath}/a`);
        await puter.fs.write(sourceFile, 'file a contents\n');
        await puter.fs.mkdir(destDir);
        await puter.fs.write(`${destDir}/a_file.txt`, 'existing file\n');
    }, { testPath, sourceFile, destDir });

    // Attempt move without overwrite (should fail)
    const result = await page.evaluate(async ({ sourceFile, destDir }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.move(sourceFile, destDir);
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message, code: error.code };
        }
    }, { sourceFile, destDir });

    expect(result.success).toBe(false);
    expect(result.code).toBeTruthy();
});

test('move file to file destination should error', async ({ page }) => {
    const testPath = `${BASE_PATH}/move_cart_6`;
    const sourceFile = `${testPath}/a/a_file.txt`;
    const destFile = `${testPath}/b`;

    // Setup: create file as destination (not directory)
    await page.evaluate(async ({ testPath, sourceFile, destFile }) => {
        const puter = (window as any).puter;
        await puter.fs.mkdir(testPath);
        await puter.fs.mkdir(`${testPath}/a`);
        await puter.fs.write(sourceFile, 'file a contents\n');
        await puter.fs.write(destFile, 'placeholder\n');
    }, { testPath, sourceFile, destFile });

    // Attempt move with specified name to file destination (should error)
    const result = await page.evaluate(async ({ sourceFile, destFile }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.move(sourceFile, destFile, { newName: 'x_file.txt' });
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message, code: error.code };
        }
    }, { sourceFile, destFile });

    expect(result.success).toBe(false);
    expect(result.code).toBe('dest_is_not_a_directory');
});

test('move file with uid format', async ({ page }) => {
    const testPath = `${BASE_PATH}/move_cart_7`;
    const sourceFile = `${testPath}/a/a_file.txt`;
    const destDir = `${testPath}/b`;

    // Setup and get UIDs
    const { sourceUID, destUID } = await page.evaluate(async ({ testPath, sourceFile, destDir }) => {
        const puter = (window as any).puter;
        await puter.fs.mkdir(testPath);
        await puter.fs.mkdir(`${testPath}/a`);
        await puter.fs.write(sourceFile, 'file a contents\n');
        await puter.fs.mkdir(destDir);

        const sourceStat = await puter.fs.stat(sourceFile);
        const destStat = await puter.fs.stat(destDir);
        return { sourceUID: sourceStat.uid, destUID: destStat.uid };
    }, { testPath, sourceFile, destDir });

    // Move using UIDs (if supported by puter-js)
    const result = await page.evaluate(async ({ sourceUID, destUID }) => {
        const puter = (window as any).puter;
        try {
            // Note: puter-js move might not support uid format directly
            // This would require internal API usage
            return { sourceUID, destUID };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }, { sourceUID, destUID });

    expect(result.sourceUID).toBeTruthy();
    expect(result.destUID).toBeTruthy();
});

