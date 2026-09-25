import { describe, expect, it } from 'vitest';
import {
    candidateDays, decodeCursor, decodeSubject, encodeCursor, isUuidV7, normalizeFolder, normalizeLimit,
    parseEntryName, toSummary, uuidV7Date,
} from './lib/mailbox.js';
import { get } from './get.js';
import { list } from './list.js';

// 2024-03-15T12:34:56.789Z, as the writers would have minted it.
const MS = Date.UTC(2024, 2, 15, 12, 34, 56, 789);
const uuidAt = (ms, tail = '000-000000000000') => {
    const hex = ms.toString(16).padStart(12, '0');
    return `${ hex.slice(0, 8) }-${ hex.slice(8, 12) }-7000-8${ tail }`;
};
const toB64Url = (str) => btoa(String.fromCharCode(...new TextEncoder().encode(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('uuidv7 helpers', () => {
    it('recovers the mint time from the first 48 bits', () => {
        expect(uuidV7Date(uuidAt(MS)).getTime()).toBe(MS);
    });

    it('accepts only version 7 uuids', () => {
        expect(isUuidV7(uuidAt(MS))).toBe(true);
        expect(isUuidV7(uuidAt(MS).toUpperCase())).toBe(true);
        expect(isUuidV7('018e4b6c-1a2b-4000-8000-000000000000')).toBe(false);
        expect(isUuidV7('not-a-uuid')).toBe(false);
        expect(isUuidV7(42)).toBe(false);
    });

    it('lists the derived day first, then the next and previous days', () => {
        expect(candidateDays(uuidAt(MS))).toEqual(['2024-03-15', '2024-03-16', '2024-03-14']);
    });

    it('crosses month and year boundaries when picking adjacent days', () => {
        expect(candidateDays(uuidAt(Date.UTC(2023, 11, 31, 23, 59, 59, 999))))
            .toEqual(['2023-12-31', '2024-01-01', '2023-12-30']);
        expect(candidateDays(uuidAt(Date.UTC(2024, 2, 1, 0, 0, 0, 1))))
            .toEqual(['2024-03-01', '2024-03-02', '2024-02-29']);
    });
});

describe('entry names', () => {
    it('decodes a base64url subject, unicode included', () => {
        expect(decodeSubject(toB64Url('Réunion — 東京 🎉'))).toBe('Réunion — 東京 🎉');
    });

    it('decodes an empty or undecodable subject to the empty string', () => {
        expect(decodeSubject('')).toBe('');
        expect(decodeSubject('%%%not base64%%%')).toBe('');
    });

    it('parses a mail object name into id and subject', () => {
        const id = uuidAt(MS);
        expect(parseEntryName(`${ id.toUpperCase() }--${ toB64Url('Hello') }`)).toEqual({ id, subject: 'Hello' });
        expect(parseEntryName(`${ id }--`)).toEqual({ id, subject: '' });
    });

    it('rejects names that are not mail objects', () => {
        expect(parseEntryName('notes.txt')).toBeNull();
        expect(parseEntryName('018e4b6c-1a2b-4000-8000-000000000000--abc')).toBeNull();
        expect(parseEntryName(`${ uuidAt(MS) }-abc`)).toBeNull();
    });

    it('builds a summary from a listing entry and skips directories', () => {
        const id = uuidAt(MS);
        const entry = { name: `${ id }--${ toB64Url('Hi') }`, path: `/u/.mail/objects/2024-03-15/${ id }--SGk`, uid: 'uid-1', size: 123, is_dir: false };
        expect(toSummary(entry, 'inbox')).toEqual({
            id, subject: 'Hi', date: '2024-03-15T12:34:56.789Z', size: 123, folder: 'inbox', path: entry.path, uid: 'uid-1',
        });
        expect(toSummary({ ...entry, is_dir: true }, 'inbox')).toBeNull();
    });
});

describe('cursors', () => {
    it('round-trips a position', () => {
        const position = { folder: 'inbox', day: '2024-03-15', fsCursor: 'abc' };
        expect(decodeCursor(encodeCursor(position), 'inbox')).toEqual(position);
        expect(decodeCursor(encodeCursor({ folder: 'sent', day: '2024-03-15' }), 'sent')).toEqual({ folder: 'sent', day: '2024-03-15' });
    });

    it('treats null and undefined as the first page', () => {
        expect(decodeCursor(null, 'inbox')).toBeUndefined();
        expect(decodeCursor(undefined, 'inbox')).toBeUndefined();
    });

    it('refuses garbage and cursors from another folder', () => {
        expect(() => decodeCursor('not-a-cursor', 'inbox')).toThrow(expect.objectContaining({ code: 'invalid_request' }));
        expect(() => decodeCursor(encodeCursor({ folder: 'sent', day: '2024-03-15' }), 'inbox'))
            .toThrow(expect.objectContaining({ code: 'invalid_request' }));
    });
});

describe('option validation', () => {
    it('defaults and validates folder and limit', () => {
        expect(normalizeFolder(undefined)).toBe('inbox');
        expect(normalizeFolder('sent')).toBe('sent');
        expect(() => normalizeFolder('outbox')).toThrow(expect.objectContaining({ code: 'invalid_request' }));
        expect(normalizeLimit(undefined)).toBe(50);
        expect(normalizeLimit(7.9)).toBe(7);
        expect(normalizeLimit(5000)).toBe(1000);
        expect(() => normalizeLimit(0)).toThrow(expect.objectContaining({ code: 'invalid_request' }));
        expect(() => normalizeLimit('10')).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    });
});

/**
 * An in-memory `puter.fs` over a mailbox tree, honouring the readdir options
 * the module relies on: name sort, `limit`, and cursor pages. Cursors are the
 * index of the next entry, which is what the walk needs from them.
 *
 * @param {Record<string, string[]>} tree dir path (`~/...`) -> child names; leaf files map to nothing
 */
const fakeFs = (tree, files = {}) => {
    const calls = [];
    const readdir = async (options) => {
        calls.push(options);
        const children = tree[options.path];
        if ( ! children ) throw { code: 'subject_does_not_exist', message: 'missing' };
        const sorted = [...children].sort();
        if ( options.sortOrder === 'desc' ) sorted.reverse();
        const start = options.cursor ? Number(options.cursor) : 0;
        const limit = options.limit ?? sorted.length;
        const slice = sorted.slice(start, start + limit);
        const items = slice.map(name => ({
            name,
            path: `${ options.path }/${ name }`,
            uid: `uid:${ name }`,
            size: 10,
            is_dir: tree[`${ options.path }/${ name }`] !== undefined,
        }));
        const end = start + slice.length;
        return end < sorted.length ? { items, cursor: String(end) } : { items };
    };
    const read = async (path) => new Blob([files[path] ?? '']);
    return { fs: { readdir, read }, calls };
};

const ids = {
    d14a: uuidAt(Date.UTC(2024, 2, 14, 8), '000-00000000000a'),
    d14b: uuidAt(Date.UTC(2024, 2, 14, 9), '000-00000000000b'),
    d15a: uuidAt(Date.UTC(2024, 2, 15, 1), '000-00000000000c'),
    d16a: uuidAt(Date.UTC(2024, 2, 16, 3), '000-00000000000d'),
    d16b: uuidAt(Date.UTC(2024, 2, 16, 4), '000-00000000000e'),
};
const inboxTree = {
    '~/.mail/objects': ['2024-03-14', '2024-03-15', '2024-03-16', 'stray.txt'],
    '~/.mail/objects/2024-03-14': [`${ ids.d14a }--${ toB64Url('a') }`, `${ ids.d14b }--${ toB64Url('b') }`],
    '~/.mail/objects/2024-03-15': [`${ ids.d15a }--${ toB64Url('c') }`],
    '~/.mail/objects/2024-03-16': [`${ ids.d16a }--${ toB64Url('d') }`, `${ ids.d16b }--${ toB64Url('e') }`, 'README'],
};
const moduleOver = (fs) => ({ puter: { fs }, list, get });

describe('list()', () => {
    it('walks day folders newest first and pages across them', async () => {
        const { fs } = fakeFs(inboxTree);
        const email = moduleOver(fs);

        const first = await email.list.call(email, { limit: 3 });
        expect(first.items.map(m => m.id)).toEqual([ids.d16b, ids.d16a, ids.d15a]);
        expect(first.items.map(m => m.subject)).toEqual(['e', 'd', 'c']);
        expect(first.cursor).toBeTypeOf('string');

        const second = await email.list.call(email, { limit: 3, cursor: first.cursor });
        expect(second.items.map(m => m.id)).toEqual([ids.d14b, ids.d14a]);
        expect(second.cursor).toBeUndefined();
    });

    it('resumes inside a day folder when a page ends mid-day', async () => {
        const { fs } = fakeFs(inboxTree);
        const email = moduleOver(fs);
        const seen = [];
        let cursor = null;
        do {
            const page = await email.list.call(email, { limit: 1, cursor });
            seen.push(...page.items.map(m => m.id));
            cursor = page.cursor;
        } while ( cursor );
        expect(seen).toEqual([ids.d16b, ids.d16a, ids.d15a, ids.d14b, ids.d14a]);
    });

    it('streams pages', async () => {
        const { fs } = fakeFs(inboxTree);
        const email = moduleOver(fs);
        const pages = [];
        for await ( const page of email.list.call(email, { stream: true, limit: 2 }) ) {
            pages.push(page.items.map(m => m.id));
        }
        expect(pages).toEqual([[ids.d16b, ids.d16a], [ids.d15a, ids.d14b], [ids.d14a]]);
    });

    it('lists a mailbox that was never written as empty', async () => {
        const { fs } = fakeFs({});
        const email = moduleOver(fs);
        expect(await email.list.call(email)).toEqual({ items: [] });
        expect(await email.list.call(email, { folder: 'sent' })).toEqual({ items: [] });
    });

    it('reads the sent folder from its own directory', async () => {
        const { fs, calls } = fakeFs({
            '~/.mail/sent': ['2024-03-15'],
            '~/.mail/sent/2024-03-15': [`${ ids.d15a }--${ toB64Url('sent one') }`],
        });
        const email = moduleOver(fs);
        const page = await email.list.call(email, { folder: 'sent' });
        expect(page.items).toHaveLength(1);
        expect(page.items[0].folder).toBe('sent');
        expect(calls.every(c => c.path.startsWith('~/.mail/sent'))).toBe(true);
    });

    it('rejects offset, includeTotal, and a foreign cursor before any request', async () => {
        const { fs, calls } = fakeFs(inboxTree);
        const email = moduleOver(fs);
        expect(() => email.list.call(email, { offset: 3 })).toThrow(expect.objectContaining({ code: 'invalid_request' }));
        expect(() => email.list.call(email, { includeTotal: true })).toThrow(expect.objectContaining({ code: 'invalid_request' }));
        expect(() => email.list.call(email, { cursor: 'junk' })).toThrow(expect.objectContaining({ code: 'invalid_request' }));
        expect(() => email.list.call(email, { folder: 'outbox' })).toThrow(expect.objectContaining({ code: 'invalid_request' }));
        expect(calls).toHaveLength(0);
    });
});

describe('get()', () => {
    const raw = [
        'From: Ada <ada@example.com>',
        'To: Bob <bob@puter.email>',
        'Subject: Full subject that is longer than the name carries',
        'Date: Fri, 15 Mar 2024 01:00:00 +0000',
        'Message-ID: <m1@example.com>',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'hello body',
    ].join('\r\n');
    const files = { [`~/.mail/objects/2024-03-15/${ ids.d15a }--${ toB64Url('c') }`]: raw };

    it('locates by id with one listing of the derived day and parses the message', async () => {
        const { fs, calls } = fakeFs(inboxTree, files);
        const email = moduleOver(fs);
        const msg = await email.get.call(email, ids.d15a);
        expect(calls.map(c => c.path)).toEqual(['~/.mail/objects/2024-03-15']);
        expect(msg.id).toBe(ids.d15a);
        expect(msg.subject).toBe('Full subject that is longer than the name carries');
        expect(msg.from).toEqual({ name: 'Ada', address: 'ada@example.com' });
        expect(msg.to).toEqual([{ name: 'Bob', address: 'bob@puter.email' }]);
        expect(msg.messageId).toBe('<m1@example.com>');
        expect(msg.date).toBe('2024-03-15T01:00:00.000Z');
        expect(msg.text.trim()).toBe('hello body');
        expect(msg.attachments).toEqual([]);
        expect(msg.path).toBe(`~/.mail/objects/2024-03-15/${ ids.d15a }--${ toB64Url('c') }`);
    });

    it('returns the raw blob when asked', async () => {
        const { fs } = fakeFs(inboxTree, files);
        const email = moduleOver(fs);
        const blob = await email.get.call(email, { id: ids.d15a, raw: true });
        expect(blob).toBeInstanceOf(Blob);
        expect(await blob.text()).toBe(raw);
    });

    it('falls back to the adjacent days when the message straddled midnight', async () => {
        // Minted just after midnight on the 16th, filed under the 15th.
        const late = uuidAt(Date.UTC(2024, 2, 16, 0, 0, 0, 3), '000-0000000000ff');
        const name = `${ late }--${ toB64Url('late') }`;
        const { fs, calls } = fakeFs({
            ...inboxTree,
            '~/.mail/objects/2024-03-15': [...inboxTree['~/.mail/objects/2024-03-15'], name],
        }, { [`~/.mail/objects/2024-03-15/${ name }`]: raw });
        const email = moduleOver(fs);
        const msg = await email.get.call(email, late);
        expect(msg.id).toBe(late);
        expect(calls.map(c => c.path)).toEqual(['~/.mail/objects/2024-03-16', '~/.mail/objects/2024-03-17', '~/.mail/objects/2024-03-15']);
    });

    it('rejects an unknown id with not_found and a malformed id with invalid_request', async () => {
        const { fs } = fakeFs(inboxTree, files);
        const email = moduleOver(fs);
        await expect(email.get.call(email, uuidAt(Date.UTC(2024, 2, 15, 5), '000-0000000000aa')))
            .rejects.toMatchObject({ code: 'not_found' });
        await expect(email.get.call(email, { id: ids.d15a, folder: 'sent' }))
            .rejects.toMatchObject({ code: 'not_found' });
        await expect(email.get.call(email, 'nope')).rejects.toMatchObject({ code: 'invalid_request' });
        await expect(email.get.call(email, {})).rejects.toMatchObject({ code: 'invalid_request' });
    });
});
