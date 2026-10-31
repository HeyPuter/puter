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

import { describe, expect, it } from 'vitest';
import { HttpError } from '../../core/http/HttpError.js';
import {
    mergeNotifCatchUp,
    notifFetchCursor,
    notifFetchPosition,
    projectNotifRow,
    resolveNotifFetch,
} from './notifFetch.js';

const USER = '11111111-1111-4111-8111-111111111111';
const APP = 'app-22222222-2222-4222-8222-222222222222';

describe('resolveNotifFetch', () => {
    it('expands the two-segment form from the actor', () => {
        expect(
            resolveNotifFetch('notif:account', {
                userUuid: USER,
                appUid: null,
            }),
        ).toEqual({
            subject: `notif:${USER}:account`,
            audience: 'account',
            appUid: null,
        });

        // An app names its own rows by not naming an app at all.
        expect(
            resolveNotifFetch('notif:app-user', {
                userUuid: USER,
                appUid: APP,
            }),
        ).toEqual({
            subject: `notif:${APP}:app-user`,
            audience: 'app-user',
            appUid: APP,
        });
    });

    it('spans every app for a session\'s own developer/app-user slice', () => {
        // Neither audience falls back to the recipient the way `account`
        // does, so pinning to `null` would ask for rows that structurally
        // cannot exist — the fetch has to span every app instead.
        for (const audience of ['developer', 'app-user']) {
            expect(
                resolveNotifFetch(`notif:${audience}`, {
                    userUuid: USER,
                    appUid: null,
                }),
            ).toEqual({
                subject: `notif:${USER}:${audience}`,
                audience,
                appUid: undefined,
            });
        }
    });

    it('reads a fully qualified subject as written', () => {
        expect(
            resolveNotifFetch(`notif:${APP}:developer`, {
                userUuid: USER,
                appUid: null,
            }),
        ).toEqual({
            subject: `notif:${APP}:developer`,
            audience: 'developer',
            appUid: APP,
        });
    });

    it('refuses a family with no store rather than answering empty', () => {
        for (const subject of ['fs:/alice/notes.txt', 'kv:cart']) {
            let thrown: unknown;
            try {
                resolveNotifFetch(subject, { userUuid: USER, appUid: null });
            } catch (err) {
                thrown = err;
            }
            expect(thrown).toBeInstanceOf(HttpError);
            expect((thrown as HttpError).legacyCode).toBe(
                'fetch_unsupported_subject',
            );
        }
    });
});

describe('projectNotifRow', () => {
    const row = {
        uid: 'notif-uid',
        type: 'share.received',
        audience: 'account',
        app_uid: null,
        value: { title: 'shared with you' },
        created_at: '2026-08-30 01:02:03',
    };

    it('projects a row into the shape a live delivery has', () => {
        expect(projectNotifRow(row, USER, 3)).toEqual({
            id: 'notif-uid',
            subject: `notif:${USER}:account`,
            op: 'post',
            uid: 'notif-uid',
            type: 'share.received',
            audience: 'account',
            appUid: null,
            notification: { title: 'shared with you' },
            self: true,
            ts: Date.UTC(2026, 7, 30, 1, 2, 3),
            seq: 3,
        });
    });

    it('reads a bare SQL timestamp as UTC, not as local time', () => {
        // Engines hand back a Date, an epoch, or a zoneless string; all three
        // name the same instant and must project to it.
        const asDate = projectNotifRow(
            { ...row, created_at: new Date(Date.UTC(2026, 7, 30, 1, 2, 3)) },
            USER,
            0,
        );
        const asEpochSeconds = projectNotifRow(
            { ...row, created_at: Date.UTC(2026, 7, 30, 1, 2, 3) / 1000 },
            USER,
            0,
        );
        expect(asDate.ts).toBe(Date.UTC(2026, 7, 30, 1, 2, 3));
        expect(asEpochSeconds.ts).toBe(Date.UTC(2026, 7, 30, 1, 2, 3));
    });

    it('versions a replaced row by its replacement time', () => {
        // Postgres hands a bigint back as a string.
        for (const replacedAt of [1_790_000_000_123, '1790000000123']) {
            const projected = projectNotifRow(
                { ...row, replaced_at: replacedAt },
                USER,
                0,
            );
            expect(projected).toMatchObject({
                replaced: true,
                ts: 1_790_000_000_123,
            });
        }
        expect(
            projectNotifRow({ ...row, replaced_at: null }, USER, 0),
        ).not.toHaveProperty('replaced');
    });

    it('names the app when the row is about one', () => {
        const projected = projectNotifRow(
            { ...row, audience: 'app-user', app_uid: APP },
            USER,
            0,
        );
        expect(projected.subject).toBe(`notif:${APP}:app-user`);
        expect(projected.appUid).toBe(APP);
    });
});

describe('notifFetchPosition', () => {
    it('starts the replacement mark from scratch on a cursor without one', () => {
        expect(notifFetchPosition({ id: 7 })).toEqual({
            id: 7,
            replaced: { replacedAt: 0, id: 0 },
        });
        expect(notifFetchPosition(undefined).id).toBeNull();
    });

    it('reads back what it wrote', () => {
        const position = { id: 9, replaced: { replacedAt: 1_500, id: 4 } };
        expect(notifFetchPosition(notifFetchCursor(position))).toEqual(
            position,
        );
    });
});

describe('mergeNotifCatchUp', () => {
    /** A row created at second `created`, replaced at `replaced` ms if set. */
    const row = (
        id: number,
        created: number,
        replaced: number | null = null,
    ) => ({
        id,
        uid: `n-${id}`,
        created_at: created,
        replaced_at: replaced,
    });
    const idsOf = (rows: Array<Record<string, unknown>>) =>
        rows.map((one) => one.id);
    const from = { id: 10, replaced: { replacedAt: 1_000, id: 0 } };

    it('merges both reads oldest first, and ends when both ran out', () => {
        const { rows, next } = mergeNotifCatchUp(
            [row(11, 2), row(12, 4)],
            [row(3, 1, 3_000)],
            5,
            from,
        );
        expect(idsOf(rows)).toEqual([11, 3, 12]);
        expect(next).toBeNull();
    });

    it('resumes each read after the last row it took', () => {
        const { rows, next } = mergeNotifCatchUp(
            [row(11, 2), row(12, 4), row(13, 6)],
            [row(3, 1, 3_000), row(5, 1, 5_000), row(4, 1, 7_000)],
            2,
            from,
        );
        expect(idsOf(rows)).toEqual([11, 3]);
        expect(next).toEqual({
            id: 11,
            replaced: { replacedAt: 3_000, id: 3 },
        });
    });

    it('keeps the mark while replacements behind it are still unread', () => {
        const { next } = mergeNotifCatchUp(
            [row(11, 2, 9_000), row(12, 4)],
            [row(3, 9, 9_500), row(4, 9, 9_600)],
            1,
            from,
        );
        expect(next).toEqual({ id: 11, replaced: from.replaced });
    });

    it('moves the mark past every row it read once no replacement is left behind', () => {
        // Row 11 was replaced before this read, so it went out as it stands
        // and the next read must not return it again.
        const { rows, next } = mergeNotifCatchUp(
            [row(11, 2, 8_000), row(12, 4), row(13, 6)],
            [],
            2,
            { id: null, replaced: { replacedAt: 0, id: 0 } },
        );
        expect(idsOf(rows)).toEqual([11, 12]);
        expect(next).toEqual({
            id: 12,
            replaced: { replacedAt: 8_000, id: 11 },
        });
    });
});
