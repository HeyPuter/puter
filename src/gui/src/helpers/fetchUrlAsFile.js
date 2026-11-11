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

export const URL_SAVE_MAX_BYTES = 100 * 1024 * 1024;
// Without progress: the clock restarts with every chunk received.
export const URL_SAVE_TIMEOUT_MS = 60_000;

const urlSaveError = (code) => Object.assign(new Error(code), { code });

/**
 * Downloads an http(s) URL that an app or website asked to save, as a File
 * named `name`. Sent without cookies or a referrer, so the target sees an
 * anonymous request, and it must allow this origin through CORS.
 *
 * Rejects with an Error whose `code` is `url_save_invalid_url`,
 * `url_save_too_large` or `url_save_failed`.
 *
 * @param {string} url
 * @param {string} name
 * @param {{ maxBytes?: number, timeoutMs?: number }} [options]
 * @returns {Promise<File>}
 */
export default async function fetchUrlAsFile (url, name, { maxBytes = URL_SAVE_MAX_BYTES, timeoutMs = URL_SAVE_TIMEOUT_MS } = {}) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw urlSaveError('url_save_invalid_url');
    }
    if ( parsed.protocol !== 'https:' && parsed.protocol !== 'http:' ) {
        throw urlSaveError('url_save_invalid_url');
    }

    const controller = new AbortController();
    let timer;
    const restartTimer = () => {
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(), timeoutMs);
    };
    restartTimer();
    try {
        const response = await fetch(parsed.href, {
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            cache: 'no-store',
            signal: controller.signal,
        });
        if ( ! response.ok ) throw urlSaveError('url_save_failed');
        if ( Number(response.headers.get('content-length')) > maxBytes ) {
            throw urlSaveError('url_save_too_large');
        }

        if ( ! response.body ) return new File([], name);
        const chunks = [];
        let total = 0;
        const reader = response.body.getReader();
        for ( ;; ) {
            const { done, value } = await reader.read();
            if ( done ) break;
            restartTimer();
            total += value.byteLength;
            if ( total > maxBytes ) {
                controller.abort();
                throw urlSaveError('url_save_too_large');
            }
            chunks.push(value);
        }
        return new File(chunks, name);
    } catch ( err ) {
        // Network, CORS and timeout failures all surface as one code.
        if ( err?.code?.startsWith?.('url_save_') ) throw err;
        throw urlSaveError('url_save_failed');
    } finally {
        clearTimeout(timer);
    }
}
