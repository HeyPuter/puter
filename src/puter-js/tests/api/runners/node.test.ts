import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    setupPuterTestEnv,
    type PuterTestEnv,
} from '@heyputer/backend/testUtil.ts';
import { listTests, runTest } from '../harness/executor.ts';
import { loadNodePuter } from '../harness/nodeSdkLoader.ts';
import type { EnvManifest } from '../harness/types.ts';

// The shared puter.js suites running under node.js: the built SDK bundle
// is loaded into a vm context (like `src/init.cjs`) against an in-memory
// server on a real port.
describe('puter.js API suites (node)', () => {
    let env: PuterTestEnv;
    let manifest: EnvManifest;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
        manifest = {
            origin: env.origin,
            apiOrigin: env.apiOrigin,
            users: env.users,
        };
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    for (const { suiteName, testName } of listTests()) {
        it(`${suiteName} > ${testName}`, async () => {
            const puter = loadNodePuter(manifest, manifest.users.user.token);
            const result = await runTest(
                { suiteName, testName, env: manifest, platform: 'node' },
                puter,
            );
            expect(result.error ?? '').toBe('');
            expect(result.ok).toBe(true);
        });
    }
});
