import { runTest, type RunTestArgs } from './executor.ts';
import type { PuterSDK, RunTestResult } from './types.ts';

/**
 * Browser-side entry, esbuild-bundled into the fixture page by the browser
 * runner. The page loads the real SDK bundle from the test server
 * (`/puter.js/v2`) with `window.PUTER_API_ORIGIN` pre-set, so `window.puter`
 * is already pointed at the right origin; each call authenticates it as the
 * regular test user and runs one named suite test.
 */
declare global {
    interface Window {
        puter: PuterSDK;
        __runSuiteTest__: (args: RunTestArgs) => Promise<RunTestResult>;
    }
}

window.__runSuiteTest__ = async (args) => {
    const puter = window.puter;
    if (!puter) {
        return { ok: false, error: 'window.puter is not loaded' };
    }
    puter.setAuthToken(args.env.users.user.token);
    return runTest(args, puter);
};
