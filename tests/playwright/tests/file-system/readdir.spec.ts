import { expect } from '@playwright/test';
import { BASE_PATH, test } from './fixtures';

test('readdir test', async ({ page }) => {
    // Create test directory
    const testDir = `${BASE_PATH}/test_readdir`;
    
    await page.evaluate(async ({ testDir }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.mkdir(testDir, { overwrite: true });
        } catch (error) {
            console.error('mkdir error:', error);
            throw error;
        }
    }, { testDir });

    // Create files
    const files = ['a.txt', 'b.txt', 'c.txt'];
    const dirs = ['q', 'w', 'e'];

    for (const file of files) {
        await page.evaluate(async ({ testDir, file }) => {
            const puter = (window as any).puter;
            try {
                await puter.fs.write(`${testDir}/${file}`, 'readdir test\n', { overwrite: true });
            } catch (error) {
                console.error(`write error for ${file}:`, error);
                throw error;
            }
        }, { testDir, file });
    }

    // Create directories
    for (const dir of dirs) {
        await page.evaluate(async ({ testDir, dir }) => {
            const puter = (window as any).puter;
            try {
                await puter.fs.mkdir(`${testDir}/${dir}`, { overwrite: true });
            } catch (error) {
                console.error(`mkdir error for ${dir}:`, error);
                throw error;
            }
        }, { testDir, dir });
    }

    // Verify files
    for (const file of files) {
        const result = await page.evaluate(async ({ testDir, file }) => {
            const puter = (window as any).puter;
            try {
                const result = await puter.fs.stat(`${testDir}/${file}`);
                return result;
            } catch (error) {
                console.error(`stat error for ${file}:`, error);
                return null;
            }
        }, { testDir, file });

        expect(result).toBeTruthy();
        expect(result.name).toBe(file);
        expect(result.is_dir).toBe(false);
    }

    // Verify directories
    for (const dir of dirs) {
        const result = await page.evaluate(async ({ testDir, dir }) => {
            const puter = (window as any).puter;
            try {
                const result = await puter.fs.stat(`${testDir}/${dir}`);
                return result;
            } catch (error) {
                console.error(`stat error for ${dir}:`, error);
                return null;
            }
        }, { testDir, dir });

        expect(result).toBeTruthy();
        expect(result.name).toBe(dir);
        expect(result.is_dir).toBe(true);
    }
});

test('readdir of root shouldn\'t return everything', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const puter = (window as any).puter;
        try {
            const result = await puter.fs.readdir('/', { recursive: true });
            console.log('result?', result);
            return result;
        } catch (error) {
            console.error('readdir error:', error);
            return null;
        }
    });
    
    console.log('result?', result);
});

