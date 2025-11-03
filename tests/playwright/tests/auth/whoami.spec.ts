import { expect } from '@playwright/test';
import { testConfig } from '../../config/test-config';
import { loggedIn } from './fixtures';

loggedIn('puter.auth.whoami', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const puter = (window as any).puter;
        return await puter.auth.whoami();
    });

    expect(result?.username).toBe(testConfig.username);
});
