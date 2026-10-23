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

import {
    APP_MESSAGE_TTL_DEFAULT_SECONDS,
    APP_MESSAGE_TYPE,
} from '../notification/appMessage.js';
import {
    shareNotifyCount,
    shareSendersFromFields,
} from '../share/shareNotifyTitle.js';
import type { PushMessage, PushTarget } from './types.js';

/** Under the 4 KB web push payload, with room for a provider to wrap it. */
export const PUSH_MESSAGE_MAX_BYTES = 3800;

/** How long a provider may hold one of Puter's own pushes. */
export const PUSH_DEFAULT_TTL_SECONDS = APP_MESSAGE_TTL_DEFAULT_SECONDS;

/** What a push is built from: one written notification. */
export interface PushSource {
    uid: string;
    type: string;
    value: Record<string, unknown>;
}

const str = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() !== '' ? value : undefined;

const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

/** "alice shared report.txt" for one named item, otherwise the stored title. */
const shareReceived = (source: PushSource): PushMessage | null => {
    const fields = record(source.value.fields);
    const senders = shareSendersFromFields(fields);
    const target = record(fields.target);
    const name = str(target.name);
    const path = str(target.path);
    const single = senders.length === 1 && shareNotifyCount(senders) === 1;
    const title =
        single && name
            ? `${senders[0].username} shared ${name}`
            : str(source.value.title);
    if (!title) return null;
    return {
        uid: source.uid,
        title,
        group: source.uid,
        ...(single && path ? { target: { path } } : {}),
        ttl: PUSH_DEFAULT_TTL_SECONDS,
        priority: 'normal',
    };
};

const storedTitle = (source: PushSource): PushMessage | null => {
    const title = str(source.value.title);
    if (!title) return null;
    return {
        uid: source.uid,
        title,
        group: source.uid,
        ttl: PUSH_DEFAULT_TTL_SECONDS,
        priority: 'normal',
    };
};

const appMessage = (
    source: PushSource,
    app: { uid: string; name: string },
): PushMessage | null => {
    const value = source.value;
    const title = str(value.title);
    if (!title) return null;
    const ttl = Number(value.ttl);
    const group = str(value.group);
    const base = {
        uid: source.uid,
        // Scoped to the app, so it can only ever replace its own pushes.
        group: group ? `${app.uid}:${group}` : source.uid,
        ttl:
            Number.isInteger(ttl) && ttl > 0
                ? ttl
                : APP_MESSAGE_TTL_DEFAULT_SECONDS,
        priority: 'normal' as const,
    };
    if (value.sensitive === true) {
        return {
            ...base,
            title: app.name,
            body: `New notification from ${app.name}`,
            target: { app: app.uid },
            sensitive: true,
        };
    }
    const target: PushTarget = { app: app.uid };
    const path = str(value.target);
    if (path) target.path = path;
    const body = str(value.text);
    const icon = str(value.icon);
    return {
        ...base,
        title,
        ...(body ? { body } : {}),
        ...(icon ? { icon } : {}),
        target,
        ...(value.data !== undefined ? { data: value.data } : {}),
    };
};

/** Null for a type with no push wording, or a value missing its title. */
export const buildPushMessage = (
    source: PushSource,
    app: { uid: string; name: string } | null,
): PushMessage | null => {
    switch (source.type) {
        case 'share.received':
            return shareReceived(source);
        case 'share.claimed':
        case 'app.worker.deployed':
        case 'app.worker.deployFailed':
        case 'app.events.ended':
        case 'app.events.suspended':
            return storedTitle(source);
        case APP_MESSAGE_TYPE:
            return app ? appMessage(source, app) : null;
        default:
            return null;
    }
};

const fits = (message: PushMessage): boolean =>
    Buffer.byteLength(JSON.stringify(message), 'utf8') <=
    PUSH_MESSAGE_MAX_BYTES;

/** Whole characters, so a surrogate pair is never split. */
const cut = (chars: string[], n: number): string => {
    if (n >= chars.length) return chars.join('');
    return n <= 0 ? '' : `${chars.slice(0, n - 1).join('')}…`;
};

/** Largest n in [0, max] whose build fits, or -1. */
const longestFitting = (
    max: number,
    build: (n: number) => PushMessage,
): number => {
    if (fits(build(max))) return max;
    if (max === 0 || !fits(build(0))) return -1;
    let lo = 0;
    let hi = max - 1;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (fits(build(mid))) lo = mid;
        else hi = mid - 1;
    }
    return lo;
};

/** Cuts body, then title, then icon; null when `data` alone leaves no room. */
export const fitPushMessage = (message: PushMessage): PushMessage | null => {
    if (fits(message)) return message;
    const titleChars = Array.from(message.title);
    const bodyChars = Array.from(message.body ?? '');
    const { body: _body, icon, ...rest } = message;
    for (const withIcon of icon === undefined ? [false] : [true, false]) {
        const build = (titleLen: number, bodyLen: number): PushMessage => {
            const text = cut(bodyChars, bodyLen);
            return {
                ...rest,
                title: cut(titleChars, titleLen),
                ...(text ? { body: text } : {}),
                ...(withIcon ? { icon } : {}),
            };
        };
        const bodyLen = longestFitting(bodyChars.length, (n) =>
            build(titleChars.length, n),
        );
        if (bodyLen >= 0) return build(titleChars.length, bodyLen);
        // A title cut to nothing is no push; keep at least one character.
        const titleLen = longestFitting(titleChars.length, (n) =>
            build(Math.max(1, n), 0),
        );
        if (titleLen >= 0) return build(Math.max(1, titleLen), 0);
    }
    return null;
};
