import { suites } from '../suites/index.ts';
import { assert, show } from './assert.ts';
import type {
    EnvManifest,
    Platform,
    PuterSDK,
    RunTestResult,
} from './types.ts';

export type RunTestArgs = {
    suiteName: string;
    testName: string;
    env: EnvManifest;
    platform: Platform;
};

/**
 * Run one named suite test against an already-configured SDK instance.
 * This is the piece every platform adapter funnels into: imported directly
 * by the node runner, bundled into the fixture page for browsers and into
 * the worker script for workerd. The platform-specific part — obtaining a
 * `puter` pointed at `env.apiOrigin` and authed as the regular user — stays
 * in the adapters.
 */
export const runTest = async (
    args: RunTestArgs,
    puter: PuterSDK,
): Promise<RunTestResult> => {
    const suite = suites.find((s) => s.name === args.suiteName);
    const test = suite?.tests[args.testName];
    if (!test) {
        return {
            ok: false,
            error: `unknown test "${args.suiteName} > ${args.testName}"`,
        };
    }

    try {
        await test({
            puter,
            env: args.env,
            assert,
            platform: args.platform,
        });
        return { ok: true };
    } catch (e) {
        const err = e as Error | undefined;
        // SDK errors often carry structured context (e.g. `failedItems` on
        // partial batch failures) — surface own enumerable props too.
        let details = '';
        if (e && typeof e === 'object') {
            const extras = Object.fromEntries(
                Object.entries(e as Record<string, unknown>).filter(
                    ([, v]) => typeof v !== 'function',
                ),
            );
            if (Object.keys(extras).length > 0) {
                details = `\ndetails: ${show(extras)}`;
            }
        }
        return {
            ok: false,
            error: (err?.stack ?? err?.message ?? show(e)) + details,
        };
    }
};

/** Enumerate all tests — adapters use this to emit one `it()` per test. */
export const listTests = (): Array<{ suiteName: string; testName: string }> =>
    suites.flatMap((s) =>
        Object.keys(s.tests).map((testName) => ({
            suiteName: s.name,
            testName,
        })),
    );
