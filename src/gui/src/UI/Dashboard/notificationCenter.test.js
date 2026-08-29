/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { describe, it, expect } from 'vitest';
import {
    badgeLabel,
    formatAbsoluteTime,
    formatRelativeTime,
    glyphKey,
    isShareNotification,
    isUnread,
    mergeEntries,
    notificationTarget,
    parseCreatedAt,
    planBurstToasts,
    reconcileWithServer,
    setReadAt,
    sortEntries,
    titleWithBadge,
    toEntry,
    unreadCount,
} from './notificationCenter.js';

const NOW = Date.UTC(2026, 7, 27, 12, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const entry = (uid, createdAt, extra = {}) => ({
    uid,
    notification: { title: uid },
    createdAt,
    readAt: null,
    receivedAt: NOW,
    ...extra,
});

describe('parseCreatedAt', () => {
    it('reads SQLite timestamps as UTC', () => {
        expect(parseCreatedAt('2026-08-27 12:00:00')).toBe(NOW);
        expect(parseCreatedAt('2026-08-27 12:00:00.000')).toBe(NOW);
    });

    it('reads ISO strings and Date objects', () => {
        expect(parseCreatedAt('2026-08-27T12:00:00.000Z')).toBe(NOW);
        expect(parseCreatedAt(new Date(NOW))).toBe(NOW);
    });

    it('accepts epoch seconds, milliseconds, and numeric strings', () => {
        expect(parseCreatedAt(NOW)).toBe(NOW);
        expect(parseCreatedAt(Math.floor(NOW / 1000))).toBe(Math.floor(NOW / 1000) * 1000);
        expect(parseCreatedAt(String(NOW))).toBe(NOW);
    });

    it('returns null for anything unreadable', () => {
        expect(parseCreatedAt(null)).toBeNull();
        expect(parseCreatedAt(undefined)).toBeNull();
        expect(parseCreatedAt('')).toBeNull();
        expect(parseCreatedAt('yesterday')).toBeNull();
        expect(parseCreatedAt(0)).toBeNull();
        expect(parseCreatedAt(NaN)).toBeNull();
        expect(parseCreatedAt({})).toBeNull();
        expect(parseCreatedAt(new Date('nope'))).toBeNull();
    });
});

describe('toEntry', () => {
    it('reads a driver row', () => {
        const out = toEntry({ uid: 'a', value: { title: 'hi' }, created_at: '2026-08-27 11:00:00' }, NOW);
        expect(out).toEqual({
            uid: 'a',
            notification: { title: 'hi' },
            createdAt: NOW - HOUR,
            readAt: null,
            receivedAt: NOW,
        });
    });

    it('reads when a row was acknowledged, in epoch seconds', () => {
        const readAt = NOW - 5 * MIN;
        const out = toEntry({ uid: 'a', value: {}, created_at: null, acknowledged: readAt / 1000 }, NOW);
        expect(out.readAt).toBe(readAt);
        expect(isUnread(out)).toBe(false);
        expect(isUnread(toEntry({ uid: 'b', value: {}, acknowledged: null }, NOW))).toBe(true);
    });

    it('reads a socket push as unread and dates it now when the payload carries no time', () => {
        const out = toEntry({ uid: 'a', notification: { title: 'hi' } }, NOW);
        expect(out.createdAt).toBe(NOW);
        expect(out.readAt).toBeNull();
        expect(out.notification).toEqual({ title: 'hi' });
    });

    it('keeps an unreadable time as unknown rather than guessing', () => {
        expect(toEntry({ uid: 'a', value: {}, created_at: 'garbage' }, NOW).createdAt).toBeNull();
        expect(toEntry({ uid: 'a', value: {}, created_at: null }, NOW).createdAt).toBeNull();
    });

    it('tolerates a missing or malformed payload', () => {
        expect(toEntry({ uid: 'a' }, NOW).notification).toEqual({});
        expect(toEntry({ uid: 'a', value: 'text' }, NOW).notification).toEqual({});
    });

    it('rejects anything without a uid', () => {
        expect(toEntry({ value: {} }, NOW)).toBeNull();
        expect(toEntry({ uid: '' }, NOW)).toBeNull();
        expect(toEntry(null, NOW)).toBeNull();
        expect(toEntry(undefined, NOW)).toBeNull();
    });

    it('leaves out worker notifications, listed or pushed', () => {
        const worker = { title: 'Successfully deployed https://x.puter.work', type: 'app.worker.deployed' };
        expect(toEntry({ uid: 'a', value: worker, created_at: '2026-08-27 12:00:00' }, NOW)).toBeNull();
        expect(toEntry({ uid: 'b', notification: worker }, NOW)).toBeNull();
        expect(toEntry({ uid: 'c', notification: { title: 'Failed to deploy x!', type: 'app.worker.deployFailed' } }, NOW)).toBeNull();
        expect(toEntry({ uid: 'd', notification: { type: 'share.received' } }, NOW)).not.toBeNull();
    });

    it('still leaves out worker notifications written before the type registry', () => {
        const worker = { title: 'Successfully deployed https://x.puter.work', source: 'worker', template: 'user-requesting-share' };
        expect(toEntry({ uid: 'a', value: worker, created_at: '2026-08-27 12:00:00' }, NOW)).toBeNull();
        expect(toEntry({ uid: 'b', notification: worker }, NOW)).toBeNull();
        expect(toEntry({ uid: 'c', notification: { ...worker, source: 'sharing' } }, NOW)).not.toBeNull();
    });
});

describe('sortEntries', () => {
    it('orders newest first and keeps undated entries on top', () => {
        const out = sortEntries([entry('old', NOW - DAY), entry('unknown', null), entry('new', NOW)]);
        expect(out.map((e) => e.uid)).toEqual(['unknown', 'new', 'old']);
    });

    it('is stable for equal times', () => {
        const out = sortEntries([entry('a', NOW), entry('b', NOW), entry('c', NOW)]);
        expect(out.map((e) => e.uid)).toEqual(['a', 'b', 'c']);
    });

    it('does not mutate its input', () => {
        const input = [entry('old', NOW - DAY), entry('new', NOW)];
        sortEntries(input);
        expect(input.map((e) => e.uid)).toEqual(['old', 'new']);
    });
});

describe('mergeEntries', () => {
    it('adds new uids and reports them', () => {
        const { entries, added, updated } = mergeEntries([entry('a', NOW - MIN)], [entry('b', NOW)]);
        expect(entries.map((e) => e.uid)).toEqual(['b', 'a']);
        expect(added.map((e) => e.uid)).toEqual(['b']);
        expect(updated).toEqual([]);
    });

    it('rewrites an existing uid in place without moving it', () => {
        const before = [entry('a', NOW), entry('b', NOW - HOUR)];
        const regrouped = entry('b', NOW + MIN, { notification: { title: 'two people shared' } });
        const { entries, added, updated } = mergeEntries(before, [regrouped]);
        expect(added).toEqual([]);
        expect(updated.map((e) => e.uid)).toEqual(['b']);
        expect(entries.map((e) => e.uid)).toEqual(['a', 'b']);
        expect(entries[1].notification.title).toBe('two people shared');
        expect(entries[1].createdAt).toBe(NOW - HOUR);
    });

    it('keeps the read state of an entry a push rewrites', () => {
        const before = [entry('a', NOW - HOUR, { readAt: NOW - MIN })];
        const { entries } = mergeEntries(before, [entry('a', NOW)]);
        expect(entries[0].readAt).toBe(NOW - MIN);
    });

    it('fills in a time it did not have', () => {
        const { entries } = mergeEntries([entry('a', null)], [entry('a', NOW - DAY)]);
        expect(entries[0].createdAt).toBe(NOW - DAY);
    });

    it('skips null arrivals and leaves the input untouched', () => {
        const before = [entry('a', NOW)];
        const { entries } = mergeEntries(before, [null, undefined]);
        expect(entries).toHaveLength(1);
        expect(entries[0]).not.toBe(before[0]);
    });
});

describe('reconcileWithServer', () => {
    it('drops what the server no longer lists', () => {
        const local = [entry('gone', NOW - DAY, { receivedAt: NOW - DAY }), entry('kept', NOW - HOUR)];
        const out = reconcileWithServer(local, [entry('kept', NOW - HOUR)], NOW);
        expect(out.map((e) => e.uid)).toEqual(['kept']);
    });

    it('keeps a just-pushed entry the listing raced', () => {
        const local = [entry('fresh', NOW, { receivedAt: NOW - 2_000 })];
        const out = reconcileWithServer(local, [entry('older', NOW - HOUR)], NOW);
        expect(out.map((e) => e.uid)).toEqual(['fresh', 'older']);
    });

    it('lets the grace window expire', () => {
        const local = [entry('stale', NOW, { receivedAt: NOW - 60_000 })];
        expect(reconcileWithServer(local, [], NOW)).toEqual([]);
    });

    it('adds what the server has that the client missed', () => {
        const out = reconcileWithServer([], [entry('a', NOW), entry('b', NOW - MIN)], NOW);
        expect(out.map((e) => e.uid)).toEqual(['a', 'b']);
    });

    it('takes the read state the server reports', () => {
        const local = [entry('a', NOW - HOUR)];
        const out = reconcileWithServer(local, [entry('a', NOW - HOUR, { readAt: NOW - MIN })], NOW);
        expect(out[0].readAt).toBe(NOW - MIN);
    });

    it('does not unread what was read while the listing was in flight', () => {
        const local = [
            entry('listed', NOW - HOUR, { readAt: NOW - 2_000 }),
            entry('fresh', NOW, { receivedAt: NOW - 1_000, readAt: NOW - 500 }),
        ];
        const server = [entry('elsewhere', NOW - MIN), entry('listed', NOW - HOUR)];
        const out = reconcileWithServer(local, server, NOW, 15_000, new Set(['listed', 'fresh', 'elsewhere']));
        expect(out.map((e) => [e.uid, e.readAt])).toEqual([
            ['fresh', NOW - 500],
            ['elsewhere', NOW],
            ['listed', NOW - 2_000],
        ]);
    });
});

describe('setReadAt', () => {
    it('marks one entry read and leaves the others', () => {
        const out = setReadAt([entry('a', NOW), entry('b', NOW)], 'a', NOW);
        expect(out.map((e) => e.readAt)).toEqual([NOW, null]);
    });

    it('can make an entry unread again', () => {
        const out = setReadAt([entry('a', NOW, { readAt: NOW })], 'a', null);
        expect(out[0].readAt).toBeNull();
    });

    it('does not mutate its input and keeps untouched entries by identity', () => {
        const input = [entry('a', NOW), entry('b', NOW)];
        const out = setReadAt(input, 'a', NOW);
        expect(input[0].readAt).toBeNull();
        expect(out[1]).toBe(input[1]);
        expect(setReadAt(input, 'zzz', NOW)).toEqual(input);
    });
});

describe('unreadCount', () => {
    it('counts only what has no read time', () => {
        expect(unreadCount([entry('a', NOW), entry('b', NOW, { readAt: NOW }), entry('c', NOW)])).toBe(2);
        expect(unreadCount([])).toBe(0);
    });
});

describe('isShareNotification', () => {
    it('accepts the server type and the markers that preceded it', () => {
        expect(isShareNotification({ type: 'share.received' })).toBe(true);
        expect(isShareNotification({ type: 'share.claimed' })).toBe(true);
        expect(isShareNotification({ source: 'sharing' })).toBe(true);
        expect(isShareNotification({ template: 'file-shared-with-you' })).toBe(true);
        expect(isShareNotification({ template: 'file-shared-before-you-joined' })).toBe(true);
    });

    it('refuses anything else', () => {
        expect(isShareNotification({ type: 'app.worker.deployed' })).toBe(false);
        expect(isShareNotification({ source: 'worker' })).toBe(false);
        expect(isShareNotification({})).toBe(false);
        expect(isShareNotification(null)).toBe(false);
        expect(isShareNotification('text')).toBe(false);
    });
});

describe('notificationTarget', () => {
    it('points a single share at its item', () => {
        expect(notificationTarget({
            type: 'share.received',
            fields: { target: { path: '/alice/0b1c2d3e-0000-4000-8000-000000000000/report.txt', name: 'report.txt' } },
        })).toEqual({ kind: 'shared-item', path: '/alice/0b1c2d3e-0000-4000-8000-000000000000/report.txt' });
    });

    it('points a grouped share at Shared', () => {
        expect(notificationTarget({ type: 'share.received', fields: { count: 3 } }))
            .toEqual({ kind: 'shared' });
    });

    it('points a share claimed after signup at Shared', () => {
        expect(notificationTarget({ type: 'share.claimed', fields: { count: 1 } }))
            .toEqual({ kind: 'shared' });
    });

    it('still reads shares written before the type registry', () => {
        expect(notificationTarget({
            source: 'sharing',
            template: 'file-shared-with-you',
            fields: { target: { path: '/alice/0b1c2d3e-0000-4000-8000-000000000000/report.txt' } },
        })).toEqual({ kind: 'shared-item', path: '/alice/0b1c2d3e-0000-4000-8000-000000000000/report.txt' });
        expect(notificationTarget({ source: 'sharing', template: 'file-shared-with-you', fields: { count: 3 } }))
            .toEqual({ kind: 'shared' });
        expect(notificationTarget({ template: 'file-shared-before-you-joined', fields: { count: 1 } }))
            .toEqual({ kind: 'shared' });
    });

    it('refuses a target that is not an absolute path', () => {
        expect(notificationTarget({ type: 'share.received', fields: { target: { path: 'https://evil' } } }))
            .toEqual({ kind: 'shared' });
        expect(notificationTarget({ type: 'share.received', fields: { target: { path: 42 } } }))
            .toEqual({ kind: 'shared' });
    });

    it('has nowhere to go for other notifications', () => {
        expect(notificationTarget({ type: 'app.worker.deployed', title: 'Deployed' })).toBeNull();
        expect(notificationTarget({ source: 'worker', title: 'Deployed' })).toBeNull();
        expect(notificationTarget({})).toBeNull();
        expect(notificationTarget(null)).toBeNull();
        expect(notificationTarget('text')).toBeNull();
    });
});

describe('glyphKey', () => {
    it('names the glyph for shares, by type or legacy marker', () => {
        expect(glyphKey({ type: 'share.received' })).toBe('sharing');
        expect(glyphKey({ type: 'share.claimed' })).toBe('sharing');
        expect(glyphKey({ source: 'sharing' })).toBe('sharing');
        expect(glyphKey({ template: 'file-shared-with-you' })).toBe('sharing');
    });

    it('falls back to the bell for anything else', () => {
        expect(glyphKey({ type: 'app.worker.deployed' })).toBe('default');
        expect(glyphKey({ source: 'billing' })).toBe('default');
        expect(glyphKey({})).toBe('default');
        expect(glyphKey(null)).toBe('default');
        expect(glyphKey({ source: 42 })).toBe('default');
    });

    it('never reaches into the prototype', () => {
        expect(glyphKey({ type: '__proto__' })).toBe('default');
        expect(glyphKey({ source: '__proto__' })).toBe('default');
        expect(glyphKey({ source: 'constructor' })).toBe('default');
        expect(glyphKey({ template: 'toString' })).toBe('default');
    });
});

describe('badgeLabel', () => {
    it('shows nothing for zero or nonsense', () => {
        expect(badgeLabel(0)).toBe('');
        expect(badgeLabel(-1)).toBe('');
        expect(badgeLabel(NaN)).toBe('');
        expect(badgeLabel(undefined)).toBe('');
    });

    it('shows the count and caps it', () => {
        expect(badgeLabel(1)).toBe('1');
        expect(badgeLabel(99)).toBe('99');
        expect(badgeLabel(100)).toBe('99+');
    });
});

describe('titleWithBadge', () => {
    it('prefixes the count', () => {
        expect(titleWithBadge('Puter', 3)).toBe('(3) Puter');
    });

    it('replaces an existing count instead of stacking', () => {
        expect(titleWithBadge('(2) Puter', 5)).toBe('(5) Puter');
        expect(titleWithBadge('(99+) Puter', 1)).toBe('(1) Puter');
    });

    it('clears the prefix at zero', () => {
        expect(titleWithBadge('(2) Puter', 0)).toBe('Puter');
        expect(titleWithBadge('Puter', 0)).toBe('Puter');
    });

    it('leaves a parenthesised title that is not a badge alone', () => {
        expect(titleWithBadge('(draft) Notes', 0)).toBe('(draft) Notes');
        expect(titleWithBadge('(draft) Notes', 2)).toBe('(2) (draft) Notes');
    });

    it('copes with an empty title', () => {
        expect(titleWithBadge('', 2)).toBe('(2) ');
        expect(titleWithBadge(undefined, 0)).toBe('');
    });
});

describe('formatRelativeTime', () => {
    it('describes the recent past in words', () => {
        expect(formatRelativeTime(NOW, NOW)).toBe('now');
        expect(formatRelativeTime(NOW - 30_000, NOW)).toBe('now');
        expect(formatRelativeTime(NOW - 5 * MIN, NOW)).toBe('5 minutes ago');
        expect(formatRelativeTime(NOW - 1 * MIN, NOW)).toBe('1 minute ago');
        expect(formatRelativeTime(NOW - 3 * HOUR, NOW)).toBe('3 hours ago');
        expect(formatRelativeTime(NOW - DAY, NOW)).toBe('yesterday');
        expect(formatRelativeTime(NOW - 3 * DAY, NOW)).toBe('3 days ago');
    });

    it('falls back to a short date past a week', () => {
        expect(formatRelativeTime(NOW - 10 * DAY, NOW)).toBe('Aug 17');
        expect(formatRelativeTime(NOW - 400 * DAY, NOW)).toBe('Jul 23, 2025');
    });

    it('never reports the future', () => {
        expect(formatRelativeTime(NOW + HOUR, NOW)).toBe('now');
    });

    it('localises', () => {
        expect(formatRelativeTime(NOW - 5 * MIN, NOW, 'fr')).toBe('il y a 5 minutes');
    });

    it('survives an unknown locale', () => {
        expect(formatRelativeTime(NOW - 5 * MIN, NOW, 'not-a-locale-!!')).toBe('5 minutes ago');
        expect(formatRelativeTime(NOW - 10 * DAY, NOW, 'not-a-locale-!!')).toBe('Aug 17');
    });
});

describe('formatAbsoluteTime', () => {
    it('spells out the moment', () => {
        expect(formatAbsoluteTime(NOW, 'en')).toMatch(/Aug 27, 2026/);
    });
});

describe('planBurstToasts', () => {
    const many = (n) => Array.from({ length: n }, (_, i) => entry(`n${i}`, NOW - i));

    it('shows a small burst in full', () => {
        expect(planBurstToasts(many(3))).toEqual({ shown: many(3), folded: 0 });
        expect(planBurstToasts([])).toEqual({ shown: [], folded: 0 });
    });

    it('does not fold a single extra into a summary of one', () => {
        expect(planBurstToasts(many(4)).folded).toBe(0);
        expect(planBurstToasts(many(4)).shown).toHaveLength(4);
    });

    it('caps a large burst and counts the rest', () => {
        const { shown, folded } = planBurstToasts(many(12));
        expect(shown.map((e) => e.uid)).toEqual(['n0', 'n1', 'n2']);
        expect(folded).toBe(9);
    });
});
