import { describe, expect, it } from 'vitest';
import { fetchAllPages, iteratePages } from './pagination.js';

describe('iteratePages', () => {
    it('follows cursors until a page has none', async () => {
        const calls = [];
        const fetchPage = async (params) => {
            calls.push(params);
            if ( params.cursor === null ) return { items: ['a'], cursor: 'c2' };
            if ( params.cursor === 'c2' ) return { items: ['b'], cursor: 'c3' };
            return { items: ['c'] };
        };
        const pages = [];
        for await ( const page of iteratePages(fetchPage) ) pages.push(page);
        expect(pages).toEqual([
            { items: ['a'], cursor: 'c2' },
            { items: ['b'], cursor: 'c3' },
            { items: ['c'] },
        ]);
        expect(calls).toEqual([{ cursor: null }, { cursor: 'c2' }, { cursor: 'c3' }]);
    });

    it('sends includeTotal on the first request only', async () => {
        const calls = [];
        const fetchPage = async (params) => {
            calls.push(params);
            return params.cursor === null
                ? { items: [1], cursor: 'c2', total: 2 }
                : { items: [2] };
        };
        const pages = [];
        for await ( const page of iteratePages(fetchPage, { includeTotal: true }) ) pages.push(page);
        expect(calls).toEqual([
            { cursor: null, includeTotal: true },
            { cursor: 'c2' },
        ]);
        expect(pages[0].total).toBe(2);
    });

    it('starts from a caller-provided cursor', async () => {
        const calls = [];
        const fetchPage = async (params) => {
            calls.push(params);
            return { items: [] };
        };
        for await ( const page of iteratePages(fetchPage, { cursor: 'resume' }) ) void page;
        expect(calls).toEqual([{ cursor: 'resume' }]);
    });

    it('treats a bare-array response as the one and only page', async () => {
        let calls = 0;
        const fetchPage = async () => {
            calls++;
            return ['a', 'b'];
        };
        const pages = [];
        for await ( const page of iteratePages(fetchPage) ) pages.push(page);
        expect(pages).toEqual([{ items: ['a', 'b'] }]);
        expect(calls).toBe(1);
    });

    it('propagates fetch errors to the consumer', async () => {
        const fetchPage = async () => {
            throw { message: 'nope', code: 'forbidden' };
        };
        const iterate = async () => {
            for await ( const page of iteratePages(fetchPage) ) void page;
        };
        await expect(iterate()).rejects.toMatchObject({ code: 'forbidden' });
    });
});

describe('fetchAllPages', () => {
    it('concatenates items across pages', async () => {
        const fetchPage = async (params) =>
            params.cursor === null
                ? { items: ['a', 'b'], cursor: 'c2' }
                : { items: ['c'] };
        expect(await fetchAllPages(fetchPage)).toEqual(['a', 'b', 'c']);
    });

    it('returns a bare-array response as-is', async () => {
        expect(await fetchAllPages(async () => ['x'])).toEqual(['x']);
    });

    it('tolerates short and empty pages while a cursor remains', async () => {
        const fetchPage = async (params) =>
            params.cursor === null
                ? { items: [], cursor: 'c2' }
                : { items: ['only'] };
        expect(await fetchAllPages(fetchPage)).toEqual(['only']);
    });
});
