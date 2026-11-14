// Pure helpers behind tools/bench.mjs: turning vitest's benchmark output into
// one report, and comparing two reports. See doc/benchmarks.md.

/**
 * @typedef {Object} BenchEntry
 * @property {number} ms Median milliseconds per run; for a scenario, its
 *   modeled I/O latency.
 * @property {number} [rme] Relative margin of error, in percent.
 * @property {Record<string, number>} [roundTrips] Scenario only: client round
 *   trips per destination.
 * @property {number} [serialStages] Scenario only: longest run of round trips
 *   issued one after another.
 */

/** @typedef {{ benchmarks: Record<string, BenchEntry> }} BenchReport */

/**
 * @typedef {Object} BenchThresholds
 * @property {number} scenarioLatency Allowed fractional slowdown of a
 *   scenario's latency.
 * @property {number} scenarioLatencyFloorMs A scenario slowdown smaller than
 *   this never counts.
 * @property {number} cpu Allowed fractional slowdown of a plain benchmark.
 */

/** @type {BenchThresholds} */
export const DEFAULT_THRESHOLDS = {
    scenarioLatency: 0.1,
    scenarioLatencyFloorMs: 2,
    cpu: 0.3,
};

/**
 * @typedef {Object} VitestBenchmark
 * @property {string} name
 * @property {number} [median]
 * @property {number} [rme]
 */

/**
 * @typedef {{
 *     files: {
 *         filepath: string;
 *         groups: { benchmarks: VitestBenchmark[] }[];
 *     }[];
 * }} VitestBenchJson
 */

/**
 * @typedef {Object} ScenarioSidecar
 * @property {string} file Bench file, relative to the repo root.
 * @property {{
 *     name: string;
 *     latencyMs: number;
 *     roundTrips: Record<string, number>;
 *     serialStages: number;
 * }[]} scenarios
 */

/**
 * One report from vitest's `--outputJson` plus the per-file scenario sidecars.
 * A scenario's own latency replaces vitest's timing, which also covers the wait
 * for background I/O to settle.
 *
 * @param {VitestBenchJson} vitestJson
 * @param {ScenarioSidecar[]} sidecars
 * @param {(filepath: string) => string} relativePath
 * @returns {BenchReport}
 */
export const buildReport = (vitestJson, sidecars, relativePath) => {
    /** @type {Record<string, BenchEntry>} */
    const benchmarks = {};
    for (const file of vitestJson.files ?? []) {
        for (const group of file.groups ?? []) {
            for (const benchmark of group.benchmarks ?? []) {
                if (typeof benchmark.median !== 'number') continue;
                const id = `${relativePath(file.filepath)} > ${benchmark.name}`;
                if (benchmarks[id]) {
                    throw new Error(
                        `Benchmark names must be unique within a file: ${id}`,
                    );
                }
                benchmarks[id] = { ms: benchmark.median, rme: benchmark.rme };
            }
        }
    }
    for (const sidecar of sidecars) {
        for (const scenario of sidecar.scenarios) {
            benchmarks[`${sidecar.file} > ${scenario.name}`] = {
                ms: scenario.latencyMs,
                roundTrips: scenario.roundTrips,
                serialStages: scenario.serialStages,
            };
        }
    }
    return { benchmarks };
};

/**
 * @param {BenchReport[]} reports
 * @returns {BenchReport}
 */
export const mergeReports = (reports) => ({
    benchmarks: Object.assign({}, ...reports.map((r) => r.benchmarks)),
});

/**
 * `bench-accept: <part of a benchmark id, or *> -- <reason>` lines, as written
 * in a pull request description.
 *
 * @param {string} text
 * @returns {{ pattern: string; reason: string }[]}
 */
export const parseAccepted = (text) =>
    [
        ...(text ?? '').matchAll(
            /^[ \t]*bench-accept:[ \t]*(.+?)[ \t]+--[ \t]+(\S.*)$/gim,
        ),
    ].map(([, pattern, reason]) => ({
        pattern: pattern.replace(/^`|`$/g, ''),
        reason: reason.trim(),
    }));

/**
 * @typedef {Object} BenchComparison
 * @property {string} id
 * @property {'regression'
 *     | 'accepted'
 *     | 'improvement'
 *     | 'unchanged'
 *     | 'new'
 *     | 'removed'} status
 * @property {BenchEntry} [base]
 * @property {BenchEntry} [head]
 * @property {string[]} reasons What got worse (or, for an improvement, better).
 * @property {string} [acceptedBecause]
 */

const pct = (base, head) => (base > 0 ? (head - base) / base : 0);
const signed = (n) => `${n > 0 ? '+' : ''}${n}`;

/**
 * @param {BenchReport} base
 * @param {BenchReport} head
 * @param {{
 *     accepted?: { pattern: string; reason: string }[];
 *     thresholds?: BenchThresholds;
 * }} [options]
 * @returns {BenchComparison[]}
 */
