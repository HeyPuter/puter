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
 * The markup and layout of a Files listing: the folders sidebar, the
 * breadcrumbs, the rows, and how they are sorted, fitted and stepped through
 * with the keyboard. The dashboard's Files tab and the file pickers both draw
 * from here, so the two look and behave the same.
 */

import { formatRelativeTime } from '../../i18n/formatTime.js';
import { icons } from '../../helpers/actionIcons.js';
import parse_item_metadata from '../../helpers/parseItemMetadata.js';
import { is_owned_by_me } from '../../helpers/pathOwner.js';
import { shared_root_for } from '../../helpers/sharedAccess.js';
import { shared_crumbs_for } from '../../helpers/sharePaths.js';
import { isHiddenName } from './hiddenFiles.js';
import { middleTruncate } from './middleTruncate.js';
import { compareEntries, compareNames } from './sortEntries.js';
import { compareSharers, sharedByCellHtml } from './sharedBy.js';

const encode = (value) => window.html_encode(value);

/**
 * A byte count as the listing shows it, such as "1.5 MB". A missing,
 * invalid or non-positive size reads "0 B".
 *
 * @param {number|string|null|undefined} bytes
 * @returns {string}
 */
export function formatFileSize (bytes) {
    const num = Number(bytes);
    if ( ! Number.isFinite(num) || num <= 0 ) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    // Clamped: sizes past PB still read in PB.
    const i = Math.min(Math.floor(Math.log(num) / Math.log(k)), sizes.length - 1);
    return `${Math.round((num / Math.pow(k, i)) * 100) / 100 } ${ sizes[i]}`;
}

/**
 * @typedef {Object} SidebarPlace
 * @property {string} folder - The `data-folder` key, such as "Home"
 * @property {string} path
 * @property {string} icon - Icon file name in `window.icons`
 * @property {string} label - i18n key
 */

/** @returns {SidebarPlace[]} */
const sidebarPlaces = () => [
    { folder: 'Home', path: window.home_path, icon: 'folder-home.svg', label: 'home' },
    { folder: 'Desktop', path: window.desktop_path, icon: 'folder-desktop.svg', label: 'desktop' },
    { folder: 'Documents', path: window.docs_path, icon: 'folder-documents.svg', label: 'documents' },
    { folder: 'Pictures', path: window.pictures_path, icon: 'folder-pictures.svg', label: 'pictures' },
    { folder: 'Public', path: window.public_path, icon: 'folder-public.svg', label: 'public' },
    { folder: 'Videos', path: window.videos_path, icon: 'folder-videos.svg', label: 'videos' },
    { folder: 'Shared', path: window.shared_path, icon: 'folder-shared.svg', label: 'shared' },
    { folder: 'Trash', path: window.trash_path, icon: 'trash.svg', label: 'trash' },
];

/**
 * The folders sidebar: one entry per standard folder, then Shared, then Trash.
 *
 * @param {{ trash?: boolean }} [options] - `trash: false` leaves Trash out
 * @returns {string} HTML
 */
export function directoriesHtml ({ trash = true } = {}) {
    const items = sidebarPlaces()
        .filter(place => trash || place.folder !== 'Trash')
        .map(place => `<li data-folder="${place.folder}" tabindex="0" role="button" data-path="${encode(place.path)}"><img alt="" src="${encode(window.icons[place.icon])}"/> <span>${i18n(place.label)}</span></li>`)
        .join('\n');
    return `<div class="directories"><ul>${items}</ul></div>`;
}

/**
 * The breadcrumbs for a folder. Beneath the root there's no root crumb; the
 * Shared view is a single crumb; someone else's tree starts at Shared.
 *
 * @param {string} absPath
 * @param {{ nameFor?: (crumbPath: string) => string | undefined }} [options] -
 *   `nameFor` gives a crumb another name, such as a trashed folder's old one
 * @returns {string} HTML
 */
