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

// Client half of the Contact Us attachment rules. This is here to tell someone
// their 40 MB recording is too big before they wait for it to upload — the
// server re-derives every one of these decisions from the bytes it receives and
// is the only thing actually enforcing them. Keep the limits in step with
// src/backend/util/contactAttachments.ts.

/** Max files on one submission. */
export const MAX_ATTACHMENTS = 5;

/** Max size of any one file. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Max size of all files on one submission. */
export const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/**
 * Types the server's allow-list will accept. Used for the file picker's
 * `accept` filter and the pre-flight check; the server sniffs the payload
 * rather than believing `File.type`, so a mismatch here only ever costs a
 * clearer error message.
 */
export const ACCEPTED_ATTACHMENT_TYPES = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/quicktime',
    'video/webm',
];

/** `accept` attribute for the file input. */
export const ATTACHMENT_ACCEPT_ATTRIBUTE = ACCEPTED_ATTACHMENT_TYPES.join(',');

/**
 * Decide whether `file` can join `existing`.
 *
 * @param {{ name?: string, type?: string, size?: number }} file
 * @param {Array<{ size?: number }>} existing files already staged
 * @returns {{ ok: true } | { ok: false, error: string }} `error` is an i18n key
 */
export function checkAttachment (file, existing) {
    const staged = Array.isArray(existing) ? existing : [];

    if ( staged.length >= MAX_ATTACHMENTS ) {
        return { ok: false, error: 'contact_us_attachment_too_many' };
    }
    // A directory dropped onto the form arrives as a zero-byte entry with no
    // type; so does a file that vanished between the picker and the read.
    if ( ! file || ! file.size ) {
        return { ok: false, error: 'contact_us_attachment_unsupported' };
    }
    if ( ! ACCEPTED_ATTACHMENT_TYPES.includes(file.type) ) {
        return { ok: false, error: 'contact_us_attachment_unsupported' };
    }
    if ( file.size > MAX_ATTACHMENT_BYTES ) {
        return { ok: false, error: 'contact_us_attachment_too_large' };
    }

    const total = staged.reduce((sum, f) => sum + (f.size ?? 0), 0);
    if ( total + file.size > MAX_TOTAL_ATTACHMENT_BYTES ) {
        return { ok: false, error: 'contact_us_attachment_total_too_large' };
    }

    return { ok: true };
}

/**
 * Strip the `data:<type>;base64,` prefix off a FileReader result, leaving the
 * bare base64 the endpoint expects. Returns null for anything that isn't a
 * base64 data URL — a reader that produced something else has nothing sendable
 * in it.
 *
 * @param {unknown} dataUrl
 * @returns {string|null}
 */
export function base64FromDataUrl (dataUrl) {
    if ( typeof dataUrl !== 'string' ) return null;
    const comma = dataUrl.indexOf(',');
    if ( comma < 0 ) return null;
    if ( ! /^data:[^,]*;base64$/i.test(dataUrl.slice(0, comma)) ) return null;
    const payload = dataUrl.slice(comma + 1);
    return payload.length > 0 ? payload : null;
}
