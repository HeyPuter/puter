import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * SDK coverage collection for the API suites. Enabled by `PUTER_COVERAGE=1`
 * (the `test:puterjs:coverage` script), which expects the instrumented SDK
 * bundle (`npm run build:coverage` in src/puter-js) — every first-party
 * module then accumulates istanbul counters on `globalThis.__coverage__`
 * in whatever runtime executes it.
 *
 * Each runner collects the counters from its runtime (vm contexts, the
 * browser page, workerd responses) and writes one merged shard per
 * platform; `tools/puterjsCoverageReport.mjs` merges the shards into the
 * final reports in src/puter-js/coverage.
 *
 * Node-side only: imported by the runners, never bundled into suites.
 */

export type IstanbulCoverage = Record<string, unknown>;

export const coverageEnabled = (): boolean =>
    Boolean(process.env.PUTER_COVERAGE);

const SHARD_DIR = fileURLToPath(
    new URL('../../../coverage/shards/', import.meta.url),
);

/** Merge per-runtime coverage objects and write this platform's shard. */
export const writeCoverageShard = async (
    platform: string,
    coverages: Array<IstanbulCoverage | null | undefined>,
): Promise<void> => {
    const present = coverages.filter(
        (c): c is IstanbulCoverage => Boolean(c && Object.keys(c).length > 0),
    );
    if (present.length === 0) {
        throw new Error(
            `no coverage collected on ${platform} — was the instrumented ` +
                'bundle built? (npm run build:workerLib:coverage)',
        );
    }
    const { createCoverageMap } = await import('istanbul-lib-coverage');
    const map = createCoverageMap({});
    for (const coverage of present) {
        map.merge(coverage as Parameters<typeof map.merge>[0]);
    }
    mkdirSync(SHARD_DIR, { recursive: true });
    writeFileSync(
        `${SHARD_DIR}coverage-${platform}.json`,
        JSON.stringify(map.toJSON()),
    );
};
