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

// Logo strip at the top of the login and signup windows. Inside a sign-in
// popup it pairs the opener site's favicon with the Puter logo, joined by a
// dashed line, so the user sees which site they are connecting to Puter.

// The tile renders at 40px; asking for more keeps it sharp on high-DPI
// screens when the site publishes a large (e.g. Apple touch) icon.
const FAVICON_SIZE = 256;

/**
 * Favicon lookup URL for a site, via Google's favicon service. Only the
 * origin is sent, never the full page URL. The `fallback_opts` let the
 * service answer with the nearest icon type and size it has instead of
 * failing when the exact one is missing.
 *
 * @param {string} origin - The opener's origin or any URL on it.
 * @returns {string} Empty when `origin` is not a URL.
 */
export function openerFaviconUrl(origin) {
    let url;
    try {
        url = new URL(origin);
    } catch (e) {
        return '';
    }
    if ( ! url.hostname ) return '';
    const params = new URLSearchParams({
        client: 'SOCIAL',
        type: 'FAVICON',
        fallback_opts: 'TYPE,SIZE,URL',
        url: url.origin,
        size: String(FAVICON_SIZE),
    });
    return `https://t3.gstatic.com/faviconV2?${params}`;
}

/**
 * The opener's tile: its favicon over a generic globe, so a failed or
 * placeholder favicon still leaves a recognisable "website" mark.
 *
 * @param {string} origin
 * @param {string} fallbackSrc
 * @returns {string}
 */
function openerLogoTile(origin, fallbackSrc) {
    let hostname = '';
    try {
        hostname = new URL(origin).hostname;
    } catch (e) {
        // fall through; the tile still renders with just the globe
    }

    let h = '';
    h += `<div class="auth-opener-logo" title="${html_encode(hostname)}">`;
    h += `<img src="${html_encode(fallbackSrc)}" alt="" class="auth-opener-logo-fallback">`;
    h += `<img src="${html_encode(openerFaviconUrl(origin))}" alt="" class="auth-opener-logo-img">`;
    h += '</div>';
    return h;
}

/**
 * Markup for the logo strip.
 *
 * @param {Object} options
 * @param {string} options.logoSrc - URL of the Puter logo.
 * @param {boolean} [options.logoClickable] - Adds the pointer cursor; the
 *   caller wires the click.
 * @param {string} [options.openerOrigin] - When set, the opener's favicon is
 *   rendered beside the Puter logo with a dashed connector between them.
 * @param {string} [options.openerFallbackSrc] - Generic website icon shown
 *   when the favicon is missing.
 * @returns {string}
 */
export function authLogoHeader({ logoSrc, logoClickable = false, openerOrigin = '', openerFallbackSrc = '' }) {
    const puterLogo = `<img src="${html_encode(logoSrc)}" class="auth-logo"${logoClickable ? ' style="cursor: pointer;"' : ''}>`;

    let h = '';
    h += `<div class="auth-logo-header${openerOrigin ? ' auth-logo-header-connected' : ''}">`;
    if ( openerOrigin ) {
        h += openerLogoTile(openerOrigin, openerFallbackSrc);
        h += '<div class="auth-logo-connector"></div>';
    }
    h += puterLogo;
    h += '</div>';
    return h;
}

// The service answers an unknown host with a 16px globe (as a 404 body the
// browser still renders). Nothing that small survives the 40px tile anyway.
const PLACEHOLDER_MAX_PX = 16;

/**
 * Whether a loaded favicon is worth showing over the globe.
 *
 * @param {{ naturalWidth: number, naturalHeight: number }} img
 * @returns {boolean}
 */
export function isUsableFavicon(img) {
    return img.naturalWidth > PLACEHOLDER_MAX_PX && img.naturalHeight > PLACEHOLDER_MAX_PX;
}

/**
 * Drop the opener favicon when it fails to load or is only a placeholder,
 * so the globe shows through. Call once the header is in the DOM.
 *
 * @param {Element} root - The window element containing the header.
 */
export function wireAuthLogoHeader(root) {
    for ( const img of root.querySelectorAll('.auth-opener-logo-img') ) {
        img.addEventListener('error', () => img.remove(), { once: true });
        img.addEventListener('load', () => {
            if ( ! isUsableFavicon(img) ) img.remove();
        }, { once: true });
        // Cached images can be complete before the listeners attach.
        if ( img.complete && img.naturalWidth > 0 && ! isUsableFavicon(img) ) img.remove();
    }
}

export default authLogoHeader;
