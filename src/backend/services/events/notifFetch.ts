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

/**
 * One stored notification in the shape a live delivery has. `id` is the row's
 * uid on both paths, so a client that fetched a row and then received it can
 * tell they are the same notification.
 */
export const projectNotifRow = (
    row: Record<string, unknown>,
    userUuid: string,
    seq: number,
): ProjectedNotifEvent => {
    const appUid = (row.app_uid as string | null) ?? null;
    const audience = (row.audience as NotificationAudience) ?? 'account';
    return {
        id: String(row.uid),
        subject: `notif:${appUid ?? userUuid}:${audience}`,
        op: 'post',
        uid: String(row.uid),
        type: String(row.type ?? ''),
        audience,
        appUid,
        notification: (row.value ?? {}) as Record<string, unknown>,
        // A fetched row is always the caller's own mailbox.
        self: true,
        ts: epochMs(row.created_at),
        seq,
    };
};
