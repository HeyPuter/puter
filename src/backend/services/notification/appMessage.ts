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

/** The one notification type an app may create. */
export const APP_MESSAGE_TYPE = 'app.message';

export const APP_MESSAGE_TITLE_MAX = 120;
export const APP_MESSAGE_TEXT_MAX = 240;
export const APP_MESSAGE_ICON_MAX = 2048;
export const APP_MESSAGE_TARGET_MAX = 512;
export const APP_MESSAGE_DATA_MAX_BYTES = 1024;
export const APP_MESSAGE_GROUP_MAX = 64;
export const APP_MESSAGE_CHANNEL_MAX = 32;
export const APP_MESSAGE_TTL_MAX_SECONDS = 24 * 60 * 60;
export const APP_MESSAGE_TTL_DEFAULT_SECONDS = 60 * 60;

/** Creates one app may make for one user, per window. */
export const APP_MESSAGE_RATE_LIMITS = {
    perMinute: 30,
    perDay: 300,
} as const;

export type AppMessagePriority = 'normal';

/** An `app.message` value as stored, after normalization. */
export type AppMessage = {
    title: string;
    text?: string;
    /** An https URL. */
    icon?: string;
    /** A path inside the app, opened when the message is followed. */
    target?: string;
    data?: unknown;
    group?: string;
    channel?: string;
    sensitive?: boolean;
    priority: AppMessagePriority;
    ttl: number;
    /** The sending app, set by the server. */
    app?: AppMessageSender;
};

export type AppMessageSender = { uid: string; name?: string; icon?: string };

/** What a message says about its app, read off the app's row. */
export const appMessageSender = (
    uid: string,
    row: { name?: unknown; title?: unknown; icon?: unknown } | null | undefined,
): AppMessageSender => {
    const sender: AppMessageSender = { uid };
    // Cleaned before the empty check, so a title of only invisible characters still leaves a visible sender.
    const name = [row?.title, row?.name]
        .map((v) =>
            typeof v === 'string'
                ? [...cleanText(v)]
                      .slice(0, APP_MESSAGE_TITLE_MAX)
                      .join('')
                      .trim()
                : '',
        )
        .find((v) => v !== '');
    sender.name = name ?? uid;
    const icon = row?.icon;
    if (
        typeof icon === 'string' &&
        icon.startsWith('https://') &&
        icon.length <= APP_MESSAGE_ICON_MAX
    ) {
        sender.icon = icon;
    }
    return sender;
};

const FIELDS = new Set([
    'title',
    'text',
    'icon',
    'target',
    'data',
    'group',
    'channel',
    'sensitive',
    'priority',
    'ttl',
]);

const GROUP_PATTERN = /^[A-Za-z0-9._:-]+$/u;
const CHANNEL_PATTERN = /^[a-z0-9-]+$/u;
// Anything outside printable ASCII, or a backslash, in a target.
const TARGET_DISALLOWED = /[^\u0021-\u007e]|\\/u;
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/iu;
// Direction and zero-width formatting marks, and C0/C1 controls but newline.
const INVISIBLE =
    /[\u115f\u1160\u200b-\u200f\u202a-\u202e\u2066-\u2069\u2800\u3164\ufeff\uffa0]/gu;
const CONTROL_BUT_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/gu;

const invalid = (field: string, message: string): HttpError =>
    new HttpError(400, `\`${field}\` ${message}`, {
        legacyCode: 'bad_request',
        fields: { field },
    });

/**
 * Counts characters rather than UTF-16 units, so an emoji counts once. More
 * than two units per allowed character can't fit, and isn't counted.
 */
const exceedsChars = (value: string, max: number): boolean =>
    value.length > max && (value.length > 2 * max || [...value].length > max);

const optionalString = (
    input: Record<string, unknown>,
    field: string,
    max: number,
): string | undefined => {
    const value = input[field];
    if (value === undefined) return undefined;
    if (typeof value !== 'string') throw invalid(field, 'must be a string');
    if (exceedsChars(value, max)) {
        throw invalid(field, `may not exceed ${max} characters`);
    }
    return value;
};

const parseIcon = (input: Record<string, unknown>): string | undefined => {
    const icon = optionalString(input, 'icon', APP_MESSAGE_ICON_MAX);
    if (icon === undefined) return undefined;
    let parsed: URL;
    try {
        parsed = new URL(icon);
    } catch {
        throw invalid('icon', 'must be an https URL');
    }
    if (parsed.protocol !== 'https:') {
        throw invalid('icon', 'must be an https URL');
    }
    if (parsed.href.length > APP_MESSAGE_ICON_MAX) {
        throw invalid(
            'icon',
            `may not exceed ${APP_MESSAGE_ICON_MAX} characters`,
        );
    }
    return parsed.href;
};

