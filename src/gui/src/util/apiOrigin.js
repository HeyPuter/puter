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

const LOOPBACK_HOSTNAMES = new Set(['localhost', '[::1]', '::1']);
const LOOPBACK_IPV4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/**
 * Is this origin a Puter served off the developer's own machine?
 *
 * @param {string} [origin] - An absolute origin, e.g. `https://puter.com`.
 * @returns {boolean}
 */
export const isLoopbackOrigin = (origin) => {
    let hostname;
    try {
        hostname = new URL(origin).hostname;
    } catch (e) {
        return false;
    }

    return LOOPBACK_HOSTNAMES.has(hostname) ||
        hostname.endsWith('.localhost') ||
        LOOPBACK_IPV4.test(hostname);
};

/**
 * The API origin the GUI talks to.
 *
 * Normally this deployment's own configured origin, and nothing else: an
 * origin named by the URL would let a link resolve the signed-in desktop --
 * `whoami` included -- against a server we don't control. Apps may repoint
 * their own SDK instance; the GUI may not.
 *
 * The one exception is a Puter served from the developer's own machine, where
 * `npm start -- --server` drives a local GUI against a remote backend. That
 * choice sticks for the rest of the session, so the caller persists whatever
 * comes back when it differs from the configured origin, and passes it here as
 * `storedOrigin` on later boots.
 *
 * @param {object} params
 * @param {string} params.configuredOrigin - Server-templated `api_origin`.
 * @param {string} params.guiOrigin - Origin this page is served from.
 * @param {string|null} [params.urlOrigin] - `?api_origin=` from the URL.
 * @param {string|null} [params.storedOrigin] - Origin kept from a past boot.
 * @returns {string}
 */
export const resolveAPIOrigin = ({
    configuredOrigin,
    guiOrigin,
    urlOrigin,
    storedOrigin,
}) => {
    if (!isLoopbackOrigin(guiOrigin)) return configuredOrigin;
    return urlOrigin || storedOrigin || configuredOrigin;
};