export function breadcrumbsHtml (absPath, { nameFor = () => undefined } = {}) {
    if ( absPath.endsWith('/') && absPath !== '/' ) {
        absPath = absPath.slice(0, -1);
    }
    const separator = `<img class="path-seperator" alt="" draggable="false" src="${encode(window.icons['triangle-right.svg'])}">`;
    const crumb = (crumbPath, label) => `${separator}<span class="dirname" tabindex="0" role="link" data-path="${encode(crumbPath)}">${label}</span>`;

    if ( absPath === window.shared_path ) {
        return crumb(window.shared_path, encode(i18n('shared')));
    }

    const shared = shared_crumbs_for(absPath);
    if ( shared ) {
        return crumb(window.shared_path, encode(i18n('shared')))
            + shared.map(c => crumb(c.path, encode(c.label))).join('');
    }

    if ( absPath === '/' ) {
        return crumb('/', encode(window.root_dirname));
    }

    const dirs = absPath.split('/');
    let str = '';
    let crumbPath = '';
    for ( let k = 1; k < dirs.length; k++ ) {
        crumbPath += `/${dirs[k]}`;
        const label = crumbPath === window.trash_path
            ? i18n('trash')
            : encode(nameFor(crumbPath) ?? dirs[k]);
        str += crumb(crumbPath, label);
    }
    return str;
}

/**
 * A listing row for an fsentry, with its data attributes and cells but no
 * event handlers. A trashed item shows the name it had before.
 *
 * @param {Object} file - The fsentry
 * @param {{ image: string, type: string }} iconResult - From item_icon()
 * @param {{ sharedView?: boolean }} [options] - `sharedView` adds the Shared by cell
 * @returns {HTMLDivElement}
 */