const parseTarget = (input: Record<string, unknown>): string | undefined => {
    const target = optionalString(input, 'target', APP_MESSAGE_TARGET_MAX);
    if (target === undefined) return undefined;
    const path = target.split(/[?#]/u, 1)[0];
    // `//host` and `/\host` both read as another origin to a browser.
    if (
        !target.startsWith('/') ||
        target.startsWith('//') ||
        TARGET_DISALLOWED.test(target) ||
        path.split('/').some((segment) => DOT_SEGMENT.test(segment))
    ) {
        throw invalid('target', "must be a path within the app, like '/a/b'");
    }
    return target;
};

/** Drops invisible formatting marks and controls; newlines survive. */
export const cleanText = (value: string): string =>
    value
        .replace(/\r\n?/gu, '\n')
        .replace(INVISIBLE, '')
        .replace(CONTROL_BUT_NEWLINE, '');

/** Text with nothing visible in it is left out rather than stored. */
const parseText = (input: Record<string, unknown>): string | undefined => {
    const raw = input.text;
    if (raw === undefined) return undefined;
    if (typeof raw !== 'string') throw invalid('text', 'must be a string');
    const text = cleanText(raw);
    if (exceedsChars(text, APP_MESSAGE_TEXT_MAX)) {
        throw invalid(
            'text',
            `may not exceed ${APP_MESSAGE_TEXT_MAX} characters`,
        );
    }
    return text.trim() === '' ? undefined : text;
};

const parsePattern = (
    input: Record<string, unknown>,
    field: string,
    max: number,
    pattern: RegExp,
    allowed: string,
): string | undefined => {
    const value = optionalString(input, field, max);
    if (value === undefined) return undefined;
    if (!pattern.test(value)) {
        throw invalid(field, `may contain only ${allowed}`);
    }
    return value;
};

const parseTtl = (input: Record<string, unknown>): number => {
    const ttl = input.ttl;
    if (ttl === undefined) return APP_MESSAGE_TTL_DEFAULT_SECONDS;
    if (
        typeof ttl !== 'number' ||
        !Number.isInteger(ttl) ||
        ttl <= 0 ||
        ttl > APP_MESSAGE_TTL_MAX_SECONDS
    ) {
        throw invalid(
            'ttl',
            `must be a whole number of seconds from 1 to ${APP_MESSAGE_TTL_MAX_SECONDS}`,
        );
    }
    return ttl;
};

/** The stored form of an app's message, or a 400 naming the first bad field. */
export const parseAppMessage = (input: Record<string, unknown>): AppMessage => {
    for (const key of Object.keys(input)) {
        if (!FIELDS.has(key)) throw invalid(key, 'is not a known field');
    }

    const rawTitle = input.title;
    if (typeof rawTitle !== 'string') {
        throw invalid('title', 'is required and must be a string');
    }
    const title = cleanText(rawTitle.replace(/[\t\n\r]+/gu, ' ')).trim();
    if (title === '') throw invalid('title', 'may not be empty');
    if (exceedsChars(title, APP_MESSAGE_TITLE_MAX)) {
        throw invalid(
            'title',
            `may not exceed ${APP_MESSAGE_TITLE_MAX} characters`,
        );
    }

    const message: AppMessage = {
        title,
        priority: 'normal',
        ttl: parseTtl(input),
    };

    const text = parseText(input);
    if (text !== undefined) message.text = text;
    const icon = parseIcon(input);
    if (icon !== undefined) message.icon = icon;
    const target = parseTarget(input);
    if (target !== undefined) message.target = target;

    if (input.data !== undefined) {
        const serialized = JSON.stringify(input.data);
        if (
            serialized === undefined ||
            Buffer.byteLength(serialized, 'utf8') > APP_MESSAGE_DATA_MAX_BYTES
        ) {
            throw invalid(
                'data',
                `must be JSON of at most ${APP_MESSAGE_DATA_MAX_BYTES} bytes`,
            );
        }
        message.data = input.data;
    }

    const group = parsePattern(
        input,
        'group',
        APP_MESSAGE_GROUP_MAX,
        GROUP_PATTERN,
        'letters, digits and . _ : -',
    );
    if (group !== undefined) message.group = group;
    const channel = parsePattern(
        input,
        'channel',
        APP_MESSAGE_CHANNEL_MAX,
        CHANNEL_PATTERN,
        'lowercase letters, digits and -',
    );
    if (channel !== undefined) message.channel = channel;

    if (input.sensitive !== undefined) {
        if (typeof input.sensitive !== 'boolean') {
            throw invalid('sensitive', 'must be a boolean');
        }
        message.sensitive = input.sensitive;
    }

    if (input.priority !== undefined && input.priority !== 'normal') {
        throw invalid(
            'priority',
            input.priority === 'high'
                ? "'high' is not available to apps; use 'normal'"
                : "must be 'normal'",
        );
    }

    return message;
};
