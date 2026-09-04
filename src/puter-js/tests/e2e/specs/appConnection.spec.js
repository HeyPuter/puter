import { test, expect } from '@playwright/test';
import { registerTestApp, deleteTestApp, gotoTestApp, FIXTURE_URL } from '../helpers/testApp.js';

const APP_CONNECTION_FIXTURE_URL = FIXTURE_URL.replace(
    'menubar-contextmenu.html',
    'app-connection.html',
);

test.describe('AppConnection.postMessage transferables (env=app)', () => {
    test('a transferred buffer reaches the other app and back', async ({ page }) => {
        const appName = await registerTestApp(page, { fixtureURL: APP_CONNECTION_FIXTURE_URL });
        try {
            await gotoTestApp(page, appName);
            // The parent's window is the first one open; the child it launches
            // renders the same fixture in a second iframe.
            const parentFrame = page.frameLocator('iframe.window-app-iframe').first();

            await parentFrame.locator('#send-transferable').click();

            const log = parentFrame.locator('#log');
            // The desktop relays between the two apps, so a buffer that was
            // transferred rather than copied only survives if every hop keeps
            // transferring it.
            await expect(log.locator('[data-entry="child-received:ArrayBuffer[1,2,3,4]"]'))
                .toBeVisible({ timeout: 30_000 });
            await expect(log.locator('[data-entry="parent-received:ArrayBuffer[9,8,7,6]"]'))
                .toBeVisible();
            // Transferred, not copied: the sender no longer holds the buffer.
            await expect(log.locator('[data-entry="sent:detached:true"]')).toBeVisible();
            // A port survives the relay as a working channel, not a dead copy.
            await expect(log.locator('[data-entry="port-message:hello over the port"]'))
                .toBeVisible();
        } finally {
            await deleteTestApp(page, appName);
        }
    });
});
