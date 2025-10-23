import { expect } from '@playwright/test';
import { BASE_PATH, ERROR_CODES, test } from './fixtures';

test('move file', async ({ page }) => {
    const sourceFile = `${BASE_PATH}/just_a_file.txt`;
    const targetFile = `${BASE_PATH}/just_a_file_moved.txt`;

    // Create source file
    await page.evaluate(async ({ sourceFile }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.write(sourceFile, 'move test\n');
        } catch (error) {
            console.error('write error:', error);
        }
    }, { sourceFile });

    // Move the file
    const result = await page.evaluate(async ({ sourceFile, targetFile }) => {
        const puter = (window as any).puter;
        try {
            const result = await puter.fs.move(sourceFile, targetFile);
            return result;
        } catch (error) {
            console.error('move error:', error);
            return null;
        }
    }, { sourceFile, targetFile });

    expect(result).toBeTruthy();

    // Verify target file exists
    const movedStat = await page.evaluate(async ({ targetFile }) => {
        const puter = (window as any).puter;
        try {
            const stat = await puter.fs.stat(targetFile);
            return stat;
        } catch (error) {
            console.error('stat error:', error);
            return null;
        }
    }, { targetFile });

    expect(movedStat).toBeTruthy();
    expect(movedStat.name).toBe('just_a_file_moved.txt');

    // Verify source file no longer exists
    const sourceError = await page.evaluate(async ({ sourceFile }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.stat(sourceFile);
            return null;
        } catch (error: any) {
            return error.code;
        }
    }, { sourceFile });

    expect(ERROR_CODES.includes(sourceError)).toBe(true);
});

test('move file to existing file', async ({ page }) => {
    const sourceFile = `${BASE_PATH}/just_a_file.txt`;
    const targetFile = `${BASE_PATH}/dir_with_contents/a.txt`;

    // Setup: create source file and target file
    await page.evaluate(async ({ sourceFile, targetFile }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.mkdir(`${BASE_PATH}/dir_with_contents`);
            await puter.fs.write(sourceFile, 'move test\n');
            await puter.fs.write(targetFile, 'existing content\n');
        } catch (error) {
            console.error('setup error:', error);
        }
    }, { sourceFile, targetFile });

    // Attempt to move file to existing file (should fail)
    const errorCode = await page.evaluate(async ({ sourceFile, targetFile }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.move(sourceFile, targetFile);
            return null;
        } catch (error: any) {
            return error.code;
        }
    }, { sourceFile, targetFile });

    expect(ERROR_CODES.includes(errorCode), `unexpected error code: ${errorCode}`).toBe(true);
});

test('move directory', async ({ page }) => {
    const sourceDir = `${BASE_PATH}/dir_no_contents`;
    const targetDir = `${BASE_PATH}/dir_no_contents_moved`;

    // Create source directory
    await page.evaluate(async ({ sourceDir }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.mkdir(sourceDir);
        } catch (error) {
            console.error('mkdir error:', error);
        }
    }, { sourceDir });

    // Move the directory
    const result = await page.evaluate(async ({ sourceDir, targetDir }) => {
        const puter = (window as any).puter;
        try {
            const result = await puter.fs.move(sourceDir, targetDir);
            return result;
        } catch (error) {
            console.error('move error:', error);
            return null;
        }
    }, { sourceDir, targetDir });

    expect(result).toBeTruthy();

    // Verify target directory exists
    const movedStat = await page.evaluate(async ({ targetDir }) => {
        const puter = (window as any).puter;
        try {
            const stat = await puter.fs.stat(targetDir);
            return stat;
        } catch (error) {
            console.error('stat error:', error);
            return null;
        }
    }, { targetDir });

    expect(movedStat).toBeTruthy();
    expect(movedStat.name).toBe('dir_no_contents_moved');

    // Verify source directory no longer exists
    const sourceError = await page.evaluate(async ({ sourceDir }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.stat(sourceDir);
            return null;
        } catch (error: any) {
            return error.code;
        }
    }, { sourceDir });

    expect(ERROR_CODES.includes(sourceError)).toBe(true);
});

test('move file and create parents', async ({ page }) => {
    const sourceFile = `${BASE_PATH}/just_a_file.txt`;
    const targetFile = `${BASE_PATH}/dir_with_contents/q/w/e/just_a_file.txt`;

    // Setup: create source file and parent directories
    await page.evaluate(async ({ BASE_PATH, sourceFile }) => {
        const puter = (window as any).puter;
        await puter.fs.mkdir(`${BASE_PATH}/dir_with_contents`);
        await puter.fs.mkdir(`${BASE_PATH}/dir_with_contents/q`);
        await puter.fs.mkdir(`${BASE_PATH}/dir_with_contents/w`);
        await puter.fs.write(sourceFile, 'move test\n');
    }, { BASE_PATH, sourceFile });

    // Move file with create_missing_parents
    const result = await page.evaluate(async ({ sourceFile, targetFile }) => {
        const puter = (window as any).puter;
        try {
            const result = await puter.fs.move(sourceFile, targetFile, {
                createMissingParents: true,
            });
            return result;
        } catch (error) {
            console.error('move error:', error);
            return null;
        }
    }, { sourceFile, targetFile });

    expect(result).toBeTruthy();
    expect(result.parent_dirs_created.length).toBe(2);

    // Verify target file exists
    const movedStat = await page.evaluate(async ({ targetFile }) => {
        const puter = (window as any).puter;
        try {
            const stat = await puter.fs.stat(targetFile);
            return stat;
        } catch (error) {
            console.error('stat error:', error);
            return null;
        }
    }, { targetFile });

    expect(movedStat).toBeTruthy();
    expect(movedStat.name).toBe('just_a_file.txt');

    // Verify source file no longer exists
    const sourceError = await page.evaluate(async ({ sourceFile }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.stat(sourceFile);
            return null;
        } catch (error: any) {
            return error.code;
        }
    }, { sourceFile });

    expect(ERROR_CODES.includes(sourceError)).toBe(true);
});
