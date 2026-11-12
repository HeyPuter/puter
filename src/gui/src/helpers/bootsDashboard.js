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
 * path and `/app/<name>` boot the dashboard unless the URL carries a flow
 * only the desktop handles; `/dashboard` always does.
 *
 * @param {Object} location
 * @param {string} location.pathname
 * @param {URLSearchParams} location.searchParams
 * @param {boolean} location.inIframe
 * @param {boolean} location.embeddedInPopup
 * @returns {boolean}
 */
export function bootsDashboard ({ pathname, searchParams, inIframe, embeddedInPopup }) {
    if ( pathname === '/dashboard' || pathname === '/dashboard/' ) return true;
    const isAppLanding = /^\/app\/[^/]+\/?$/.test(pathname);
    if ( pathname !== '/' && !isAppLanding ) return false;
    const needsDesktop = embeddedInPopup
        || inIframe
        || searchParams.has('puter.fullpage')
        || searchParams.has('app');
    return !needsDesktop;
}
