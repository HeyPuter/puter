import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    setupPuterTestEnv,
    type PuterTestEnv,
} from '@heyputer/backend/testUtil.ts';
import { bundleHarnessEntry } from '../harness/bundleHarnessEntry.ts';
import { listTests, type RunTestArgs } from '../harness/executor.ts';
import type { EnvManifest, RunTestResult } from '../harness/types.ts';

const FIXTURE_PATH = '/__puterjs_suites__/fixture.html';

// The shared puter.js suites running in a real (headless)
// browser via playwright. The fixture page is fulfilled via route
// interception *on the API origin itself*, so the SDK runs same-origin
// exactly like a page served by the server; the SDK bundle comes from the
// server's own /puter.js/v2 route.
describe('puter.js API suites (browser)', () => {
    let env: PuterTestEnv;
    let manifest: EnvManifest;
    let browser: Browser;
    let page: Page;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
        manifest = {
            origin: env.origin,
            apiOrigin: env.apiOrigin,
            users: env.users,
        };

        const bundle = await bundleHarnessEntry(
            new URL('../harness/browserEntry.ts', import.meta.url),
        );
        const fixtureHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>puter.js suite fixture</title>
<script>
window.PUTER_API_ORIGIN = ${JSON.stringify(env.apiOrigin)};
window.PUTER_ORIGIN = ${JSON.stringify(env.origin)};
</script>
<script src="/puter.js/v2"></script>
<script>${bundle}</script>
</head>
<body></body>
</html>`;

        browser = await chromium.launch({
            args: [
                // Chromium gates cross-origin requests to loopback targets
                // behind Local/Private Network Access checks, which are
                // auto-denied in headless — and the signed-upload flow PUTs
                // straight to the in-memory S3 on 127.0.0.1.
                '--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessChecks,BlockInsecurePrivateNetworkRequests',
            ],
        });
        page = await browser.newPage();
        // Surface network-level failures (DNS, CORS, blocked requests) —
        // inside the page they all collapse into opaque "network error"s.
        page.on('requestfailed', (req) => {
            console.log(
                `[browser] request failed: ${req.method()} ${req.url()} — ${req.failure()?.errorText}`,
            );
        });
        await page.route(`**${FIXTURE_PATH}`, (route) =>
            route.fulfill({ contentType: 'text/html', body: fixtureHtml }),
        );
        await page.goto(`${env.apiOrigin}${FIXTURE_PATH}`);
        await page.waitForFunction(
            () =>
                Boolean(
                    (window as { __runSuiteTest__?: unknown })
                        .__runSuiteTest__,
                ),
            null,
            { timeout: 30_000 },
        );
    }, 120_000);

    afterAll(async () => {
        await browser?.close();
        await env?.shutdown();
    });

    for (const { suiteName, testName } of listTests()) {
        it(`${suiteName} > ${testName}`, async () => {
            const result = await page.evaluate<RunTestResult, RunTestArgs>(
                (args) => window.__runSuiteTest__(args),
                { suiteName, testName, env: manifest, platform: 'browser' },
            );
            expect(result.error ?? '').toBe('');
            expect(result.ok).toBe(true);
        });
    }
});
