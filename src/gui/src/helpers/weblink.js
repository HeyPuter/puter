/**
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

import UIWindow from '../UI/UIWindow.js';
import UIAlert from '../UI/UIAlert.js';

// Icons are stored inline in the .weblink JSON as base64 data URLs. Because a
// .weblink file can be shared or downloaded, its icon field is untrusted input
// and is re-validated with isValidWeblinkIcon() every time it is read.
const WEBLINK_ICON_ALLOWLIST = [
    'data:image/png;base64,',
    'data:image/jpeg;base64,',
    'data:image/gif;base64,',
    'data:image/webp;base64,',
    'data:image/svg+xml;base64,',
];

// Raster icons are downscaled to a small PNG before storing so the icon stays
// a few KB rather than embedding a full-resolution photo into the file/DOM.
const WEBLINK_ICON_MAX_DIMENSION = 256;

// SVG icons are kept as vectors, but capped so a pathological SVG (e.g. one
// with an embedded base64 raster) can't bloat the file; oversized ones fall
// back to rasterization.
const WEBLINK_ICON_MAX_SVG_BYTES = 512 * 1024;

const WEBLINK_VERSION = '2.1';

// Cache the resolved icon per file so a folder full of weblinks doesn't fetch
// every file's contents on each render/refresh. Keyed by path; entries are
// refreshed when changeWeblinkIcon writes a new icon.
const weblinkIconCache = new Map();

export const defaultWeblinkIcon = () => window.icons['link.svg'];

export const isWeblinkName = (name) =>
    typeof name === 'string' && name.toLowerCase().endsWith('.weblink');

export const isValidWeblinkIcon = (icon) => {
    if ( typeof icon !== 'string' || icon.length === 0 ) {
        return false;
    }

    if ( icon === defaultWeblinkIcon() ) {
        return true;
    }

    const lower = icon.toLowerCase();
    const prefix = WEBLINK_ICON_ALLOWLIST.find(p => lower.startsWith(p));
    if ( !prefix ) {
        return false;
    }

    // The body must be pure base64. This rejects anything containing a quote,
    // space or angle bracket, which is what stops a crafted icon value from
    // breaking out of an `<img src="...">` attribute (DOM XSS).
    const body = icon.slice(prefix.length);
    return body.length > 0 && /^[a-z0-9+/]+={0,2}$/i.test(body);
};

export const createWeblinkData = ({ url, domain, linkName, simpleName, icon = defaultWeblinkIcon() }) => ({
    url: url,
    type: 'weblink',
    domain: domain,
    icon: isValidWeblinkIcon(icon) ? icon : defaultWeblinkIcon(),
    created: Date.now(),
    modified: Date.now(),
    version: WEBLINK_VERSION,
    metadata: {
        originalUrl: url,
        linkName: linkName,
        simpleName: simpleName,
    },
});

export const parseWeblinkData = async (content) => {
    const text = typeof content === 'string' ? content : await content.text();

    try {
        return JSON.parse(text);
    } catch (e) {
        if ( text.startsWith('http://') || text.startsWith('https://') ) {
            const url = new URL(text);
            const domain = url.hostname;
            const simpleName = domain.replace(/^www\./, '').split('.')[0];
            const linkName = simpleName.charAt(0).toUpperCase() + simpleName.slice(1);

            return createWeblinkData({
                url: text,
                domain: domain,
                linkName: linkName,
                simpleName: simpleName,
            });
        }

        throw e;
    }
};

export const readWeblinkData = async (path) => {
    const content = await puter.fs.read({ path: path });
    return parseWeblinkData(content);
};

const readFileAsDataUrl = async (file) => await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
});

// Read the first bytes of a blob as text so we can sniff SVG source. Returns ''
// if the blob doesn't support slicing (nothing is treated as SVG in that case).
const readHead = async (file) => {
    if ( !file?.slice || !file?.arrayBuffer ) {
        return '';
    }
    try {
        return new TextDecoder('utf-8', { fatal: false }).decode(await file.slice(0, 512).arrayBuffer());
    } catch (e) {
        return '';
    }
};

// Rasterize any browser-decodable image down to a small PNG data URL. Used for
// raster formats (and as a size-capping fallback for oversized SVGs); it bounds
// the stored size and yields a single known-safe type.
const rasterizeToPngDataUrl = async (dataUrl) => await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
        try {
            const srcW = img.naturalWidth || img.width || WEBLINK_ICON_MAX_DIMENSION;
            const srcH = img.naturalHeight || img.height || WEBLINK_ICON_MAX_DIMENSION;
            const scale = Math.min(1, WEBLINK_ICON_MAX_DIMENSION / Math.max(srcW, srcH));
            const w = Math.max(1, Math.round(srcW * scale));
            const h = Math.max(1, Math.round(srcH * scale));

            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);

            resolve(canvas.toDataURL('image/png'));
        } catch (e) {
            reject(e);
        }
    };
    img.onerror = () => reject(new Error('Please choose a PNG, JPG, GIF, WebP, or SVG image.'));
    img.src = dataUrl;
});

const readIconFromFsEntry = async (fsentry) => {
    const file = await puter.fs.read(fsentry.path);
    const head = await readHead(file);

    // Keep SVGs as vectors — they stay crisp at any size/DPI and render
    // script-free in <img>. Rasterize everything else (and oversized SVGs) to a
    // small PNG so the stored icon stays a few KB.
    if ( head.toLowerCase().includes('<svg') && file.size <= WEBLINK_ICON_MAX_SVG_BYTES ) {
        const dataUrl = await readFileAsDataUrl(file);
        const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        const svgIcon = `data:image/svg+xml;base64,${base64}`;

        if ( isValidWeblinkIcon(svgIcon) ) {
            return svgIcon;
        }
    }

    const icon = await rasterizeToPngDataUrl(await readFileAsDataUrl(file));

    if ( !isValidWeblinkIcon(icon) ) {
        throw new Error('Please choose a PNG, JPG, GIF, WebP, or SVG image.');
    }

    return icon;
};

// Opens Puter's built-in file picker and resolves with a validated icon data
// URL, or null if the user dismisses the dialog. The picker is parented to the
// item's own window (or a lightweight receiver on the Desktop) and always tears
// down via on_close, so no promise or DOM node is ever leaked on cancel.
export const chooseWeblinkIcon = async (elItem) => await new Promise((resolve, reject) => {
    const $parentWindow = $(elItem).closest('.window');
    const hasParentWindow = $parentWindow.length > 0;

    let $receiver;
    let parentUuid;
    if ( hasParentWindow ) {
        $receiver = $parentWindow;
        parentUuid = $parentWindow.attr('data-element_uuid');
    } else {
        parentUuid = `weblink-icon-picker-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        $receiver = $('<div>')
            .addClass('window')
            .attr('data-element_uuid', parentUuid)
            .css('display', 'none')
            .appendTo('body');
    }

    let settled = false;
    let filePicked = false;

    const cleanup = () => {
        $receiver.off('file_opened', onFileOpened);
        if ( !hasParentWindow ) {
            $receiver.remove();
        }
    };

    const finish = (fn, value) => {
        if ( settled ) return;
        settled = true;
        cleanup();
        fn(value);
    };

    async function onFileOpened (e) {
        // Set synchronously (before the first await) so on_close, which fires
        // right after selection, does not resolve null and discard the result.
        filePicked = true;
        try {
            const selectedFile = Array.isArray(e.detail) ? e.detail[0] : e.detail;

            if ( !selectedFile?.path ) {
                finish(resolve, null);
                return;
            }

            finish(resolve, await readIconFromFsEntry(selectedFile));
        } catch (error) {
            finish(reject, error);
        }
    }

    $receiver.on('file_opened', onFileOpened);

    UIWindow({
        path: `/${window.user.username}/Desktop`,
        parent_uuid: parentUuid,
        parent_center: hasParentWindow,
        center: !hasParentWindow,
        allowed_file_types: 'image/*',
        show_maximize_button: false,
        show_minimize_button: false,
        title: i18n('window_title_open'),
        is_dir: true,
        is_openFileDialog: true,
        selectable_body: false,
        backdrop: true,
        close_on_backdrop_click: true,
        stay_on_top: true,
        // Fires on any dismissal (cancel button, X, backdrop, Escape).
        on_close: () => {
            if ( !filePicked ) finish(resolve, null);
        },
    }).catch((error) => finish(reject, error));
});

export const updateWeblinkIcon = async ({ path, icon }) => {
    const data = await readWeblinkData(path);
    data.icon = icon;
    data.modified = Date.now();
    data.version = WEBLINK_VERSION;

    await puter.fs.write(path, JSON.stringify(data), { overwrite: true });
    return data;
};

export const changeWeblinkIcon = async (elItem) => {
    const $item = $(elItem);
    const icon = await chooseWeblinkIcon(elItem);

    if ( !icon ) {
        return null;
    }

    const path = $item.attr('data-path');
    await updateWeblinkIcon({ path, icon });

    // Update every live view of this item (Desktop + any open folder windows),
    // not just the clicked one, so the icon doesn't look stale elsewhere.
    const uid = $item.attr('data-uid');
    const $views = uid ? $(`.item[data-uid="${uid}"]`) : $item;
    $views.find('.item-icon > img').attr('src', icon);
    $views.attr('data-icon', icon);

    weblinkIconCache.set(path, icon);

    return icon;
};

export const getWeblinkIcon = async (fsentry) => {
    const path = fsentry.path;

    if ( !path ) {
        // Avoid a doomed puter.fs.read({ path: undefined }) for listing entries
        // that don't carry a path.
        return defaultWeblinkIcon();
    }

    if ( weblinkIconCache.has(path) ) {
        return weblinkIconCache.get(path);
    }

    try {
        const data = await readWeblinkData(path);
        const icon = data.icon ?? data.metadata?.icon;

        if ( isValidWeblinkIcon(icon) ) {
            weblinkIconCache.set(path, icon);
            return icon;
        }
    } catch (e) {
        // Older weblinks may contain only a URL or malformed legacy JSON.
    }

    return defaultWeblinkIcon();
};

// Shared "Change Icon" context-menu entry so UIItem and generate_file_context_menu
// stay in sync instead of duplicating the block.
export const weblinkChangeIconMenuItem = (elItem) => ({
    html: i18n('change_icon'),
    onClick: async function () {
        try {
            await changeWeblinkIcon(elItem);
        } catch (error) {
            UIAlert(error.message ?? 'Could not change the web link icon.');
        }
    },
});
