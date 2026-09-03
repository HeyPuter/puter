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

// App icons come from the backend as two URLs: `iconCdnUrl` points straight at
// the icons hosting subdomain, and `icon`/`iconUrl` at the API's /app-icon
// endpoint, which redirects there. We load the direct URL and keep the
// endpoint as a retry — the direct one skips a redirect some networks mangle,
// the endpoint covers apps whose sized variant was never generated (it falls
// back to the original, or serves the icon inline).

const FALLBACK_ATTR = 'data-icon-fallback';

/**
 * Pick the URL to load an app's icon from, plus the one URL to retry with.
 *
 * @param {Object} app - App record from the backend (taskbar item, launch app,
 *   installedApps row). Reads `iconCdnUrl` and `iconUrl`/`icon`.
 * @param {string} [defaultIcon] - Used when the app carries no icon at all.
 * @returns {{ src: string; fallback: string }} `fallback` is empty when there
 *   is nothing left to try.
 */
export function appIconSrc(app, defaultIcon = '') {
    const cdn = typeof app?.iconCdnUrl === 'string' ? app.iconCdnUrl : '';
    const endpoint =
        (typeof app?.iconUrl === 'string' ? app.iconUrl : '') ||
        (typeof app?.icon === 'string' ? app.icon : '');

    if (cdn && endpoint && cdn !== endpoint) {
        return { src: cdn, fallback: endpoint };
    }
    return { src: cdn || endpoint || defaultIcon, fallback: '' };
}

/**
 * The attribute that marks an `<img>` as retryable, ready to interpolate into
 * an HTML string (empty when there is no retry URL).
 *
 * @param {string} fallback
 * @returns {string}
 */
export function appIconFallbackAttr(fallback) {
    return fallback ? ` ${FALLBACK_ATTR}="${html_encode(fallback)}"` : '';
}

/**
 * `src` and the retry attribute in one go, for the common `<img
 * ${appIconAttrs(app, def)}>` case.
 *
 * @param {Object} app
 * @param {string} [defaultIcon]
 * @returns {string}
 */
export function appIconAttrs(app, defaultIcon = '') {
    const { src, fallback } = appIconSrc(app, defaultIcon);
    return `src="${html_encode(src)}"${appIconFallbackAttr(fallback)}`;
}

/**
 * Retry a failed app-icon `<img>` against its fallback URL, once. Returns
 * whether a retry was made.
 *
 * @param {HTMLImageElement} img
 * @returns {boolean}
 */
export function applyAppIconFallback(img) {
    const next = img?.dataset?.iconFallback;
    if (!next) return false;
    // One shot: a fallback that fails too must not loop.
    delete img.dataset.iconFallback;
    img.src = next;
    return true;
}

/**
 * Wire the retry for every app icon on the page. Called once at GUI init;
 * `error` doesn't bubble, hence the capture phase.
 *
 * @param {Document | Element} [root]
 */
export function installAppIconFallback(root = document) {
    root.addEventListener(
        'error',
        (event) => {
            const el = event.target;
            if (!el || el.tagName !== 'IMG') return;
            applyAppIconFallback(el);
        },
        true,
    );
}
