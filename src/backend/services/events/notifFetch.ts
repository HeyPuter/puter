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

import { HttpError } from '../../core/http/HttpError.js';
import type { NotificationAudience } from '../notification/notificationTypes.js';
import { resolveNotifAnchor, type NotifAnchorActor } from './anchors.js';
import type { ProjectedNotifEvent } from './registry.js';
import { parseSubject } from './subjects.js';

/**
 * Catching up is a query, not a delivery: a client that was away asks the
 * subject's own store what it missed and holds the cursor itself. Only a
 * subject with a durable store can answer, which today is `notif:` — the
 * `notification` table is the mailbox, and nothing else keeps a log.
 */

/** Which rows one fetch is asking for. */
export interface NotifFetchScope {
    /** Canonical subject, after any app-relative expansion. */
    subject: string;
    audience: NotificationAudience;
    /**
     * App the rows are about; `null` selects the rows naming no app,
     * `undefined` selects every app — a session's own generic slice, where the
     * audience predicate is what actually narrows the page.
     */
    appUid: string | null | undefined;
}

export const fetchUnsupportedSubject = (family: string): HttpError =>
    new HttpError(400, `Subject family cannot be fetched: ${family}`, {
        legacyCode: 'fetch_unsupported_subject',
    });

/**
 * Turn a fetch subject into the mailbox slice it names. Rejects rather than
 * returning an empty page for a family with no store behind it — a silent empty
 * page reads as "nothing happened", which is the one thing catch-up must never
 * say by accident.
 */
export const resolveNotifFetch = (
    subject: string,
    actor: NotifAnchorActor,
): NotifFetchScope => {
    const parsed = parseSubject(subject);
    if (parsed.family !== 'notif') throw fetchUnsupportedSubject(parsed.family);

    const anchor = resolveNotifAnchor(parsed, actor);
    return {
        subject: anchor.subject,
        audience: anchor.audience,
        appUid: anchor.anyApp
            ? undefined
            : anchor.appScoped
              ? anchor.ref
              : null,
    };
};

/**
 * SQL timestamps arrive as a `Date`, an epoch number, or a UTC string with no
 * zone marker depending on the engine; the last would otherwise be read as
 * local time.
 */
const epochMs = (value: unknown): number => {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
    if (typeof value === 'string') {
        const marked = /[Zz]|[+-]\d{2}:?\d{2}$/.test(value)
            ? value
            : `${value.replace(' ', 'T')}Z`;
        const parsed = Date.parse(marked);
        if (!Number.isNaN(parsed)) return parsed;
    }
    return 0;
};

type NotifRow = Record<string, unknown>;

/** Drivers hand a bigint back as a number or a string. */
const replacedAtOf = (row: NotifRow): number | null =>
    row.replaced_at === null || row.replaced_at === undefined
        ? null
        : Number(row.replaced_at);

/** A row's `ts`: when it was replaced, or else when it was created. */
const rowTs = (row: NotifRow): number =>
    replacedAtOf(row) ?? epochMs(row.created_at);

/** A replacement's place in replacement order. */
interface ReplacedKey {
    replacedAt: number;
    id: number;
}

/**
 * Where a catch-up resumes: after `id`, the last row read in insertion order
 * (null before the first page), and after `replaced`, the last replacement read
 * among the rows up to `id`.
 */
export interface NotifFetchPosition {
    id: number | null;
    replaced: ReplacedKey;
}

/** The position an opened cursor names. A missing part starts from scratch. */
export const notifFetchPosition = (
    cursor: Record<string, unknown> | undefined,
): NotifFetchPosition => {
    const id = Number(cursor?.id);
    const replacedAt = Number(cursor?.replacedAt);
    const replacedId = Number(cursor?.replacedId);
    return {
        id: Number.isSafeInteger(id) && id >= 0 ? id : null,
        replaced:
            Number.isSafeInteger(replacedAt) && Number.isSafeInteger(replacedId)
                ? { replacedAt, id: replacedId }
                : { replacedAt: 0, id: 0 },
    };
};

/** The cursor payload for `position`. */
export const notifFetchCursor = (
    position: NotifFetchPosition,
): Record<string, unknown> => ({
    id: position.id,
    replacedAt: position.replaced.replacedAt,
    replacedId: position.replaced.id,
});

const laterKey = (a: ReplacedKey, b: ReplacedKey): ReplacedKey =>
    a.replacedAt > b.replacedAt ||
    (a.replacedAt === b.replacedAt && a.id > b.id)
        ? a
        : b;

const replacedKeyOf = (row: NotifRow): ReplacedKey => ({
    replacedAt: replacedAtOf(row) ?? 0,
    id: Number(row.id),
});

/**
 * One catch-up page from its two reads, each `limit + 1` deep: `inserted`, the
 * rows after `from.id` in id order, and `replaced`, the rows up to it replaced
 * after `from.replaced`, in replacement order. Merged oldest first by `ts`.
 * `next` is where the following page starts, or null on the last page.
 */
export const mergeNotifCatchUp = (
    inserted: NotifRow[],
    replaced: NotifRow[],
    limit: number,
    from: NotifFetchPosition,
): { rows: NotifRow[]; next: NotifFetchPosition | null } => {
    const rows: NotifRow[] = [];
    let i = 0;
    let r = 0;
    while (
        rows.length < limit &&
        (i < inserted.length || r < replaced.length)
    ) {
        const takeReplaced =
            r < replaced.length &&
            (i === inserted.length || rowTs(replaced[r]) < rowTs(inserted[i]));
        rows.push(takeReplaced ? replaced[r++] : inserted[i++]);
    }
    if (i === inserted.length && r === replaced.length)
        return { rows, next: null };

    // With every replacement behind `from.id` read, each row up to the new id
    // was read as it stands, so the mark moves past all of them.
    const mark =
        r === replaced.length
            ? rows
                  .filter((row) => replacedAtOf(row) !== null)
                  .map(replacedKeyOf)
                  .reduce(laterKey, from.replaced)
            : r > 0
              ? replacedKeyOf(replaced[r - 1])
              : from.replaced;
    return {
        rows,
        next: {
            id: i > 0 ? Number(inserted[i - 1].id) : from.id,
            replaced: mark,
        },
    };
};

/**
 * One stored notification in the shape a live delivery has. `id` is the row's
 * uid on both paths, so a client that fetched a row and then received it can
 * tell they are the same notification.
 */
export const projectNotifRow = (
    row: NotifRow,
    userUuid: string,
    seq: number,
): ProjectedNotifEvent => {
    const appUid = (row.app_uid as string | null) ?? null;
    const audience = (row.audience as NotificationAudience) ?? 'account';
    const replacedAt = replacedAtOf(row);
    return {
        id: String(row.uid),
        subject: `notif:${appUid ?? userUuid}:${audience}`,
        op: 'post',
        uid: String(row.uid),
        type: String(row.type ?? ''),
        audience,
        appUid,
        notification: (row.value ?? {}) as Record<string, unknown>,
        ...(replacedAt !== null ? { replaced: true as const } : {}),
        // A fetched row is always the caller's own mailbox.
        self: true,
        ts: rowTs(row),
        seq,
    };
};
