import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    setupPuterTestEnv,
    type PuterTestEnv,
} from '@heyputer/backend/testUtil.ts';
import type { IConfig } from '@heyputer/backend/types.ts';
import { loadPuterJsTestOptions } from '../harness/capabilities.ts';
import { coverageEnabled, writeCoverageShard } from '../harness/coverage.ts';
import { listTests, runTest, skipReason } from '../harness/executor.ts';
import { collectNodeCoverage, loadNodePuter } from '../harness/nodeSdkLoader.ts';
import type { EnvManifest } from '../harness/types.ts';

const options = loadPuterJsTestOptions();

// The shared puter.js suites running under node.js: the built SDK bundle
// is loaded into a vm context (like `src/init.cjs`) against an in-memory
// server on a real port.
describe('puter.js API suites (node)', () => {
    let env: PuterTestEnv;
    let manifest: EnvManifest;

    beforeAll(async () => {
        env = await setupPuterTestEnv(options.configOverrides as IConfig);
        manifest = {
            origin: env.origin,
            apiOrigin: env.apiOrigin,
            users: env.users,
            capabilities: options.capabilities,
        };
    }, 120_000);

    afterAll(async () => {
        if (coverageEnabled()) {
            await writeCoverageShard('node', collectNodeCoverage());
        }
        await env?.shutdown();
    });

    for (const test of listTests()) {
        const skip = skipReason(test, 'node', options.capabilities);
        it.skipIf(skip)(`${test.suiteName} > ${test.testName}`, async () => {
            const puter = loadNodePuter(manifest, manifest.users.user.token);
            const result = await runTest(
                {
                    suiteName: test.suiteName,
                    testName: test.testName,
                    env: manifest,
                    platform: 'node',
                },
                puter,
            );
            expect(result.error ?? '').toBe('');
            expect(result.ok).toBe(true);
        });
    }
});
