import type { Puter } from '../../../types/puter.d.ts';
import type { Assert } from './assert.ts';

export type PuterSDK = Puter;

export type TestUserCredentials = {
    username: string;
    password: string;
    token: string;
    /**
     * Full-access access token (the dashboard "API Token"). AI surfaces
     * reject bare session tokens, so AI tests authenticate with this.
     */
    apiToken: string;
    /**
     * User-scoped worker session token (`kind='worker'`) — what an
     * app-less worker deployment holds. Never treated as a root token.
     */
    workerToken: string;
};

/**
 * The platform-agnostic description of a running test server. Produced by
 * `setupPuterTestEnv` (backend testUtil) on the node side and handed to
 * whichever runtime executes the tests. Must stay JSON-serializable — it
 * crosses into browsers and workerd.
 */
export type EnvManifest = {
    /** Root origin — GUI and root-only routes like `POST /login`. */
    origin: string;
    /** API origin — what puter.js uses as its APIOrigin. */
    apiOrigin: string;
    users: {
        admin: TestUserCredentials;
        user: TestUserCredentials;
        /** Second regular user, for cross-user permission tests. */
        other: TestUserCredentials;
    };
    /** Capability tags present in this env (see harness/capabilities.ts). */
    capabilities: string[];
};

export type Platform = 'node' | 'browser' | 'workerd';

/**
 * What every suite test receives. `puter` is authenticated as the regular
 * (non-privileged) user; admin-side assertions go through plain `fetch`
 * with `env.users.admin.token` so suites stay runnable on every platform.
 */
export type TestContext = {
    puter: PuterSDK;
    env: EnvManifest;
    assert: Assert;
    platform: Platform;
};

export type SuiteTest = (t: TestContext) => void | Promise<void>;

/**
 * A suite entry is either a bare test function or a spec object that
 * constrains where it runs. Tests whose constraints aren't met are
 * reported as skipped by the runners, never silently dropped.
 */
export type SuiteTestSpec =
    | SuiteTest
    | {
          /** Capability tags that must all be present (see capabilities.ts). */
          requires?: string[];
          /** Platforms this test can run on. Default: all. */
          platforms?: Platform[];
          fn: SuiteTest;
      };

/** Outcome of a single test run, serializable across runtime boundaries. */
export type RunTestResult = {
    ok: boolean;
    error?: string;
    /**
     * Istanbul counters from the executing runtime, present only when the
     * instrumented SDK bundle is in play (see harness/coverage.ts).
     */
    coverage?: Record<string, unknown>;
};

export type Suite = {
    name: string;
    tests: Record<string, SuiteTestSpec>;
};

export const suite = (
    name: string,
    tests: Record<string, SuiteTestSpec>,
): Suite => ({ name, tests });
