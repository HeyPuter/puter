import { expect, Page } from '@playwright/test';
import { test, BASE_PATH, CHANGE_PROPAGATION_TIME } from './fixtures';
import { testConfig } from '../../config/test-config';

/**
 * Wait until a path no longer exists in the filesystem.
 */
async function waitUntilFSDeleted(page: Page, path: string, timeout = 4000): Promise<void> {
    await page.waitForFunction(
        async (targetPath: string) => {
            const puter = (window as any).puter;
            try {
                await puter.fs.stat(targetPath);
                return false; // still exists
            } catch {
                return true; // deleted
            }
        },
        path,
        { timeout }
    );
}

test('worker auto-delete removes trashed file (UI + FS)', async ({ page }) => {

    // ---- 1. Construct paths ----
    const fileName = `auto_${Date.now()}.txt`;
    const originalPath = `${BASE_PATH}/${fileName}`;
    const trashDir = `/${testConfig.username}/Trash`;
    const trashPath = `${trashDir}/${fileName}`;

    // ---- 2. Create test file ----
    await page.evaluate(async ({ originalPath }) => {
        const puter = (window as any).puter;
        await puter.fs.write(originalPath, 'hello-world\n');
    }, { originalPath });

    // Confirm it exists
    const before = await page.evaluate(async ({ originalPath }) => {
        const puter = (window as any).puter;
        return await puter.fs.stat(originalPath);
    }, { originalPath });

    expect(before).toBeTruthy();

    // ---- 3. Move file to Trash ----
    await page.evaluate(async ({ originalPath, trashPath }) => {
        const puter = (window as any).puter;
        await puter.fs.move(originalPath, trashPath);
    }, { originalPath, trashPath });

    // ---- 4. Ensure window.socket exists + join correct user room ----
    await page.evaluate(async ({ api_url, auth_token, username }) => {
        const win = window as any;

        if (!win.io) {
            throw new Error("Socket.IO client ('io') is not available in the window.");
        }

        // Create socket if missing
        if (!win.socket) {
            win.socket = win.io(api_url, {
                transports: ["websocket"],
                auth: { token: auth_token }
            });
        }

        // Worker sends to { room: user.id }, Puter UI rooms use username
        win.socket.emit("join", username);
    }, {
        api_url: testConfig.api_url,
        auth_token: testConfig.auth_token,
        username: testConfig.username,
    });

    // ---- 5. Simulate worker event ----
    await page.evaluate(async ({ fileName, trashPath }) => {
        const socket = (window as any).socket;
        if (!socket) throw new Error("window.socket is not initialized");

        socket.emit("trash.auto_delete", {
            uuid: fileName,
            path: trashPath
        });
    }, { fileName, trashPath });

    // ---- 6. Allow UI + FS to process deletion ----
    await page.waitForTimeout(CHANGE_PROPAGATION_TIME + 300);

    // ---- 7. FS must delete the file ----
    await waitUntilFSDeleted(page, trashPath);

    const after = await page.evaluate(async ({ trashPath }) => {
        const puter = (window as any).puter;
        try {
            await puter.fs.stat(trashPath);
            return { exists: true };
        } catch (e: any) {
            return { exists: false, code: e.code };
        }
    }, { trashPath });

    expect(after.exists).toBe(false);
    expect(after.code).toBe('subject_does_not_exist');

    // ---- 9. UI DOM element must also be gone ----
    const el = page.locator(`.item[data-path="${trashPath}"]`);
    await expect(el).toHaveCount(0);
});