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

/**
 * Turns what a user typed or pasted into a bare hostname: a URL like
 * `https://www.example.com/about` becomes `www.example.com`. The server
 * still validates the result.
 *
 * @param {unknown} raw
 * @returns {string} The hostname, or '' when nothing is left.
 */
export const normalizeHostnameInput = (raw) => String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^[^@/?#]*@/, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d*$/, '')
    .replace(/\.+$/, '');

/**
 * Whether a normalized hostname is worth sending: something with a dot and
 * no whitespace. Anything subtler is the server's call.
 *
 * @param {string} hostname
 * @returns {boolean}
 */
export const isPlausibleHostname = (hostname) =>
    /^[^\s.]+(\.[^\s.]+)+$/.test(hostname);
