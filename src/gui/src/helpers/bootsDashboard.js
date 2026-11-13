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
 * Whether a page load boots the dashboard instead of the desktop. The root
 * path and `/app/<name>` boot the dashboard unless the page is a popup, which
 * the desktop still handles; `/dashboard` always does. The server matches
 * these routes case-insensitively, so this does too.
 *
 * @param {Object} location
 * @param {string} location.pathname
 * @param {boolean} location.embeddedInPopup
 * @returns {boolean}
 */
export function bootsDashboard ({ pathname, embeddedInPopup }) {
    if ( /^\/dashboard\/?$/i.test(pathname) ) return true;
    const isAppLanding = /^\/app\/[^/]+\/?$/i.test(pathname);
    if ( pathname !== '/' && !isAppLanding ) return false;
    return !embeddedInPopup;
}
