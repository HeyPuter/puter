import { expect } from '@playwright/test';
import { BASE_PATH, test } from './fixtures';

test('copy file with path format', async ({ page }) => {
    const testPath = `${BASE_PATH}/copy_cart_1`;
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

    // Copy file
    const result = await page.evaluate(async ({ sourceFile, destDir }) => {
        const puter = (window as any).puter;
        try {
            const result = await puter.fs.copy(sourceFile, destDir);
            return result;
        } catch (error) {
            console.error('copy error:', error);
            return null;
        }
    }, { sourceFile, destDir });

    console.log('result: ', result);

    expect(result[0]).toBeTruthy();
    expect(result[0].copied.name).toBe('a_file.txt');
});

test('copy file with specified name', async ({ page }) => {
    const testPath = `${BASE_PATH}/copy_cart_2`;
    const sourceFile = `${testPath}/a/a_file.txt`;
    const destDir = `${testPath}/b`;
    const newName = 'x_renamed';

    // Setup: create directory structure
    await page.evaluate(async ({ testPath, sourceFile, destDir }) => {
        const puter = (window as any).puter;
        await puter.fs.mkdir(testPath);
        await puter.fs.mkdir(`${testPath}/a`);
        await puter.fs.write(sourceFile, 'file a contents\n');
        await puter.fs.mkdir(destDir);
    }, { testPath, sourceFile, destDir });

    // Copy file with new name
    const result = await page.evaluate(async ({ sourceFile, destDir, newName }) => {
        const puter = (window as any).puter;
        try {
            const result = await puter.fs.copy(sourceFile, destDir, { newName });
            return result;
        } catch (error) {
            console.error('copy error:', error);
            return null;
        }
    }, { sourceFile, destDir, newName });

    expect(result).toBeTruthy();
    expect(result[0].copied.name).toBe(newName);
});

test('copy file with overwrite', async ({ page }) => {
    const testPath = `${BASE_PATH}/copy_cart_3`;
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

    // Copy file with overwrite
    const result = await page.evaluate(async ({ sourceFile, destDir }) => {
        const puter = (window as any).puter;
        try {
            const result = await puter.fs.copy(sourceFile, destDir, { overwrite: true });
            return result;
        } catch (error) {
            console.error('copy error:', error);
            return null;
        }
    }, { sourceFile, destDir });

    expect(result).toBeTruthy();
    expect(result[0]).toBeTruthy();
});

test('copy file without overwrite to directory with existing file should error', async ({ page }) => {
    const testPath = `${BASE_PATH}/copy_cart_4`;
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

    // Attempt copy without overwrite (should fail)
    const result = await page.evaluate(async ({ sourceFile, destDir }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.copy(sourceFile, destDir);
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message, code: error.code, entry_name: error.entry_name };
        }
    }, { sourceFile, destDir });

    expect(result.success).toBe(false);
    expect(result.code).toBeTruthy();
});

test('copy file to file destination should error', async ({ page }) => {
    const testPath = `${BASE_PATH}/copy_cart_6`;
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

    // Attempt copy with specified name to file destination (should error)
    const result = await page.evaluate(async ({ sourceFile, destFile }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.copy(sourceFile, destFile, { newName: 'x_renamed' });
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message, code: error.code };
        }
    }, { sourceFile, destFile });

    expect(result.success).toBe(false);
    expect(result.code).toBe('dest_is_not_a_directory');
});

test('copy empty directory', async ({ page }) => {
    const testPath = `${BASE_PATH}/copy_cart_7`;
    const sourceDir = `${testPath}/a/a_directory`;
    const destDir = `${testPath}/b`;

    // Setup: create empty directory
    await page.evaluate(async ({ testPath, sourceDir, destDir }) => {
        const puter = (window as any).puter;
        await puter.fs.mkdir(testPath);
        await puter.fs.mkdir(`${testPath}/a`);
        await puter.fs.mkdir(sourceDir);
        await puter.fs.mkdir(destDir);
    }, { testPath, sourceDir, destDir });

    // Copy directory
    const result = await page.evaluate(async ({ sourceDir, destDir }) => {
        const puter = (window as any).puter;
        try {
            const result = await puter.fs.copy(sourceDir, destDir);
            return result;
        } catch (error) {
            console.error('copy error:', error);
            return null;
        }
    }, { sourceDir, destDir });

    expect(result).toBeTruthy();
    expect(result[0].copied.name).toBe('a_directory');
});

test('copy full directory', async ({ page }) => {
    const testPath = `${BASE_PATH}/copy_cart_8`;
    const sourceDir = `${testPath}/a/a_directory`;
    const destDir = `${testPath}/b`;

    // Setup: create full directory with file, empty dir, and nested dir
    await page.evaluate(async ({ testPath, sourceDir, destDir }) => {
        const puter = (window as any).puter;
        await puter.fs.mkdir(testPath);
        await puter.fs.mkdir(`${testPath}/a`);
        await puter.fs.mkdir(sourceDir);
        await puter.fs.write(`${sourceDir}/a_file.txt`, 'file a contents\n');
        await puter.fs.mkdir(`${sourceDir}/b_directory`);
        await puter.fs.write(`${sourceDir}/b_directory/b_file.txt`, 'file b contents\n');
        await puter.fs.mkdir(`${sourceDir}/c_directory`);
        await puter.fs.mkdir(destDir);
    }, { testPath, sourceDir, destDir });

    // Copy directory
    const result = await page.evaluate(async ({ sourceDir, destDir }) => {
        const puter = (window as any).puter;
        try {
            const result = await puter.fs.copy(sourceDir, destDir);
            return result;
        } catch (error) {
            console.error('copy error:', error);
            return null;
        }
    }, { sourceDir, destDir });

    expect(result).toBeTruthy();
    expect(result[0].copied.name).toBe('a_directory');
    
    // Verify nested files were copied
    const nestedFile = await page.evaluate(async ({ destDir }) => {
        const puter = (window as any).puter;
        try {
            const result = await puter.fs.read(`${destDir}/a_directory/a_file.txt`);
            return result.text();
        } catch (error) {
            return null;
        }
    }, { destDir });

    expect(nestedFile).toBe('file a contents\n');
});
