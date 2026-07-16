import { suites } from '../suites/index.ts';
import { assert, show } from './assert.ts';
import type {
    EnvManifest,
    Platform,
    PuterSDK,
    RunTestResult,
    SuiteTest,
    SuiteTestSpec,
} from './types.ts';

const resolveSpec = (
    spec: SuiteTestSpec,
): { requires: string[]; platforms?: Platform[]; fn: SuiteTest } =>
    typeof spec === 'function'
        ? { requires: [], fn: spec }
        : { requires: spec.requires ?? [], platforms: spec.platforms, fn: spec.fn };

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
    const spec = suite?.tests[args.testName];
    if (!spec) {
        return {
            ok: false,
            error: `unknown test "${args.suiteName} > ${args.testName}"`,
        };
    }
    const test = resolveSpec(spec).fn;

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

export type ListedTest = {
    suiteName: string;
    testName: string;
    requires: string[];
    platforms?: Platform[];
};

/** Enumerate all tests — adapters use this to emit one `it()` per test. */
export const listTests = (): ListedTest[] =>
    suites.flatMap((s) =>
        Object.entries(s.tests).map(([testName, spec]) => {
            const { requires, platforms } = resolveSpec(spec);
            return { suiteName: s.name, testName, requires, platforms };
        }),
    );

/**
 * Why a test can't run on this platform with these capabilities, or null
 * if it can. Runners feed this into `it.skipIf` so constrained tests are
 * visible as skips instead of silently missing.
 */
export const skipReason = (
    test: ListedTest,
    platform: Platform,
    capabilities: string[],
): string | null => {
    if (test.platforms && !test.platforms.includes(platform)) {
        return `runs only on: ${test.platforms.join(', ')}`;
    }
    const missing = test.requires.filter((r) => !capabilities.includes(r));
    if (missing.length > 0) {
        return `missing capabilities: ${missing.join(', ')}`;
    }
    return null;
};
