import { test, expect } from '@playwright/test'
import { PuterPath } from '../../../src/backend/src/filesystem/lib/PuterPath'

test('puter.auth.whoami() should return username = admin', async ({ page }) => {
    const backendBase = 'http://puter.localhost:4100'

    page.on('pageerror', (err) => console.error('[pageerror]', err))
    page.on('console', (msg) => console.log('[browser]', msg.text()))

    // 1) Open any page served by your backend to establish same-origin
    await page.goto(backendBase) // even a 404 page is fine; origin is set

    // 2) Load the real bundle from the same origin
    await page.addScriptTag({ url: '/puter.js/v2' })

    // 3) Wait for global
    await page.waitForFunction(() => Boolean((window as any).puter), null, { timeout: 10000 })

    // 4) Call whoami in the browser context
    const result = await page.evaluate(async () => {
        const puter = (window as any).puter

        const auth_token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0IjoicyIsInYiOiIwLjAuMCIsInUiOiJYZW1BNmV3YVM3aTZkZkZoWDh0QktnPT0iLCJ1dSI6Iko2YnYxVVQrU2w2aEhCMFpYOEh4bWc9PSIsImlhdCI6MTc1ODA0NDQzMX0.4mNXPckWlQO4du2olLD8ylyRDmmUpAjyY0zIb6YwHYw'

        await puter.setAPIOrigin('http://api.puter.localhost:4100')
        await puter.setAuthToken(auth_token)

        return await puter.auth.whoami()
    })

    expect(result?.username).toBe('admin')
})
