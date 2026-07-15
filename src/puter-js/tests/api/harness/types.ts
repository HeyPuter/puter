import type { Puter } from '../../../types/puter.d.ts';
import type { Assert } from './assert.ts';

export type PuterSDK = Puter;

export type TestUserCredentials = {
    username: string;
    password: string;
    token: string;
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
    };
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

/** Outcome of a single test run, serializable across runtime boundaries. */
export type RunTestResult = {
    ok: boolean;
    error?: string;
};

export type Suite = {
    name: string;
    tests: Record<string, SuiteTest>;
};

export const suite = (
    name: string,
    tests: Record<string, SuiteTest>,
): Suite => ({ name, tests });
