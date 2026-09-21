import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    MAX_RECENTS,
    forget_recent_recipients,
    merge_recent,
    recent_recipients,
    remember_recipient,
    sanitize_recents,
} from './shareRecents.js';

const ANN = { kind: 'invite', id: 'ann@example.com', name: 'ann@example.com' };
const BOB = { kind: 'user', id: 'bob', name: 'bob' };

const original_puter = globalThis.puter;

beforeEach(() => {
    forget_recent_recipients();
});

afterEach(() => {
    globalThis.puter = original_puter;
});

describe('sanitize_recents', () => {
    it('drops anything that is not a usable recipient', () => {
        expect(sanitize_recents([
            BOB,
            { kind: 'nonsense', id: 'x', name: 'x' },
            { kind: 'user', id: '   ' },
            null,
            'bob',
        ])).toEqual([BOB]);
    });

    it('falls back to the id when there is no name to show', () => {
        expect(sanitize_recents([{ kind: 'user', id: 'bob' }]))
            .toEqual([{ kind: 'user', id: 'bob', name: 'bob' }]);
    });

    it('keeps one entry per recipient, the first', () => {
        expect(sanitize_recents([
            { kind: 'user', id: 'bob', name: 'bob' },
            { kind: 'user', id: 'BOB', name: 'other' },
        ])).toEqual([BOB]);
    });

    it('answers an unusable stored value with nothing', () => {
        expect(sanitize_recents(undefined)).toEqual([]);
        expect(sanitize_recents('bob')).toEqual([]);
    });
});

describe('merge_recent', () => {
    it('moves a repeat recipient to the front rather than duplicating them', () => {
        expect(merge_recent([ANN, BOB], BOB)).toEqual([BOB, ANN]);
    });

    it('caps the list so it stays a shortcut', () => {
        const many = Array.from({ length: MAX_RECENTS }, (_, i) => ({
            kind: 'user', id: `u${i}`, name: `u${i}`,
        }));
        const out = merge_recent(many, BOB);
        expect(out).toHaveLength(MAX_RECENTS);
        expect(out[0]).toEqual(BOB);
        expect(out).not.toContainEqual({ kind: 'user', id: 'u19', name: 'u19' });
    });

    it('leaves the list alone when the entry is unusable', () => {
        expect(merge_recent([BOB], { kind: 'user' })).toEqual([BOB]);
    });
});

describe('recent_recipients', () => {
    it('reads the store once however many dialogs ask', async () => {
        const get = vi.fn(async () => [BOB]);
        globalThis.puter = { kv: { get, set: vi.fn() } };

        await expect(recent_recipients()).resolves.toEqual([BOB]);
        await expect(recent_recipients()).resolves.toEqual([BOB]);
        expect(get).toHaveBeenCalledTimes(1);
    });

    it('suggests nothing when the store is unreachable', async () => {
        globalThis.puter = { kv: { get: vi.fn(async () => { throw new Error('offline'); }) } };
        await expect(recent_recipients()).resolves.toEqual([]);
    });
});

describe('remember_recipient', () => {
    it('writes the recipient to the front of the stored list', async () => {
        const set = vi.fn(async () => true);
        globalThis.puter = { kv: { get: vi.fn(async () => [ANN]), set } };

        await expect(remember_recipient(BOB)).resolves.toEqual([BOB, ANN]);
        expect(set).toHaveBeenCalledWith('recent_share_recipients', [BOB, ANN]);
        // Served from memory afterwards, without reading back.
        await expect(recent_recipients()).resolves.toEqual([BOB, ANN]);
    });

    it('still serves the session when the write is refused', async () => {
        globalThis.puter = {
            kv: {
                get: vi.fn(async () => []),
                set: vi.fn(async () => { throw new Error('quota'); }),
            },
        };
        await expect(remember_recipient(BOB)).resolves.toEqual([BOB]);
        await expect(recent_recipients()).resolves.toEqual([BOB]);
    });
});
