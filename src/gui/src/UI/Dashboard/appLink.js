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

import { BUILTIN_PREFIX } from '../../helpers/appLaunchUrl.js';

/**
 * The address a My Apps tile points at.
 *
 * External tiles (website shortcuts) carry their site's address on the tile;
 * every other app lives at the GUI's own `/app/<name>` landing. A tile with
 * neither — a folder — has no address, and an empty string is how callers
 * learn there is nothing to show or copy.
 *
 * @param {{ appName?: string, targetLink?: string }} tile - the tile's dataset
 * @param {string} [origin] - origin to resolve `/app/<name>` against; omit for
 *   a root-relative link
 * @returns {string}
 */
export function appTileLink ({ appName, targetLink } = {}, origin = '') {
    if ( targetLink ) return targetLink;
    if ( ! appName ) return '';
    // encodeURIComponent, matching the /app/ URLs the tab opens elsewhere: a
    // copied link that differs from the opened one would be a trap.
    return `${origin}/app/${encodeURIComponent(appName)}`;
}

/**
 * The address a My Apps tile's "Copy link" copies: the app's own index_url.
 * Built-in apps have no address of their own, so they and tiles without an
 * index_url copy the tile's link instead.
 *
 * @param {{ appName?: string, targetLink?: string, indexUrl?: string }} tile - the tile's dataset
 * @param {string} [origin] - origin to resolve `/app/<name>` against
 * @returns {string}
 */
export function appCopyLink ({ appName, targetLink, indexUrl } = {}, origin = '') {
    if ( indexUrl && ! indexUrl.startsWith(BUILTIN_PREFIX) ) return indexUrl;
    return appTileLink({ appName, targetLink }, origin);
}