export function createFileRow (file, iconResult, { sharedView = false } = {}) {
    const item_id = window.global_element_id++;
    const metadata = parse_item_metadata(file.metadata);
    const displayName = metadata.original_name || file.name;
    const website_url = window.determine_website_url(file.path);
    // Listings give is_shortcut as a number; an upload's result leaves it out.
    const is_shortcut = file.is_shortcut ? 1 : 0;
    const is_worker = file.workers?.length > 0;
    const worker_url = is_worker ? file.workers[0]?.address : '';
    const icon = `<img alt=""${iconResult.type === 'thumb' ? ' class="row-thumb"' : ''} src="${encode(iconResult.image)}"/>`;
    const row = document.createElement('div');
    // A dot-file only gets here when hidden files show; `item-revealed` dims it.
    const revealedClass = isHiddenName(file.name) ? ' item-revealed' : '';
    row.setAttribute('class', `item row ${file.is_dir ? 'folder' : 'file'}${revealedClass}`);
    // setAttribute stores values as they are, so they stay unencoded.
    row.setAttribute('data-id', item_id);
    row.setAttribute('data-name', displayName);
    row.setAttribute('data-uid', file.uid);
    row.setAttribute('data-is_dir', file.is_dir ? '1' : '0');
    row.setAttribute('data-is_trash', file.is_trash ? '1' : '0');
    row.setAttribute('data-shared_with_me', file.shared_with_me ? '1' : '0');
    row.setAttribute('data-is_shared', file.is_shared === true ? '1' : '0');
    row.setAttribute('data-share_mode', file.share_mode ?? '');
    row.setAttribute('data-shared_by', file.shared_by ?? '');
    row.setAttribute('data-has_website', file.has_website ? '1' : '0');
    row.setAttribute('data-website_url', website_url || '');
    row.setAttribute('data-immutable', file.immutable ? '1' : '0');
    row.setAttribute('data-is_shortcut', is_shortcut);
    row.setAttribute('data-shortcut_to', file.shortcut_to ?? '');
    row.setAttribute('data-shortcut_to_path', file.shortcut_to_path ?? '');
    row.setAttribute('data-is_worker', is_worker ? '1' : '0');
    row.setAttribute('data-worker_url', is_worker ? worker_url : '0');
    row.setAttribute('data-sortable', file.sortable ?? 'true');
    row.setAttribute('data-metadata', JSON.stringify(metadata));
    row.setAttribute('data-sort_by', file.sort_by ?? 'name');
    row.setAttribute('data-size', file.size);
    row.setAttribute('data-type', file.type ?? '');
    row.setAttribute('data-modified', file.modified);
    row.setAttribute('data-associated_app_name', file.associated_app?.name ?? '');
    row.setAttribute('data-path', file.path);
    row.innerHTML = `
        <div class="item-checkbox"><span class="checkbox-icon"></span></div>
        <div class="item-icon">
            ${icon}
            <div class="item-shared-marker"
                style="${file.is_shared === true ? '' : 'display:none;'}"
                title="${encode(i18n('item_shared_by_you'))}"
            ></div>
        </div>
        <div class="item-badges">
            <img class="item-badge item-has-website-badge long-hover"
                style="${file.has_website && !is_worker ? 'display:block;' : ''}"
                src="${encode(window.icons['world.svg'])}"
                data-item-id="${item_id}"
            />
            <img class="item-badge item-has-website-url-badge"
                style="${website_url ? 'display:block;' : ''}"
                src="${encode(window.icons['link.svg'])}"
                data-item-id="${item_id}"
            >
            <img class="item-badge item-shortcut"
                style="background-color: #ffffff; padding: 2px; ${is_shortcut !== 0 ? 'display:block;' : ''}"
                src="${encode(window.icons['shortcut.svg'])}"
                data-item-id="${item_id}"
                title="${i18n('item_shortcut')}"
            >
            <img  class="item-badge item-is-worker long-hover"
                style="background-color: #ffffff; padding: 2px; ${is_worker ? 'display:block;' : ''}"
                src="${encode(window.icons['worker.svg'])}"
                data-item-id="${item_id}"
            >
        </div>
        <div class="item-name-wrapper">
            <pre class="item-name">${encode(displayName)}</pre>
            <textarea class="item-name-editor hide-scrollbar" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" data-gramm_editor="false">${encode(displayName)}</textarea>
        </div>
        <div class="col-spacer"></div>
        <div class="item-metadata">
            ${sharedView ? `${sharedByCellHtml(file)}<div class="col-spacer"></div>` : ''}
            ${file.is_dir ? '<div class="item-size"></div>' : `<div class="item-size">${formatFileSize(file.size)}</div>`}
            <div class="col-spacer"></div>
            <div class="item-modified">${encode(formatRelativeTime(file.modified * 1000, Date.now(), window.locale))}</div>
        </div>
        <div class="col-spacer"></div>
        <div class="item-more">${icons.more}</div>
    `;
    return row;
}

/**
 * Entries in listing order: folders first, then the rest by `column`. A
 * trashed item sorts by the name it shows. "Shared by" ties go by name.
 *
 * @param {Object[]} files - fsentries
 * @param {'name'|'size'|'modified'|'shared_by'} column
 * @param {'asc'|'desc'} direction
 * @returns {Object[]} A new, sorted array
 */
export function sortFileEntries (files, column, direction) {
    // Keyed once per entry: the comparator runs n·log n times.
    const keyed = files.map(file => ({
        file,
        name: parse_item_metadata(file.metadata).original_name || file.name || '',
        size: file.size,
        modified: file.modified,
    }));
    const sign = direction === 'asc' ? 1 : -1;
    keyed.sort((a, b) => {
        if ( !! a.file.is_dir !== !! b.file.is_dir ) return a.file.is_dir ? -1 : 1;
        const comparison = column === 'shared_by'
            ? compareSharers(a.file, b.file) || compareNames(a.name, b.name)
            : compareEntries(a, b, column);
        return sign * comparison;
    });
    return keyed.map(({ file }) => file);
}

