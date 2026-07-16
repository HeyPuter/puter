import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    setupPuterTestEnv,
    type PuterTestEnv,
} from '@heyputer/backend/testUtil.ts';
import type { IConfig } from '@heyputer/backend/types.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bundleHarnessEntry } from '../harness/bundleHarnessEntry.ts';
import { loadPuterJsTestOptions } from '../harness/capabilities.ts';
import {
    coverageEnabled,
    writeCoverageShard,
    type IstanbulCoverage,
} from '../harness/coverage.ts';
import { listTests, skipReason, type RunTestArgs } from '../harness/executor.ts';
import type { EnvManifest, RunTestResult } from '../harness/types.ts';

const FIXTURE_PATH = '/__puterjs_suites__/fixture.html';

const options = loadPuterJsTestOptions();

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
        env = await setupPuterTestEnv(options.configOverrides as IConfig);
        manifest = {
            origin: env.origin,
            apiOrigin: env.apiOrigin,
            users: env.users,
            capabilities: options.capabilities,
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
        // In coverage mode the server would serve whichever bundle flavor
        // it finds (puter.dev.js wins when present) — pin the page to the
        // instrumented build instead.
        if (coverageEnabled()) {
            const instrumented = readFileSync(
                fileURLToPath(
                    new URL('../../../dist/puter.js', import.meta.url),
                ),
                'utf8',
            );
            await page.route('**/puter.js/v2', (route) =>
                route.fulfill({
                    contentType: 'application/javascript',
                    body: instrumented,
                }),
            );
        }
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
        if (coverageEnabled() && page) {
            const coverage = await page.evaluate(
                () =>
                    (window as { __coverage__?: IstanbulCoverage })
                        .__coverage__,
            );
            await writeCoverageShard('browser', [coverage]);
        }
        await browser?.close();
        await env?.shutdown();
    });

    for (const test of listTests()) {
        const skip = skipReason(test, 'browser', options.capabilities);
        it.skipIf(skip)(`${test.suiteName} > ${test.testName}`, async () => {
            const result = await page.evaluate<RunTestResult, RunTestArgs>(
                (args) => window.__runSuiteTest__(args),
                {
                    suiteName: test.suiteName,
                    testName: test.testName,
                    env: manifest,
                    platform: 'browser',
                },
            );
            expect(result.error ?? '').toBe('');
            expect(result.ok).toBe(true);
        });
    }
});
