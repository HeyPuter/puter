import { runTest, type RunTestArgs } from './executor.ts';
import type { PuterSDK, RunTestResult } from './types.ts';

/**
 * Worker-side entry, esbuild-bundled and deployed as a real Puter worker by
 * the workerd runner. The preamble's router provides `event.user.puter` —
 * a per-request SDK instance authenticated from the `puter-auth` header and
 * pointed at the `puter_endpoint` binding (the test server) — so tests run
 * against the exact SDK setup production workers get.
 */
type RouterEvent = {
    request: Request;
    user?: { puter: PuterSDK };
};

declare const router: {
    custom(
        method: string,
        route: string,
        handler: (event: RouterEvent) => unknown,
    ): void;
};

router.custom('POST', '/run', async (event: RouterEvent): Promise<RunTestResult> => {
    const args = (await event.request.json()) as RunTestArgs;
    const puter = event.user?.puter;
    if (!puter) {
        return {
            ok: false,
            error: 'no per-request puter — was the puter-auth header sent?',
        };
    }
    const result = await runTest(args, puter);
    // Present only when the instrumented SDK preamble is deployed. The
    // isolate may recycle between requests, so counters ride along on
    // every response and the runner merges them.
    const coverage = (globalThis as Record<string, unknown>).__coverage__;
    if (coverage) {
        result.coverage = coverage as Record<string, unknown>;
    }
    return result;
});