/**
 * Where a navigation key moves the cursor in a listing of `count` rows laid
 * out `cols` to a line, `pageRows` lines to a screen. Returns `current` for a
 * key that doesn't move it.
 *
 * @param {number} keyCode - 33-40: PageUp, PageDown, End, Home, Left, Up, Right, Down
 * @param {{ current: number, count: number, cols: number, pageRows: number }} layout
 * @returns {number}
 */
export function nextRowIndex (keyCode, { current, count, cols, pageRows }) {
    const last = count - 1;
    switch ( keyCode ) {
    case 37: return Math.max(0, current - 1);
    case 38: return Math.max(0, current - cols);
    case 39: return Math.min(last, current + 1);
    case 40: return Math.min(last, current + cols);
    case 36: return 0;
    case 35: return last;
    case 33: return Math.max(0, current - cols * Math.max(1, pageRows));
    case 34: return Math.min(last, current + cols * Math.max(1, pageRows));
    default: return current;
    }
}

/**
 * How many rows a grid lays out to a line: those sharing the first one's top.
 *
 * @param {HTMLElement[]} rows
 * @returns {number}
 */
export function gridColumnCount (rows) {
    if ( rows.length < 2 ) return 1;
    const firstTop = $(rows[0]).offset().top;
    for ( let i = 1; i < rows.length; i++ ) {
        if ( $(rows[i]).offset().top !== firstTop ) return i;
    }
    return rows.length;
}

let measureContext = null;
let measureFont = null;

/**
 * The pixel width of `text` in `font`, measured on a canvas.
 *
 * @param {string} text
 * @param {string} [font] - CSS font shorthand
 * @returns {number}
 */
export function measureTextWidth (text, font = '500 13px system-ui, -apple-system, sans-serif') {
    if ( ! measureContext ) {
        measureContext = document.createElement('canvas').getContext('2d');
    }
    // Assigning font re-parses it; truncation measures many times per name.
    if ( measureFont !== font ) {
        measureContext.font = font;
        measureFont = font;
    }
    return measureContext.measureText(text).width;
}

/**
 * A file name cut in the middle to fit `maxWidth`, keeping its extension.
 *
 * @param {string} filename
 * @param {number} maxWidth - Pixels
 * @param {string} [font] - CSS font shorthand
 * @returns {string}
 */
export function truncateFilenameToWidth (filename, maxWidth, font = '500 13px system-ui, -apple-system, sans-serif') {
    return middleTruncate(filename, maxWidth, text => measureTextWidth(text, font));
}

/**
 * Fits row names to their room, cutting long ones in the middle with the
 * full name as their title. A list row has one line, `nameWidth` wide (or
 * its wrapper's width when null); a grid tile has two.
 *
 * @param {HTMLElement[]} nameEls - `.item-name` elements of rows with a `data-name`
 * @param {{ list: boolean, nameWidth: number | null }} layout
 * @returns {void}
 */
