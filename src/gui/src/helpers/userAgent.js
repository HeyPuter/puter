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

/** @param {unknown} ua @returns {{ browser: string|null, os: string|null }} The common browsers and systems only */
export const parseUserAgent = (ua) => {
    if ( ! ua || typeof ua !== 'string' ) return { browser: null, os: null };
    let browser = null;
    if ( /Edg\//i.test(ua) ) browser = 'Edge';
    else if ( /OPR\/|Opera/i.test(ua) ) browser = 'Opera';
    else if ( /Chrome\//i.test(ua) && !/Chromium/i.test(ua) ) browser = 'Chrome';
    else if ( /Firefox\//i.test(ua) ) browser = 'Firefox';
    else if ( /Safari\//i.test(ua) && !/Chrome\//i.test(ua) ) browser = 'Safari';

    let os = null;
    if ( /Windows NT/i.test(ua) ) os = 'Windows';
    // iOS says "like Mac OS X" and Android says "Linux", so both are checked first.
    else if ( /iPhone|iPad|iPod/i.test(ua) ) os = 'iOS';
    else if ( /Android/i.test(ua) ) os = 'Android';
    else if ( /Mac OS X|Macintosh/i.test(ua) ) os = 'macOS';
    else if ( /Linux/i.test(ua) ) os = 'Linux';

    return { browser, os };
};

/** @param {{ browser: string|null, os: string|null }} ua @returns {string|null} */
export const formatBrowserOs = ({ browser, os }) => {
    if ( browser && os ) return `${browser} on ${os}`;
    return browser || os || null;
};
