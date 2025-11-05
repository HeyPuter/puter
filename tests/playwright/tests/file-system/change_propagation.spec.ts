import { expect } from '@playwright/test';
import { validate as isValidUUID } from 'uuid';
import { FSEntry } from '../../../../src/backend/src/filesystem/definitions/ts/fsentry';
import { testConfig } from '../../config/test-config';
import { twoPagesLoggedIn } from '../auth/fixtures';
import { CHANGE_PROPAGATION_TIME } from './fixtures';

// Check the integrity of the FSEntry object.
function checkIntegrity(entry: FSEntry): string | null {
    // check essential fields
    if (!entry.uid || !isValidUUID(entry.uid)) {
        return `Invalid UID: ${entry.uid}`;
    }
    if (!entry.name || entry.name.trim() === '') {
        return `Invalid name: ${entry.name}`;
    }
    if (!entry.path || entry.path.trim() === '') {
        return `Invalid path: ${entry.path}`;
    }
    if (!entry.parent_id || !isValidUUID(entry.parent_id)) {
        return `Invalid parent_id: ${entry.parent_id}`;
    }
    if (entry.size < 0) {
        return `Invalid size: ${entry.size}`;
    }
    if (typeof entry.is_dir !== 'boolean') {
        return `Invalid is_dir type: ${typeof entry.is_dir}`;
    }
    return null;
}

twoPagesLoggedIn('change-propagation - mkdir', async ({ page1, page2 }) => {
    // Paths
    const testPath = `/${testConfig.username}/Desktop`;
    const dirName = `_test_dir_${Date.now()}`;
    const dirPath = `${testPath}/${dirName}`;

    // --- Session A (page1): perform the action (mkdir) ---
    await page1.evaluate(async ({ dirPath }) => {
        const puter = (window as any).puter;
        await puter.fs.mkdir(dirPath);
    }, { dirPath });

    // Wait for change to be propagated.
    await page2.waitForTimeout(CHANGE_PROPAGATION_TIME);

    // --- Session B (page2): observe AFTER mkdir ---
    const { entry }: { entry: FSEntry } = await page2.evaluate(async ({ dirPath }) => {
        const puter = (window as any).puter;

        const entry = await puter.fs.stat(dirPath);
        return { entry };
    }, { dirPath });

    // Print the complete FSEntry object
    console.log('FSEntry object:', JSON.stringify(entry, null, 2));

    const integrityError = checkIntegrity(entry);
    expect(integrityError).toBeNull();
});

