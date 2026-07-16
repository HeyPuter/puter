import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    setupPuterTestEnv,
    type PuterTestEnv,
} from '@heyputer/backend/testUtil.ts';
import type { IConfig } from '@heyputer/backend/types.ts';
import { bundleHarnessEntry } from '../harness/bundleHarnessEntry.ts';
import { loadPuterJsTestOptions } from '../harness/capabilities.ts';
import {
    coverageEnabled,
    writeCoverageShard,
    type IstanbulCoverage,
} from '../harness/coverage.ts';
import { listTests, skipReason, type RunTestArgs } from '../harness/executor.ts';
import { loadNodePuter } from '../harness/nodeSdkLoader.ts';
import type { EnvManifest, RunTestResult } from '../harness/types.ts';

const WORKER_NAME = 'puterjs-suites';

const options = loadPuterJsTestOptions();

// Counters ride along on every /run response (the workerd isolate can
// recycle mid-run); merged into one shard after the run.
const workerdCoverage: IstanbulCoverage[] = [];

// The shared puter.js suites running inside local workerd. The suite
// bundle is deployed through the real workers pipeline (SDK
// `workers.create` → WorkerDriver → LocalWorkerService), and each test is
// dispatched over HTTP through the local worker proxy at
// `<name>.workers.puter.localhost`, exactly like a production Puter worker.
describe('puter.js API suites (workerd)', () => {
    let env: PuterTestEnv;
    let manifest: EnvManifest;
    let workerUrl: string;

    beforeAll(async () => {
        // `loadPuterJsTestOptions` routes worker deploys to the local
        // workerd (anything truthy without ACCOUNTID does).
        env = await setupPuterTestEnv(options.configOverrides as IConfig);
        manifest = {
            origin: env.origin,
            apiOrigin: env.apiOrigin,
            users: env.users,
            capabilities: options.capabilities,
        };

        const bundle = await bundleHarnessEntry(
            new URL('../harness/workerdEntry.ts', import.meta.url),
        );

        // Deploy through the SDK as the regular user — same flow as a real
        // `puter.workers.create` from an app.
        const puter = loadNodePuter(manifest, manifest.users.user.token);
        const sourcePath = `/${manifest.users.user.username}/suite-worker.js`;
        await puter.fs.write(sourcePath, bundle);
        await puter.workers.create(WORKER_NAME, sourcePath);

        const port = new URL(env.apiOrigin).port;
        workerUrl = `http://${WORKER_NAME}.workers.puter.localhost:${port}/run`;
    }, 120_000);

    afterAll(async () => {
        if (coverageEnabled()) {
            await writeCoverageShard('workerd', workerdCoverage);
        }
        await env?.shutdown();
    });

    for (const test of listTests()) {
        const skip = skipReason(test, 'workerd', options.capabilities);
        it.skipIf(skip)(`${test.suiteName} > ${test.testName}`, async () => {
            const args: RunTestArgs = {
                suiteName: test.suiteName,
                testName: test.testName,
                env: manifest,
                platform: 'workerd',
            };
            const res = await fetch(workerUrl, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'puter-auth': manifest.users.user.token,
                },
                body: JSON.stringify(args),
            });
            const text = await res.text();
            if (res.status !== 200) {
                throw new Error(`worker returned ${res.status}: ${text}`);
            }
            const result = JSON.parse(text) as RunTestResult;
            if (result.coverage) {
                workerdCoverage.push(result.coverage);
            }
            expect(result.error ?? '').toBe('');
            expect(result.ok).toBe(true);
        });
    }
});