export const compareReports = (base, head, options = {}) => {
    const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
    const accepted = options.accepted ?? [];
    const ids = [
        ...new Set([
            ...Object.keys(base.benchmarks),
            ...Object.keys(head.benchmarks),
        ]),
    ].sort();

    return ids.map((id) => {
        const b = base.benchmarks[id];
        const h = head.benchmarks[id];
        if (!b) return { id, status: 'new', head: h, reasons: [] };
        if (!h) return { id, status: 'removed', base: b, reasons: [] };

        const worse = [];
        const better = [];
        if (h.roundTrips && b.roundTrips) {
            const kinds = new Set([
                ...Object.keys(b.roundTrips),
                ...Object.keys(h.roundTrips),
            ]);
            for (const kind of [...kinds].sort()) {
                const delta =
                    (h.roundTrips[kind] ?? 0) - (b.roundTrips[kind] ?? 0);
                if (delta !== 0) {
                    (delta > 0 ? worse : better).push(
                        `${signed(delta)} ${kind}`,
                    );
                }
            }
            const stages = (h.serialStages ?? 0) - (b.serialStages ?? 0);
            if (stages !== 0) {
                (stages > 0 ? worse : better).push(
                    `${signed(stages)} serial stages`,
                );
            }
        }

        const change = pct(b.ms, h.ms);
        const scenario = Boolean(h.roundTrips && b.roundTrips);
        const limit = scenario ? thresholds.scenarioLatency : thresholds.cpu;
        // A plain benchmark's own run-to-run spread is not a change.
        const noise = scenario ? 0 : ((b.rme ?? 0) + (h.rme ?? 0)) / 100;
        const floor = scenario ? thresholds.scenarioLatencyFloorMs : 0;
        const time = `${signed(Math.round(change * 100))}% time`;
        if (change > Math.max(limit, noise) && h.ms - b.ms > floor) {
            worse.push(time);
        } else if (-change > Math.max(limit, noise) && b.ms - h.ms > floor) {
            better.push(time);
        }

        if (worse.length === 0) {
            return {
                id,
                status: better.length ? 'improvement' : 'unchanged',
                base: b,
                head: h,
                reasons: better,
            };
        }
        const acceptance = accepted.find(
            ({ pattern }) =>
                pattern === '*' ||
                id.toLowerCase().includes(pattern.toLowerCase()),
        );
        return {
            id,
            status: acceptance ? 'accepted' : 'regression',
            base: b,
            head: h,
            reasons: worse,
            ...(acceptance ? { acceptedBecause: acceptance.reason } : {}),
        };
    });
};

const formatMs = (ms) => (ms >= 10 ? ms.toFixed(1) : ms.toPrecision(3));

const formatIo = (entry) =>
    entry?.roundTrips
        ? `${
              Object.entries(entry.roundTrips)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([kind, count]) => `${count} ${kind}`)
                  .join(', ') || 'no I/O'
          } · ${entry.serialStages} stages`
        : '';

const row = (c) => {
    const time =
        c.base && c.head
            ? `${formatMs(c.base.ms)} → ${formatMs(c.head.ms)} ms`
            : `${formatMs((c.head ?? c.base).ms)} ms`;
    const io =
        c.base?.roundTrips && formatIo(c.base) !== formatIo(c.head)
            ? `${formatIo(c.base)} → ${formatIo(c.head)}`
            : formatIo(c.head ?? c.base);
    const note = c.acceptedBecause
        ? `${c.reasons.join(', ')} (accepted: ${c.acceptedBecause})`
        : c.reasons.join(', ');
    return `| \`${c.id}\` | ${c.status} | ${time} | ${io} | ${note} |`;
};

const HEADER =
    '| Benchmark | Status | Time | Round trips | Change |\n| --- | --- | --- | --- | --- |';

/**
 * @param {BenchComparison[]} comparisons
 * @returns {string}
 */
export const renderMarkdown = (comparisons) => {
    const count = (status) =>
        comparisons.filter((c) => c.status === status).length;
    const changed = comparisons.filter((c) => c.status !== 'unchanged');
    const lines = ['## Benchmarks', ''];
    lines.push(
        count('regression')
            ? `**${count('regression')} regression(s).** Fix them, or accept each one in the pull request description with a \`bench-accept: <benchmark> -- <reason>\` line. See doc/benchmarks.md.`
            : 'No unaccepted regressions.',
        '',
        `${comparisons.length} benchmarks: ${count('regression')} regressed, ${count('accepted')} accepted, ${count('improvement')} improved, ${count('new')} new, ${count('removed')} removed.`,
    );
    if (changed.length) {
        lines.push('', HEADER, ...changed.map(row));
    }
    lines.push(
        '',
        '<details><summary>All benchmarks</summary>',
        '',
        HEADER,
        ...comparisons.map(row),
        '',
        '</details>',
        '',
    );
    return lines.join('\n');
};
