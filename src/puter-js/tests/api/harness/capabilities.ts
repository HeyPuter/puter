/**
 * Optional test capabilities, derived from `PUTER_TEST_*` env vars on the
 * node side before the test server boots. Each mapping contributes a
 * capability tag that suite tests can declare via `requires`, plus the
 * config override that makes the backend actually support it. Unset vars
 * mean the dependent tests show up as skipped — a keyless run stays green
 * without silently losing sight of what wasn't covered.
 *
 * Env var names follow the backend AI integration tests
 * (`PUTER_TEST_AI_<PROVIDER>_API_KEY`, see drivers/integrationTestUtil.ts)
 * so one set of secrets drives both test layers.
 *
 * Node-side only: imported by the runners, never bundled into suites.
 * Suites can read the resulting tags from `t.env.capabilities`.
 */

type ConfigOverrides = Record<string, unknown>;

type CapabilityMapping = {
    capability: string;
    /** All must be set for the capability to activate. */
    envVars: string[];
    configOverrides: (values: string[]) => ConfigOverrides;
};

const aiProvider = (
    capability: string,
    envVar: string,
    providerId: string,
): CapabilityMapping => ({
    capability,
    envVars: [envVar],
    configOverrides: ([apiKey]) => ({
        providers: { [providerId]: { apiKey } },
    }),
});

const MAPPINGS: CapabilityMapping[] = [
    {
        capability: 'net.wisp',
        envVars: ['PUTER_TEST_WISP_SERVER'],
        configOverrides: ([server]) => ({ wisp: { server } }),
    },
    aiProvider('ai.openai', 'PUTER_TEST_AI_OPENAI_API_KEY', 'openai-completion'),
    aiProvider('ai.claude', 'PUTER_TEST_AI_CLAUDE_API_KEY', 'claude'),
    aiProvider('ai.gemini', 'PUTER_TEST_AI_GEMINI_API_KEY', 'gemini'),
];

const mergeOverrides = (
    base: ConfigOverrides,
    extra: ConfigOverrides,
): ConfigOverrides => {
    const out: ConfigOverrides = { ...base };
    for (const [key, value] of Object.entries(extra)) {
        const existing = out[key];
        if (
            existing &&
            typeof existing === 'object' &&
            !Array.isArray(existing) &&
            value &&
            typeof value === 'object' &&
            !Array.isArray(value)
        ) {
            out[key] = mergeOverrides(
                existing as ConfigOverrides,
                value as ConfigOverrides,
            );
        } else {
            out[key] = value;
        }
    }
    return out;
};

export type PuterJsTestOptions = {
    capabilities: string[];
    configOverrides: ConfigOverrides;
};

/**
 * Resolve capabilities and the matching server config for a suite run.
 * The base config routes worker deploys to the local workerd so the
 * workers suite runs on every platform — that's a dev dependency, not a
 * capability.
 */
export const loadPuterJsTestOptions = (
    env: Record<string, string | undefined> = process.env,
): PuterJsTestOptions => {
    const capabilities: string[] = [];
    let configOverrides: ConfigOverrides = {
        workers: { localServer: 'true' },
    };

    for (const mapping of MAPPINGS) {
        const values = mapping.envVars.map((name) => env[name] ?? '');
        if (values.some((v) => v.length === 0)) continue;
        capabilities.push(mapping.capability);
        configOverrides = mergeOverrides(
            configOverrides,
            mapping.configOverrides(values),
        );
    }

    return { capabilities, configOverrides };
};
