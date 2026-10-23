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
const CONTROL_OR_SPACE = /[\u0000- \u007f\\]/u;

const invalid = (field: string, message: string): HttpError =>
    new HttpError(400, `\`${field}\` ${message}`, {
        legacyCode: 'bad_request',
        fields: { field },
    });

/** Length in characters rather than UTF-16 units, so an emoji counts once. */
const charLength = (value: string): number => [...value].length;

const optionalString = (
    input: Record<string, unknown>,
    field: string,
    max: number,
): string | undefined => {
    const value = input[field];
    if (value === undefined) return undefined;
    if (typeof value !== 'string') throw invalid(field, 'must be a string');
    if (charLength(value) > max) {
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
    return icon;
};

const parseTarget = (input: Record<string, unknown>): string | undefined => {
    const target = optionalString(input, 'target', APP_MESSAGE_TARGET_MAX);
    if (target === undefined) return undefined;
    // `//host` and `/\host` both read as another origin to a browser.
    if (
        !target.startsWith('/') ||
        target.startsWith('//') ||
        CONTROL_OR_SPACE.test(target)
    ) {
        throw invalid('target', "must be a path within the app, like '/a/b'");
    }
    return target;
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

/**
 * Validate an app's message and return it as stored. Throws a 400 naming the
 * first field that fails; unknown fields fail too, so the format only grows on
 * purpose. Text is stored as given and escaped where it is shown.
 */
export const parseAppMessage = (input: Record<string, unknown>): AppMessage => {
    for (const key of Object.keys(input)) {
        if (!FIELDS.has(key)) throw invalid(key, 'is not a known field');
    }

    const rawTitle = input.title;
    if (typeof rawTitle !== 'string') {
        throw invalid('title', 'is required and must be a string');
    }
    const title = rawTitle.trim();
    if (title === '') throw invalid('title', 'may not be empty');
    if (charLength(title) > APP_MESSAGE_TITLE_MAX) {
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

    const text = optionalString(input, 'text', APP_MESSAGE_TEXT_MAX);
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
