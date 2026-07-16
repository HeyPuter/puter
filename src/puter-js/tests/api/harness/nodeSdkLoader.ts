import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { coverageEnabled, type IstanbulCoverage } from './coverage.ts';
import type { EnvManifest, PuterSDK } from './types.ts';

// Prefer the npm-published name, fall back to webpack's raw output so a
// plain `npm run build` (no prepublish rename) is enough for local runs.
// PUTER_SDK_BUNDLE=dev forces the unminified sourcemapped bundle for
// readable stack traces when debugging suite failures. In coverage mode
// only `puter.js` is valid — that's the file the instrumented build
// writes (and the one inlined into the worker preamble).
const BUNDLE_CANDIDATES = ['../../../dist/puter.cjs', '../../../dist/puter.js'];
const DEV_BUNDLE = '../../../dist/puter.dev.js';
const COVERAGE_BUNDLE = '../../../dist/puter.js';

const resolveBundle = (): string => {
    const candidates = coverageEnabled()
        ? [COVERAGE_BUNDLE]
        : process.env.PUTER_SDK_BUNDLE === 'dev'
          ? [DEV_BUNDLE]
          : BUNDLE_CANDIDATES;
    for (const candidate of candidates) {
        const abs = fileURLToPath(new URL(candidate, import.meta.url));
        if (existsSync(abs)) return abs;
    }
    throw new Error(
        'puter.js bundle not found — run `npm run build` in src/puter-js first',
    );
};

// In coverage mode every vm context is retained so its `__coverage__`
// counters can be merged after the run (each test loads a fresh SDK).
const coverageContexts: Array<Record<string, unknown>> = [];

/** Coverage counters from every SDK context created so far. */
export const collectNodeCoverage = (): Array<IstanbulCoverage | undefined> =>
    coverageContexts.map(
        (context) => context.__coverage__ as IstanbulCoverage | undefined,
    );

// Compile the ~MB bundle once; isolation comes from a fresh context per
// call, not a fresh parse. The filename ties stack traces and V8 coverage
// entries back to the bundle on disk.
let cachedScript: vm.Script | null = null;
const sdkScript = (): vm.Script => {
    if (!cachedScript) {
        const bundlePath = resolveBundle();
        cachedScript = new vm.Script(readFileSync(bundlePath, 'utf8'), {
            // file:// form so stack traces point at the bundle on disk
            // rather than an anonymous eval.
            filename: pathToFileURL(bundlePath).href,
        });
    }
    return cachedScript;
};

/**
 * Load the built puter.js bundle into a fresh vm context — the same
 * technique as `src/init.cjs`, but parameterized on the test env and
 * isolated per call so each invocation gets an independent SDK instance
 * (own localStorage shim, own auth state).
 */
export const loadNodePuter = (env: EnvManifest, token: string): PuterSDK => {
    const context: Record<string, unknown> = {};
    for (const name of Object.getOwnPropertyNames(globalThis)) {
        try {
            context[name] = (globalThis as Record<string, unknown>)[name];
        } catch {
            // some globals throw on access; skip them
        }
    }
    context.globalThis = context;
    context.PUTER_API_ORIGIN = env.apiOrigin;
    context.PUTER_ORIGIN = env.origin;
    // The SDK's nodejs branch only shims localStorage when it's absent;
    // clear any inherited one so instances never share auth state.
    delete context.localStorage;

    sdkScript().runInContext(vm.createContext(context));
    if (coverageEnabled()) coverageContexts.push(context);

    const puter = context.puter as PuterSDK;
    puter.setAuthToken(token);
    return puter;
};