export function fitNames (nameEls, { list, nameWidth }) {
    const names = nameEls.filter(el => el.closest('.row')?.getAttribute('data-name'));
    if ( ! names.length ) return;
    // Measured in the font the names render in (the compact grid's is smaller).
    const style = getComputedStyle(names[0]);
    const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const fullNameOf = el => el.closest('.row').getAttribute('data-name');
    const write = (el, text) => {
        if ( el.textContent !== text ) el.textContent = text;
        const title = text === fullNameOf(el) ? '' : fullNameOf(el);
        if ( el.title !== title ) el.title = title;
    };

    if ( list ) {
        // The name's padding takes room from a set width. An auto-width
        // column's room is its wrapper's, less the wrapper's padding: all
        // reads before any write, so the writes don't force a layout each.
        const paddingOf = s => (parseFloat(s.paddingLeft) || 0) + (parseFloat(s.paddingRight) || 0);
        const padding = paddingOf(style);
        const wrapperPadding = nameWidth ? 0 : paddingOf(getComputedStyle(names[0].parentElement));
        const rooms = nameWidth ? null : names.map(el => el.parentElement.clientWidth - wrapperPadding);
        names.forEach((el, i) => {
            const room = (nameWidth || rooms[i]) - padding;
            // A listing not laid out yet (hidden) has no room to fit to.
            write(el, room > 0 ? truncateFilenameToWidth(fullNameOf(el), room, font) : fullNameOf(el));
        });
        return;
    }

    // A tile's name wraps into two lines, or is cut in the middle until it
    // does. Where the browser wraps can't be told from widths alone, so every
    // tile is written and read back, a layout a round, not a tile.
    const widths = new Map(names.map(el => [el, $(el).width() || 156]));
    names.forEach(el => write(el, fullNameOf(el)));
    let overflowing = names;
    for ( let round = 0; round <= 10; round++ ) {
        overflowing = overflowing.filter(el => el.scrollHeight > el.clientHeight + 1);
        if ( ! overflowing.length ) break;
        // Wrapping leaves line ends empty: a tenth of a line less each round.
        for ( const el of overflowing ) {
            const width = widths.get(el);
            const room = round < 10 ? width * (2 - round / 10) : width;
            write(el, truncateFilenameToWidth(fullNameOf(el), room, font));
        }
    }
}

/**
 * A Shared view listing entry for a row of `list_all_shared()`. A share has
 * no fsentry to stat, so the entry carries what the row and its icon need.
 *
 * @param {Object} share
 * @returns {Object}
 */
export function sharedListingEntry (share) {
    return {
        uid: share.entryUid,
        name: share.name ?? share.path.split('/').pop(),
        path: share.path,
        is_dir: share.isDir,
        type: share.type,
        thumbnail: share.thumbnail,
        modified: share.modified,
        size: share.size,
        shared_with_me: true,
        share_mode: share.mode,
        shared_by: share.issuer,
        shared_by_all: share.issuers,
        owner: share.owner,
        holder_team: share.holderTeam,
        also_team_share: share.alsoHeldByTeam,
    };
}

/**
 * The row type-to-select lands on, or -1 for none. A repeated letter ("r",
 * "rr") steps through the names starting with it, past the selected one;
 * a longer prefix stays on the selected row while it still matches.
 *
 * @param {string[]} names - The rows' names, lower-cased, in listing order
 * @param {number} selected - Index of the selected row, or -1
 * @param {string} term - What has been typed, lower-cased
 * @returns {number}
 */
export function typeSelectTarget (names, selected, term) {
    const cycling = [...term].every(ch => ch === term[0]);
    const prefix = cycling ? term[0] : term;
    const matches = names.flatMap((name, i) => (name.startsWith(prefix) ? [i] : []));
    if ( matches.length === 0 ) return -1;
    const at = matches.indexOf(selected);
    if ( at === -1 ) return matches[0];
    return cycling ? matches[(at + 1) % matches.length] : selected;
}

/**
 * Whether a folder is someone else's, shared with the user without write
 * access, by the shares already loaded. Unknown counts as writable: the
 * server still has the last word.
 *
 * @param {string} folderPath
 * @returns {boolean}
 */
export function isReadOnlyShare (folderPath) {
    if ( is_owned_by_me(folderPath) ) return false;
    const mode = shared_root_for(folderPath)?.mode;
    return !! mode && ! ['write', 'manage'].includes(mode);
}

/**
 * Whether items can be created, uploaded or pasted into a folder. Not the
 * Trash or a folder inside it (Restore needs metadata only Delete writes),
 * not the Shared view (a query, not a directory), not `/`, and not a folder
 * shared with the user to view only (where the server refuses each of them).
 *
 * @param {string} folderPath
 * @returns {boolean}
 */
export function folderAcceptsNewItems (folderPath) {
    return !! folderPath
        && folderPath !== '/'
        && folderPath !== window.trash_path
        && ! folderPath.startsWith(`${window.trash_path}/`)
        && folderPath !== window.shared_path
        && ! isReadOnlyShare(folderPath);
}
