import { describe, expect, it, vi } from 'vitest';

// An older backend that still returns worker-backed rows from `select`.
const ROWS = [
    { subdomain: 'my-site' },
    { subdomain: 'workers.puter.my-worker' },
];

vi.mock('../../lib/utils.js', async (importOriginal) => ({
    ...(await importOriginal()),
    makeDriverMethod: () => async (params = {}) => {
        const envelope =
            Object.prototype.hasOwnProperty.call(params, 'cursor') ||
            params.includeTotal !== undefined;
        return envelope ? { items: ROWS, cursor: null, total: ROWS.length } : ROWS;
    },
}));

const { list } = await import('./list.js');

const hosting = { puter: {} };
const names = (items) => items.map((row) => row.subdomain);

describe('hosting.list worker-row filtering', () => {
    it('returns the same rows in every listing mode', async () => {
        const unbounded = await list.call(hosting);
        const limited = await list.call(hosting, { limit: 10 });
        const envelope = await list.call(hosting, { cursor: null });
        const withTotal = await list.call(hosting, { includeTotal: true });
        const streamed = [];
        for await ( const page of list.call(hosting, { stream: true }) ) {
            streamed.push(...page.items);
        }

        expect(names(unbounded)).toEqual(['my-site']);
        expect(names(limited)).toEqual(['my-site']);
        expect(names(envelope.items)).toEqual(['my-site']);
        expect(names(withTotal.items)).toEqual(['my-site']);
        expect(names(streamed)).toEqual(['my-site']);
    });

    it('keeps the rest of the page envelope', async () => {
        const page = await list.call(hosting, { cursor: null });
        expect(page.cursor).toBeNull();
        expect(page.total).toBe(ROWS.length);
    });
});
