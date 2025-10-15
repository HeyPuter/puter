import { expect, test } from '@playwright/test'
import { testConfig } from '../config/test-config'

type ReplicaTestResult = {
    local_read: number
    remote_read: number
}

async function bootstrap(page: import('@playwright/test').Page) {
    page.on('pageerror', (e) => console.error('[pageerror]', e))
    page.on('console', (m) => console.log('[browser]', m.text()))

    await page.goto(testConfig.frontend_url)              // establish origin
    await page.addScriptTag({ url: '/puter.js/v2' })      // load bundle
    await page.waitForFunction(() => Boolean((window as any).puter), null, { timeout: 10_000 })

    await page.evaluate(({ api_url, auth_token }) => {
        const puter = (window as any).puter
        return (async () => {
            await puter.setAPIOrigin(api_url)
            await puter.setAuthToken(auth_token)
        })()
    }, { api_url: testConfig.api_url, auth_token: testConfig.auth_token })

    // Wait for replica to be available
    await page.waitForFunction(() => {
        const puter = (window as any).puter
        return puter?.fs?.replica?.available === true
    }, null, { timeout: 10_000 })
}

test('multi-session: mkdir in A, then readdir in B', async ({ browser }) => {
    // Create two isolated sessions
    const ctxA = await browser.newContext()
    const ctxB = await browser.newContext()
    const pageA = await ctxA.newPage()
    const pageB = await ctxB.newPage()

    await Promise.all([bootstrap(pageA), bootstrap(pageB)])

    // in Node side
    await ctxA.addCookies([{ name: 'session_probe', value: 'A', url: testConfig.frontend_url }])

    const cookiesA = await ctxA.cookies()
    const cookiesB = await ctxB.cookies()
    expect(cookiesA.some(c => c.name === 'session_probe' && c.value === 'A')).toBe(true)
    expect(cookiesB.some(c => c.name === 'session_probe')).toBe(false)

    // Paths
    const testPath = `/${testConfig.username}/Desktop`
    const dirName = `_test_dir_${Date.now()}`
    const dirPath = `${testPath}/${dirName}`

    console.log(`[xiaochen-debug] dirPath: ${dirPath}`)

    // --- Session A: perform the action (mkdir) ---
    await pageA.evaluate(async ({ dirPath }) => {
        const puter = (window as any).puter
        await puter.fs.mkdir(dirPath)
    }, { dirPath })

    // --- Session B: observe AFTER mkdir ---
    // Simple sleep and check approach
    const startTime = Date.now()
    console.log(`[xiaochen-debug] Starting sleep and check at ${new Date().toISOString()}`)

    // Sleep for a fixed duration
    await pageB.waitForTimeout(10000) // 5 seconds

    // Check if directory exists
    const entries = await pageB.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter
        return await puter.fs.readdir(testPath)
    }, { testPath })

    for (const entry of entries) {
        console.log(`[xiaochen-debug] path during check: ${entry.path}`)
    }

    const match = entries.find((e: any) => e.name === dirName)
    if (match) {
        console.log(`[xiaochen-debug] ✅ Found new directory:`, match)
    } else {
        console.log(`[xiaochen-debug] ❌ Directory not found after sleep`)
    }

    const endTime = Date.now()
    const duration = endTime - startTime
    console.log(`[xiaochen-debug] sleep and check completed in ${duration}ms (${(duration / 1000).toFixed(2)}s)`)

    // Read stats from B (optional, but useful)
    const statsB: ReplicaTestResult = await pageB.evaluate(({ testPath }) => {
        const puter = (window as any).puter
        return (async () => {
            await puter.fs.readdir(testPath)
            return {
                local_read: puter.fs.replica.local_read,
                remote_read: puter.fs.replica.remote_read,
            } as ReplicaTestResult
        })()
    }, { testPath })

    // --- Assertions ---
    // 1) B sees the directory (ensured by waitForFunction); add a direct check:
    const bEntries = await pageB.evaluate(async ({ testPath }) => {
        const puter = (window as any).puter
        return await puter.fs.readdir(testPath)
    }, { testPath })

    for (const entry of bEntries) {
        const path = entry.path
        console.log(`[xiaochen-debug] path: ${path}`)
    }

    expect(bEntries.some((e: any) => e.name === dirName)).toBe(true)

    // 2) Optional: observe that B likely performed at least one remote read
    // (tune this to your replica semantics)
    expect(statsB.remote_read).toEqual(0)

    await Promise.all([ctxA.close(), ctxB.close()])
})
