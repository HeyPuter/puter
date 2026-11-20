import { describe, expect, it } from 'vitest';
import {
    buildReport,
    compareReports,
    mergeReports,
    parseAccepted,
    renderMarkdown,
} from './lib/benchReport.mjs';

const scenario = (ms, roundTrips, serialStages) => ({
    ms,
    roundTrips,
    serialStages,
});
const report = (benchmarks) => ({ benchmarks });
const statusOf = (comparisons, id) =>
    comparisons.find((c) => c.id === id)?.status;

describe('buildReport', () => {
    const vitestJson = {
        files: [
            {
                filepath: '/repo/src/a.bench.ts',
                groups: [
                    {
                        benchmarks: [
                            { name: 'parse', median: 0.5, rme: 2 },
                            { name: 'stat', median: 30, rme: 9 },
                            // A benchmark that never ran has no median.
                            { name: 'broken', rme: 0 },
                        ],
                    },
                ],
            },
        ],
    };
    const relative = (p) => p.replace('/repo/', '');

    it('keys benchmarks by file and name, and prefers scenario numbers', () => {
        const built = buildReport(
            vitestJson,
            [
                {
                    file: 'src/a.bench.ts',
                    scenarios: [
                        {
                            name: 'stat',
                            latencyMs: 5,
                            roundTrips: { redis: 3 },
                            serialStages: 3,
                        },
                    ],
                },
            ],
            relative,
        );
        expect(built.benchmarks).toEqual({
            'src/a.bench.ts > parse': { ms: 0.5, rme: 2 },
            'src/a.bench.ts > stat': scenario(5, { redis: 3 }, 3),
        });
    });

    it('rejects two benchmarks with one name in a file', () => {
        const duplicated = structuredClone(vitestJson);
        duplicated.files[0].groups.push({
            benchmarks: [{ name: 'parse', median: 1 }],
        });
        expect(() => buildReport(duplicated, [], relative)).toThrow(
            /unique within a file/,
        );
    });
});

describe('compareReports', () => {
    it('fails a scenario on any extra round trip or stage', () => {
        const comparisons = compareReports(
            report({
                more: scenario(10, { dbRead: 1 }, 1),
                deeper: scenario(10, { dbRead: 2 }, 1),
                primary: scenario(10, { dbRead: 1 }, 1),
            }),
            report({
                more: scenario(10, { dbRead: 2 }, 1),
                deeper: scenario(10, { dbRead: 2 }, 2),
                primary: scenario(10, { dbRead: 1, dbPrimaryRead: 1 }, 1),
            }),
        );
        expect(comparisons.map((c) => [c.status, c.reasons])).toEqual([
            ['regression', ['+1 serial stages']],
            ['regression', ['+1 dbRead']],
            ['regression', ['+1 dbPrimaryRead']],
        ]);
    });

    it('fails a scenario whose latency grew past the threshold', () => {
        const base = report({ s: scenario(50, { dbWrite: 1, redis: 10 }, 5) });
        const slower = report({
            s: scenario(90, { dbWrite: 1, redis: 10 }, 5),
        });
        const [comparison] = compareReports(base, slower);
        expect(comparison.status).toBe('regression');
        expect(comparison.reasons).toEqual(['+80% time']);

        const barely = report({
            s: scenario(51, { dbWrite: 1, redis: 10 }, 5),
        });
        expect(compareReports(base, barely)[0].status).toBe('unchanged');
    });

    it('reports fewer round trips as an improvement', () => {
        const [comparison] = compareReports(
            report({ s: scenario(10, { redis: 4 }, 4) }),
            report({ s: scenario(4, { redis: 1 }, 1) }),
        );
        expect(comparison.status).toBe('improvement');
        expect(comparison.reasons).toEqual([
            '-3 redis',
            '-3 serial stages',
            '-60% time',
        ]);
    });

    it('holds a plain benchmark to the CPU threshold and its own noise', () => {
        const comparisons = compareReports(
            report({
                steady: { ms: 1, rme: 2 },
                slower: { ms: 1, rme: 2 },
                noisy: { ms: 1, rme: 30 },
            }),
            report({
                steady: { ms: 1.2, rme: 2 },
                slower: { ms: 1.5, rme: 2 },
                noisy: { ms: 1.5, rme: 30 },
            }),
        );
        expect(statusOf(comparisons, 'steady')).toBe('unchanged');
        expect(statusOf(comparisons, 'slower')).toBe('regression');
        expect(statusOf(comparisons, 'noisy')).toBe('unchanged');
    });

    it('marks benchmarks only one side has as new or removed', () => {
        const comparisons = compareReports(
            report({ gone: { ms: 1 } }),
            report({ added: { ms: 1 } }),
        );
        expect(statusOf(comparisons, 'added')).toBe('new');
        expect(statusOf(comparisons, 'gone')).toBe('removed');
    });

    it('accepts a regression a matching line covers, and only that one', () => {
        const base = report({
            'fs.bench.ts > stat a file': scenario(5, { redis: 1 }, 1),
            'kv.bench.ts > get a key': scenario(5, { redis: 1 }, 1),
        });
        const head = report({
            'fs.bench.ts > stat a file': scenario(5, { redis: 2 }, 1),
            'kv.bench.ts > get a key': scenario(5, { redis: 2 }, 1),
        });
        const accepted = parseAccepted(
            'Some description.\n\nbench-accept: Stat A File -- reads the new lock key\n',
        );
        const comparisons = compareReports(base, head, { accepted });
        expect(comparisons[0]).toMatchObject({
            status: 'accepted',
            acceptedBecause: 'reads the new lock key',
        });
        expect(comparisons[1].status).toBe('regression');

        const all = compareReports(base, head, {
            accepted: parseAccepted('bench-accept: * -- intentional'),
        });
        expect(all.map((c) => c.status)).toEqual(['accepted', 'accepted']);
    });
});

describe('parseAccepted', () => {
    it('reads each line and requires a reason', () => {
        expect(
            parseAccepted(
                [
                    'bench-accept: `fs.bench.ts > stat` -- one more read',
                    'bench-accept: no reason given',
                    'bench-accept: kv -- ',
                    '  Bench-Accept: readdir -- pagination needs the count',
                ].join('\n'),
            ),
        ).toEqual([
            { pattern: 'fs.bench.ts > stat', reason: 'one more read' },
            { pattern: 'readdir', reason: 'pagination needs the count' },
        ]);
        expect(parseAccepted('')).toEqual([]);
    });
});

describe('mergeReports and renderMarkdown', () => {
    it('merges shards and leads with the regressions', () => {
        const base = mergeReports([
            report({ a: scenario(50, { redis: 1 }, 1) }),
            report({ b: { ms: 1, rme: 1 } }),
        ]);
        const head = mergeReports([
            report({ a: scenario(60, { redis: 2 }, 2) }),
            report({ b: { ms: 1, rme: 1 } }),
        ]);
        const markdown = renderMarkdown(compareReports(base, head));
        expect(markdown).toContain('**1 regression(s).**');
        expect(markdown).toContain(
            '| `a` | regression | 50.0 → 60.0 ms | 1 redis · 1 stages → 2 redis · 2 stages | +1 redis, +1 serial stages, +20% time |',
        );
        expect(markdown).toContain('2 benchmarks: 1 regressed');

        expect(renderMarkdown(compareReports(base, base))).toContain(
            'No unaccepted regressions.',
        );
    });
});
