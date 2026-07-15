import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    setupPuterTestEnv,
    type PuterTestEnv,
} from '@heyputer/backend/testUtil.ts';
import { bundleHarnessEntry } from '../harness/bundleHarnessEntry.ts';
import { listTests, type RunTestArgs } from '../harness/executor.ts';
import { loadNodePuter } from '../harness/nodeSdkLoader.ts';
import type { EnvManifest, RunTestResult } from '../harness/types.ts';

const WORKER_NAME = 'puterjs-suites';

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
        env = await setupPuterTestEnv({
            // Anything truthy (without ACCOUNTID) routes worker deploys to
            // the local workerd instead of the remote workers backend.
            workers: { localServer: 'true' },
        } as never);
        manifest = {
            origin: env.origin,
            apiOrigin: env.apiOrigin,
            users: env.users,
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
        await env?.shutdown();
    });

    for (const { suiteName, testName } of listTests()) {
        it(`${suiteName} > ${testName}`, async () => {
            const args: RunTestArgs = {
                suiteName,
                testName,
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
            expect(result.error ?? '').toBe('');
            expect(result.ok).toBe(true);
        });
    }
});
