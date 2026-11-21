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

import path from '../../lib/path.js';
import UIAlert from '../UIAlert.js';
import UIContextMenu from '../UIContextMenu.js';
import ContextMenuModal, { isTouchPrimaryDevice } from '../Dashboard/ContextMenu/ContextMenu.js';
import item_icon from '../../helpers/itemIcon.js';
import list_all_shared from '../../helpers/listAllShared.js';
import { can_restructure, remember_shared_roots } from '../../helpers/sharedAccess.js';
import { parent_path_for } from '../../helpers/sharePaths.js';
import { is_owned_by_me } from '../../helpers/pathOwner.js';
import { paintAvatars } from '../../helpers/profilePictures.js';
import { icons } from '../../helpers/actionIcons.js';
import {
    breadcrumbsHtml,
    createFileRow,
    directoriesHtml,
    fitNames,
    folderAcceptsNewItems,
    gridColumnCount,
    nextRowIndex,
    sharedListingEntry,
    sortFileEntries,
    typeSelectTarget,
} from '../Dashboard/fileListing.js';
import { isEntryVisible, showHiddenFiles } from '../Dashboard/hiddenFiles.js';
import { resolveTypedPath } from '../Dashboard/typedPath.js';

/**
 * @typedef {'open' | 'save' | 'directory'} FilePickerMode
 */

/**
 * @typedef {Object} FilePickerViewPrefs
 * @property {'list' | 'grid' | 'grid-sm'} view
 * @property {'name' | 'size' | 'modified' | 'shared_by'} sortColumn
 * @property {'asc' | 'desc'} sortDirection
 */

const VIEWS = ['list', 'grid', 'grid-sm'];
const SORT_COLUMNS = ['name', 'size', 'modified', 'shared_by'];
// How long a picker waits on the saved view before listing with the defaults.
const PREFS_TIMEOUT_MS = 1500;
// Socket events about one folder arrive in bursts (a move of many items).
const LIVE_REFRESH_DELAY_MS = 150;

const encode = (value) => window.html_encode(value);

/** On a Mac, Ctrl+click is a right-click; Cmd is what adds to a selection. */
const CTRL_CLICK_IS_SECONDARY = /mac/i.test(navigator.userAgentData?.platform ?? navigator.platform ?? '');

// The saved view, read once per page.
let savedPrefs = null;

/**
 * The view and sort a picker opens with: the Files tab's, else the saved
 * preference. A change made in a picker stays in that picker; the Files
 * tab's preference stays as the user set it there.
 *
 * @returns {Promise<FilePickerViewPrefs>}
 */
function loadViewPrefs () {
    const files = window.dashboard_object;
    if ( files?.currentView ) {
        return Promise.resolve(validPrefs([files.currentView, files.sortColumn, files.sortDirection]));
    }
    const read = (key) => Promise.resolve().then(() => window.puter.kv.get(key)).catch(() => null);
    savedPrefs ??= Promise.race([
        Promise.all([read('view_mode'), read('sort_column'), read('sort_direction')]),
        new Promise(resolve => setTimeout(() => resolve([]), PREFS_TIMEOUT_MS)),
    ]).then(validPrefs);
    return savedPrefs.then(prefs => ({ ...prefs }));
}

/**
 * @param {Array<unknown>} values - View, sort column and sort direction, as stored
 * @returns {FilePickerViewPrefs}
 */
function validPrefs ([view, sortColumn, sortDirection] = []) {
    return {
        view: VIEWS.includes(view) ? view : 'list',
        sortColumn: SORT_COLUMNS.includes(sortColumn) ? sortColumn : 'name',
        sortDirection: sortDirection === 'desc' ? 'desc' : 'asc',
    };
}

/**
 * Whether a picker in `mode` lets the user pick `entry`. Folders can always be
 * selected and opened; a file only by an open or save picker, and only when it
 * is one of the allowed types.
 *
 * @param {{ is_dir?: boolean, name?: string, type?: string }} entry
 * @param {FilePickerMode} mode
 * @param {string} allowedFileTypes - Comma-separated extensions and MIME types
 * @returns {boolean}
 */
export function pickerAccepts (entry, mode, allowedFileTypes) {
    if ( entry.is_dir ) return true;
    if ( mode === 'directory' ) return false;
    return window.check_fsentry_against_allowed_file_types_string(entry, allowedFileTypes);
}

/**
 * The browsing part of a file picker: the dashboard's Files listing, with its
 * folders sidebar, breadcrumbs, list and grid views, sorting, selection and
 * keyboard, turned to picking. The dialog around it (UIWindow and its buttons)
 * reads the selection and folder from here.
 */
export default class FilePicker {
    /**
     * @param {Object} options
     * @param {HTMLElement} options.el_window - The picker's window
     * @param {HTMLElement} options.el_body - Where the listing is drawn
     * @param {FilePickerMode} options.mode
     * @param {string} options.path - The folder it opens in
     * @param {boolean} options.multiple - Whether more than one item can be selected
     * @param {string} [options.allowedFileTypes] - Comma-separated extensions and MIME types
     * @param {() => void} [options.onChange] - The folder or the selection changed
     * @param {(entries: Object[]) => void} [options.onActivate] - Files were opened
     *   by a double-click or Enter
     */
    constructor ({ el_window, el_body, mode, path: startPath, multiple, allowedFileTypes = '', onChange, onActivate }) {
        this.el_window = el_window;
        this.el_body = el_body;
        this.mode = mode;
        this.startPath = startPath;
        this.multiple = !! multiple;
        this.allowedFileTypes = allowedFileTypes;
        this.onChange = onChange ?? (() => {});
        this.onActivate = onActivate ?? (() => {});

        this.currentPath = null;
        // The folder a listing is on its way for; null once it's on screen.
        this.pendingPath = null;
        this.loading = false;
        this.renderSeq = 0;
        this.history = [];
        this.historyPosition = -1;
        this.entries = new WeakMap();
        this.anchor = null;
        this.typeSearchTerm = '';
        this.typeSearchTimeout = null;
        this.rubberBandJustEnded = false;
        this.prefs = validPrefs();
        this.prefsReady = Promise.resolve();
        this.liveRefreshTimer = null;
        this.socketHandlers = [];
        this.isTouch = !! (window.isMobile?.phone || window.isMobile?.tablet || isTouchPrimaryDevice());
    }

    /**
     * Draws the picker and lists the folder it opens in.
     *
     * @returns {Promise<void>}
     */
    async mount () {
        this.$root = $(`<div class="file-picker dashboard-section-files">${this.html()}</div>`);
        $(this.el_body).append(this.$root);
        this.$files = this.$root.find('.files');
        if ( this.isTouch ) this.$root.find('.files-tab').addClass('touch-device');
        this.bindChrome();
        this.bindKeyboard();
        this.initRubberBand();
        this.initNativeDrop();
        this.subscribeToChanges();
        $(this.el_window).on('remove', () => this.destroy());

        // Read alongside the first listing, which waits for it before sorting.
        this.prefsReady = loadViewPrefs().then((prefs) => {
            this.prefs = prefs;
            this.applyViewMode();
        });
        if ( this.mode !== 'save' ) this.focusListing();
        await this.navigate(this.startPath);
    }

    /**
     * @returns {string} HTML
     */
    html () {
        const navButton = (cls, icon, label) => `<img draggable="false" class="path-btn ${cls} path-btn-disabled" tabindex="-1" role="button" aria-disabled="true" aria-label="${i18n(label)}" src="${encode(window.icons[icon])}" title="${i18n(label)}">`;
        return `
            <div class="dashboard-tab-content files-tab">
                ${directoriesHtml({ trash: false })}
                <div class="directory-contents">
                    <div class="header">
                        <div class="path">
                            <div class="path-nav-buttons">
                                ${navButton('path-btn-back', 'arrow-left-thin.svg', 'window_click_to_go_back')}
                                ${navButton('path-btn-forward', 'arrow-right-thin.svg', 'window_click_to_go_forward')}
                                ${navButton('path-btn-up', 'arrow-up-thin.svg', 'window_click_to_go_up')}
                            </div>
                            <input type="text" class="path-editor" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off" enterkeyhint="go" aria-label="${i18n('path')}">
                            <div class="path-breadcrumbs"></div>
                            <div class="path-actions">
                                <button class="path-action-btn sort-btn" title="${i18n('sort_by')}" aria-haspopup="menu">${icons.sort}</button>
                                <button class="path-action-btn view-toggle-btn" title="${i18n('toggle_view')}" aria-haspopup="menu">${icons.list}</button>
                                <button class="path-action-btn new-folder-btn" title="${i18n('new_folder')}">${icons.newFolder}</button>
                            </div>
                        </div>
                        <div class="columns">
                            <div class="item-icon"></div>
                            <div class="item-name sortable" data-sort="name">${i18n('name')}</div>
                            <div class="col-resize-handle" data-resize="name"></div>
                            <div class="item-shared-by sortable" data-sort="shared_by"><span class="sortable-label">${i18n('shared_by')}</span></div>
                            <div class="col-resize-handle" data-resize="sharedBy"></div>
                            <div class="item-size sortable" data-sort="size">${i18n('size')}</div>
                            <div class="col-resize-handle" data-resize="size"></div>
                            <div class="item-modified sortable" data-sort="modified">${i18n('modified')}</div>
                            <div class="col-resize-handle" data-resize="modified"></div>
                            <div class="item-more"></div>
                        </div>
                    </div>
                    <div class="files files-list-view" tabindex="0"></div>
                </div>
            </div>
        `;
    }

    // -- Listing --

    /**
     * Lists a folder. The folder changes once its listing arrives; a newer
     * navigation started meanwhile wins.
     *
     * @param {string} target - A folder path, or the Shared view
     * @param {Object} [options]
     * @param {boolean} [options.push] - Add the folder to Back/Forward history
     * @param {string[]} [options.selectPaths] - Select these rows once listed
     * @param {boolean} [options.keepSelection] - Keep the selection by uid (a refresh)
     * @param {'eventual' | 'strong'} [options.consistency]
     * @returns {Promise<void>}
     */
    async navigate (target, { push = true, selectPaths = null, keepSelection = false, consistency = 'eventual' } = {}) {
        if ( ! target ) return;
        const seq = ++this.renderSeq;
        const isRefresh = target === this.currentPath;
        this.closePathEditor();
        const keptUids = keepSelection ? new Set(this.selectedRows().map(row => row.getAttribute('data-uid'))) : null;
        const scrollTop = isRefresh ? this.$files.scrollTop() : 0;
        if ( ! isRefresh ) {
            this.$files.empty();
            this.showSpinner();
        }
        this.loading = true;
        this.pendingPath = target;
        this.onChange();

        let entries;
        let failed = false;
        try {
            entries = target === window.shared_path
                ? await this.listShared()
                : await window.puter.fs.readdir({ path: target, consistency });
        } catch ( err ) {
            console.error('Failed to read directory:', err);
            failed = true;
            entries = [];
        }
        await this.prefsReady;
        if ( seq !== this.renderSeq ) return;

        entries = entries.filter(entry => isEntryVisible(entry.name, showHiddenFiles())
            && ! (entry.name === 'AppData' && target === window.home_path)
            && entry.path !== window.trash_path);
        const sorted = sortFileEntries(entries, this.activeSortColumn(target), this.prefs.sortDirection);
        const iconResults = await Promise.allSettled(sorted.map(entry => item_icon(entry, { listRow: ! this.isGridView() })));
        if ( seq !== this.renderSeq ) return;

        if ( push && ! isRefresh ) this.pushHistory(target);
        this.currentPath = target;
        this.pendingPath = null;
        this.failedPath = failed ? target : null;
        this.loading = false;
        this.anchor = null;
        this.$files.empty();
        this.$root.find('.files-tab').toggleClass('shared-view', target === window.shared_path);

        if ( failed ) {
            this.$files.append(`<div class="files-notice">${i18n('folder_open_failed')}</div>`);
        } else {
            this.renderPlaceRows();
            sorted.forEach((entry, i) => {
                const icon = iconResults[i].status === 'fulfilled'
                    ? iconResults[i].value
                    : { image: window.icons['file.svg'], type: 'icon' };
                this.$files.append(this.renderRow(entry, icon));
            });
            if ( sorted.length === 0 ) {
                this.$files.append(`<div class="files-notice files-empty-notice">${i18n('folder_empty')}</div>`);
            }
        }

        this.renderBreadcrumbs();
        this.updateChrome();
        this.fitRowNames();
        if ( keptUids?.size ) {
            this.setSelection(this.rows().filter(row => keptUids.has(row.getAttribute('data-uid'))));
        }
        if ( selectPaths?.length ) {
            const wanted = new Set(selectPaths.map(p => String(p).toLowerCase()));
            const rows = this.rows().filter(row => wanted.has(String(row.getAttribute('data-path')).toLowerCase()));
            if ( rows.length ) {
                this.setSelection(this.multiple ? rows : rows.slice(0, 1));
                rows[0].scrollIntoView({ block: 'nearest' });
            }
        }
        if ( isRefresh ) this.$files.scrollTop(scrollTop);
        this.onChange();
    }

    /**
     * Lists the folder on screen again, keeping the selection.
     *
     * @param {{ selectPaths?: string[] }} [options] - Select these rows instead
     * @returns {Promise<void>}
     */
    refresh ({ selectPaths } = {}) {
        if ( ! this.currentPath ) return Promise.resolve();
        return this.navigate(this.currentPath, {
            push: false,
            keepSelection: ! selectPaths,
            selectPaths,
            consistency: 'strong',
        });
    }

    /**
     * Everything shared with the user, as listing entries.
     *
     * @returns {Promise<Object[]>}
     */
    async listShared () {
        const shares = await list_all_shared();
        remember_shared_roots(shares);
        return shares.map(sharedListingEntry);
    }

    /**
     * A row for an entry, with its handlers.
     *
     * @param {Object} entry
     * @param {{ image: string, type: string }} icon
     * @returns {HTMLElement}
     */
    renderRow (entry, icon) {
        const row = createFileRow(entry, icon, { sharedView: this.currentPath === window.shared_path });
        if ( ! pickerAccepts(entry, this.mode, this.allowedFileTypes) ) {
            row.classList.add('item-disabled');
            row.setAttribute('aria-disabled', 'true');
        }
        this.entries.set(row, entry);
        if ( this.currentPath === window.shared_path ) paintAvatars(row);
        this.bindRowEditor(row, entry);
        return row;
    }

    /**
     * Shared has no folder of its own to list, so below 480px, where the
     * folders sidebar is hidden, Home carries a row for it.
     *
     * @returns {void}
     */
    renderPlaceRows () {
        if ( this.currentPath !== window.home_path ) return;
        const row = document.createElement('div');
        row.setAttribute('class', 'row folder place-row');
        row.setAttribute('data-place', 'Shared');
        row.setAttribute('data-path', window.shared_path);
        row.setAttribute('data-name', i18n('shared', [], false));
        row.setAttribute('data-is_dir', '1');
        row.setAttribute('tabindex', '0');
        row.setAttribute('role', 'link');
        row.innerHTML = `
            <div class="item-checkbox"><span class="checkbox-icon"></span></div>
            <div class="item-icon"><img alt="" src="${encode(window.icons['folder-shared.svg'])}"/></div>
            <div class="item-badges"></div>
            <div class="item-name-wrapper">
                <pre class="item-name">${encode(i18n('shared'))}</pre>
            </div>
            <div class="col-spacer"></div>
            <div class="item-metadata">
                <div class="item-size"></div>
                <div class="col-spacer"></div>
                <div class="item-modified"></div>
            </div>
            <div class="col-spacer"></div>
            <div class="item-more"></div>
        `;
        this.$files.append(row);
    }

    /** @returns {HTMLElement[]} Every item row, place rows aside */
    rows () {
        return this.$files.find('.row.item').toArray();
    }

    /** @returns {HTMLElement[]} Rows the keyboard and selection reach */
    selectableRows () {
        return this.rows().filter(row => ! row.classList.contains('item-disabled'));
    }

    /** @returns {HTMLElement[]} */
    selectedRows () {
        return this.$files ? this.$files.find('.row.item.selected').toArray() : [];
    }

    /**
     * The entries of the selected rows, in listing order.
     *
     * @returns {Object[]}
     */
    selectedEntries () {
        return this.selectedRows().map(row => this.entryOf(row)).filter(Boolean);
    }

    /**
     * The entry a row was drawn for, with the row's current name and path:
     * a rename elsewhere updates the row, not the entry.
     *
     * @param {HTMLElement} row
     * @returns {Object | undefined}
     */
    entryOf (row) {
        const entry = this.entries.get(row);
        if ( ! entry ) return undefined;
        return { ...entry, path: row.getAttribute('data-path') ?? entry.path };
    }

    /**
     * Whether the folder on screen takes new items.
     *
     * @returns {boolean}
     */
    acceptsNewItemsHere () {
        return ! this.loading
            && !! this.currentPath
            && this.currentPath !== this.failedPath
            && folderAcceptsNewItems(this.currentPath);
    }

    // -- Selection --

    /**
     * Replaces the selection. A picker that takes one item keeps the first.
     *
     * @param {HTMLElement[]} rows
     * @param {HTMLElement} [anchor] - Where Shift+click and Shift+arrows go on from
     * @returns {void}
     */
    setSelection (rows, anchor = rows[rows.length - 1]) {
        const wanted = (this.multiple ? rows : rows.slice(0, 1))
            .filter(row => ! row.classList.contains('item-disabled'));
        this.$files.find('.row.selected').removeClass('selected');
        wanted.forEach(row => row.classList.add('selected'));
        this.anchor = wanted.includes(anchor) ? anchor : (wanted[wanted.length - 1] ?? null);
        this.onChange();
    }

    /**
     * Selects a row the way a click with these modifiers does.
     *
     * @param {HTMLElement} row
     * @param {{ shiftKey?: boolean, ctrlKey?: boolean, metaKey?: boolean }} modifiers
     * @returns {void}
     */
    clickSelect (row, { shiftKey = false, ctrlKey = false, metaKey = false } = {}) {
        if ( row.classList.contains('item-disabled') ) return;
        const additive = (ctrlKey && ! CTRL_CLICK_IS_SECONDARY) || metaKey;
        if ( this.multiple && shiftKey && this.anchor && this.anchor.isConnected ) {
            const rows = this.selectableRows();
            const from = rows.indexOf(this.anchor);
            const to = rows.indexOf(row);
            if ( from !== -1 && to !== -1 ) {
                const range = rows.slice(Math.min(from, to), Math.max(from, to) + 1);
                const kept = additive ? this.selectedRows() : [];
                this.setSelection([...new Set([...kept, ...range])], this.anchor);
                return;
            }
        }
        if ( this.multiple && additive ) {
            const selected = this.selectedRows();
            this.setSelection(row.classList.contains('selected')
                ? selected.filter(r => r !== row)
                : [...selected, row], row);
            return;
        }
        this.setSelection([row], row);
    }

    /**
     * Opens a row: into a folder, or hands files to the dialog.
     *
     * @param {HTMLElement} row
     * @returns {void}
     */
    openRow (row) {
        const target = row.getAttribute('data-path');
        if ( row.getAttribute('data-is_dir') === '1' ) {
            this.navigate(target);
            return;
        }
        if ( row.classList.contains('item-disabled') ) return;
        const entry = this.entryOf(row);
        if ( entry ) this.onActivate([entry]);
    }

    /**
     * Opens what's selected: the first folder if that's all there is,
     * otherwise the selected files.
     *
     * @returns {void}
     */
    openSelection () {
        const rows = this.selectedRows();
        const files = rows.filter(row => row.getAttribute('data-is_dir') !== '1');
        if ( files.length ) {
            this.onActivate(files.map(row => this.entryOf(row)).filter(Boolean));
        } else if ( rows.length ) {
            this.openRow(rows[0]);
        }
    }

    // -- Chrome --

    /**
     * Binds the sidebar, toolbar, breadcrumbs and rows.
     *
     * @returns {void}
     */
    bindChrome () {
        const $root = this.$root;

        $root.on('click', '.directories [data-folder]', (e) => {
            this.navigate(e.currentTarget.getAttribute('data-path'));
        });
        // The sidebar, crumbs and nav arrows aren't native buttons or links.
        $root.on('keydown', '[role="button"]:not(button), [role="link"]', function (e) {
            if ( e.key !== 'Enter' && e.key !== ' ' ) return;
            e.preventDefault();
            e.stopPropagation();
            if ( $(this).attr('aria-disabled') === 'true' ) return;
            this.click();
        });

        $root.on('click', '.path-btn-back', () => {
            if ( this.historyPosition > 0 ) this.goToHistory(this.historyPosition - 1);
        });
        $root.on('click', '.path-btn-forward', () => {
            if ( this.historyPosition < this.history.length - 1 ) this.goToHistory(this.historyPosition + 1);
        });
        $root.on('click', '.path-btn-up', () => {
            if ( ! this.currentPath || this.currentPath === '/' || this.currentPath === window.shared_path ) return;
            // Above a shared item is its owner's folder; parent_path_for sends us to Shared.
            this.navigate(parent_path_for(path.resolve(this.currentPath)));
        });

        $root.on('click', '.path-breadcrumbs .dirname', (e) => {
            e.stopPropagation();
            this.navigate(e.currentTarget.getAttribute('data-path'));
        });
        $root.on('click', '.path-breadcrumbs', (e) => {
            if ( $(e.target).closest('.dirname').length ) return;
            this.openPathEditor();
        });
        $root.on('keydown', '.path-editor', (e) => {
            if ( e.originalEvent?.isComposing || e.keyCode === 229 ) return;
            if ( e.key === 'Enter' ) {
                e.preventDefault();
                e.stopPropagation();
                this.submitPathEditor();
            } else if ( e.key === 'Escape' ) {
                e.preventDefault();
                e.stopPropagation();
                this.closePathEditor({ refocus: true });
            }
        });
        $root.on('input', '.path-editor', (e) => e.currentTarget.removeAttribute('aria-invalid'));
        $root.on('focusout', '.path-editor', () => {
            if ( ! this.pathLookup ) this.closePathEditor();
        });

        $root.on('click', '.sort-btn', (e) => this.showSortMenu(e));
        $root.on('click', '.view-toggle-btn', (e) => this.showViewMenu(e));
        $root.on('click', '.new-folder-btn', () => this.createFolder());
        $root.on('click', '.header .columns .sortable', (e) => {
            this.sortBy(e.currentTarget.getAttribute('data-sort'));
        });

        const $files = this.$files;
        $files.on('click', '.row', (e) => this.onRowClick(e));
        $files.on('dblclick', '.row.item', (e) => {
            if ( $(e.target).closest('.item-name-editor').length ) return;
            this.openRow(e.currentTarget);
        });
        $files.on('contextmenu taphold', '.row', (e) => this.onRowMenu(e));
        $files.on('click', (e) => {
            if ( this.rubberBandJustEnded ) {
                this.rubberBandJustEnded = false;
                return;
            }
            if ( e.target === e.currentTarget ) this.setSelection([]);
        });
        $files.on('contextmenu taphold', (e) => {
            if ( e.target !== e.currentTarget ) return;
            if ( e.type === 'taphold' && ! this.isTouch ) return;
            e.preventDefault();
            e.stopPropagation();
            this.setSelection([]);
            this.showMenu(this.folderMenuItems(), e, e.target.getBoundingClientRect());
        });
        // Clicks elsewhere in the picker leave the keyboard with the listing,
        // not with the page behind the window.
        this.$root.on('mousedown', (e) => {
            if ( $(e.target).closest('input, textarea, button, [tabindex], a').length ) return;
            setTimeout(() => this.focusListing(), 0);
        });
    }

    /**
     * @param {JQuery.ClickEvent} e
     * @returns {void}
     */
    onRowClick (e) {
        const row = e.currentTarget;
        if ( $(e.target).closest('.item-name-editor').length ) return;
        if ( this.rubberBandJustEnded ) {
            this.rubberBandJustEnded = false;
            return;
        }
        if ( row.classList.contains('place-row') ) {
            this.navigate(row.getAttribute('data-path'));
            return;
        }
        if ( $(e.target).closest('.item-more').length ) {
            if ( ! row.classList.contains('item-disabled') ) this.onRowMenu(e);
            return;
        }
        // A tap opens a folder; a file is selected, for the dialog's button.
        if ( this.isTouch && e.originalEvent?.pointerType !== 'mouse' ) {
            if ( row.getAttribute('data-is_dir') === '1' ) {
                this.openRow(row);
                return;
            }
            if ( this.multiple ) {
                this.clickSelect(row, { metaKey: true });
                return;
            }
        }
        this.clickSelect(row, e);
    }

    /**
     * @param {JQuery.TriggeredEvent} e
     * @returns {Promise<void>}
     */
    async onRowMenu (e) {
        const row = e.currentTarget.closest('.row');
        if ( $(e.target).closest('.item-name-editor').length ) {
            e.stopPropagation();
            return;
        }
        if ( e.type === 'taphold' && ! this.isTouch ) return;
        e.preventDefault();
        e.stopPropagation();
        if ( row.classList.contains('item-disabled') ) return;
        // iOS can send both events for one long-press.
        if ( row._menuShownAt && Date.now() - row._menuShownAt < 500 ) return;
        row._menuShownAt = Date.now();

        if ( row.classList.contains('place-row') ) {
            this.showMenu([{ html: i18n('open'), onClick: () => this.openRow(row) }], e, row.getBoundingClientRect());
            return;
        }
        const selected = this.selectedRows();
        const isMulti = selected.length > 1 && row.classList.contains('selected');
        const items = isMulti ? await this.multiSelectMenuItems(selected) : await this.rowMenuItems(row);
        if ( ! row.isConnected ) return;
        row.classList.add('context-menu-active');
        this.showMenu(items, e, row.getBoundingClientRect(), {
            title: isMulti ? i18n('items_count_other', { count: selected.length }, false) : row.getAttribute('data-name'),
            onClose: () => row.classList.remove('context-menu-active'),
        });
    }

    /**
     * A menu at the pointer, or the touch sheet at `rect` on touch.
     *
     * @param {Array<Object|string>} items
     * @param {JQuery.TriggeredEvent} e
     * @param {DOMRect} rect
     * @param {{ title?: string, onClose?: () => void }} [options]
     * @returns {void}
     */
    showMenu (items, e, rect, { title, onClose } = {}) {
        if ( ! items.length ) {
            onClose?.();
            return;
        }
        if ( this.isTouch || e.type === 'taphold' ) {
            const modal = new ContextMenuModal({ onClose });
            modal.show(items, rect, title ? { title } : {});
            return;
        }
        const position = e.pageX !== undefined ? { left: e.pageX, top: e.pageY } : { left: rect.left, top: rect.bottom };
        const menu = UIContextMenu({ items, position });
        if ( menu ) menu.onClose = onClose;
    }

    /**
     * @param {HTMLElement} row
     * @returns {Promise<Array<Object|string>>}
     */
    async rowMenuItems (row) {
        const items = [{ html: i18n('open'), onClick: () => this.openRow(row) }];
        if ( row.getAttribute('data-immutable') === '1' ) return items;
        const rowPath = row.getAttribute('data-path');
        const mayRestructure = is_owned_by_me(rowPath) || await can_restructure(rowPath);
        items.push('-');
        items.push({ html: i18n('rename'), onClick: () => window.activate_item_name_editor(row) });
        if ( mayRestructure ) {
            items.push({ html: i18n('delete'), onClick: () => this.trashRows([row]) });
        }
        return items;
    }

    /**
     * @param {HTMLElement[]} rows
     * @returns {Promise<Array<Object|string>>}
     */
    async multiSelectMenuItems (rows) {
        const movable = await this.restructurableRows(rows);
        return movable.length ? [{ html: i18n('delete'), onClick: () => this.trashRows(movable) }] : [];
    }

    /** @returns {Array<Object|string>} The listing background's menu */
    folderMenuItems () {
        const items = [];
        if ( this.acceptsNewItemsHere() ) {
            items.push({ html: i18n('new_folder'), onClick: () => this.createFolder() });
            if ( this.mode === 'open' ) {
                items.push({ html: i18n('upload'), onClick: () => this.pickFilesToUpload() });
            }
            items.push('-');
        }
        items.push({ html: i18n('refresh'), onClick: () => this.refresh() });
        return items;
    }

    /**
     * The rows that can be moved or trashed: the user's own, or in a folder
     * shared with them to manage.
     *
     * @param {HTMLElement[]} rows
     * @returns {Promise<HTMLElement[]>}
     */
    async restructurableRows (rows) {
        const answers = await Promise.all(rows.map((row) => {
            if ( row.getAttribute('data-immutable') === '1' ) return false;
            const rowPath = row.getAttribute('data-path');
            return is_owned_by_me(rowPath) || can_restructure(rowPath);
        }));
        return rows.filter((_row, i) => answers[i]);
    }

    /**
     * Moves rows to the Trash, then lists the folder again.
     *
     * @param {HTMLElement[]} rows
     * @returns {Promise<void>}
     */
    async trashRows (rows) {
        if ( ! rows.length ) return;
        await window.move_items(rows, window.trash_path);
        await this.refresh();
    }

    /**
     * Updates everything around the rows for the folder on screen.
     *
     * @returns {void}
     */
    updateChrome () {
        const $root = this.$root;
        $root.find('.directories li').each((_, li) => {
            li.classList.toggle('active', li.getAttribute('data-path') === this.currentPath);
        });
        const setDisabled = ($btn, disabled) => $btn
            .toggleClass('path-btn-disabled', disabled)
            .attr('aria-disabled', disabled ? 'true' : 'false')
            .attr('tabindex', disabled ? '-1' : '0');
        setDisabled($root.find('.path-btn-back'), this.historyPosition <= 0);
        setDisabled($root.find('.path-btn-forward'), this.historyPosition >= this.history.length - 1);
        setDisabled($root.find('.path-btn-up'), this.currentPath === '/' || this.currentPath === window.shared_path);
        $root.find('.new-folder-btn').toggle(this.acceptsNewItemsHere());
        this.updateSortIndicators();
    }

    /** @returns {void} */
    renderBreadcrumbs () {
        const $crumbs = this.$root.find('.path-breadcrumbs');
        $crumbs.html(breadcrumbsHtml(this.currentPath));
        $crumbs.find('.dirname').last().attr('aria-current', 'page');
        const el = $crumbs[0];
        if ( el ) el.scrollLeft = el.scrollWidth;
    }

    /** @returns {void} */
    fitRowNames () {
        fitNames(this.$files.find('.row .item-name').toArray(), { list: ! this.isGridView(), nameWidth: null });
    }

    /**
     * Puts the keyboard on the listing.
     *
     * @returns {void}
     */
    focusListing () {
        if ( ! this.$files?.[0]?.isConnected ) return;
        const active = document.activeElement;
        if ( active && this.el_window.contains(active) && $(active).is('input, textarea') ) return;
        this.$files[0].focus({ preventScroll: true });
    }

    // -- History --

    /**
     * @param {string} folder
     * @returns {void}
     */
    pushHistory (folder) {
        if ( this.history[this.historyPosition] === folder ) return;
        this.history = this.history.slice(0, this.historyPosition + 1);
        this.history.push(folder);
        this.historyPosition = this.history.length - 1;
    }

    /**
     * @param {number} position
     * @returns {void}
     */
    goToHistory (position) {
        this.historyPosition = position;
        this.navigate(this.history[position], { push: false });
    }

    // -- Path editor --

    /**
     * Swaps the breadcrumbs for a field to type a path into.
     *
     * @param {string} [initial] - Text to start from; by default the current path, selected
     * @returns {void}
     */
    openPathEditor (initial) {
        const $path = this.$root.find('.header .path');
        const input = $path.find('.path-editor')[0];
        if ( ! input || ! this.currentPath ) return;
        input.value = initial ?? this.currentPath;
        input.removeAttribute('aria-invalid');
        $path.addClass('path-editing');
        input.focus();
        if ( initial === undefined ) input.select();
        else input.setSelectionRange(input.value.length, input.value.length);
    }

    /**
     * @param {{ refocus?: boolean }} [options] - refocus hands the keyboard back to the listing
     * @returns {void}
     */
    closePathEditor ({ refocus = false } = {}) {
        const $path = this.$root?.find('.header .path');
        if ( ! $path?.hasClass('path-editing') ) return;
        $path.removeClass('path-editing');
        this.pathLookup = null;
        // Hidden, the crumbs lost their scroll position.
        const crumbs = $path.find('.path-breadcrumbs')[0];
        if ( crumbs ) crumbs.scrollLeft = crumbs.scrollWidth;
        if ( refocus ) this.focusListing();
    }

    /**
     * Goes where the path field says: into a folder, or to a file's folder
     * with the file selected.
     *
     * @returns {Promise<void>}
     */
    async submitPathEditor () {
        if ( this.pathLookup ) return;
        const input = this.$root.find('.path-editor')[0];
        const typed = input.value.trim();
        const target = resolveTypedPath(typed, {
            currentPath: this.currentPath,
            homePath: window.home_path,
            sharedPath: window.shared_path,
        });
        if ( target === undefined || target === this.currentPath ) {
            this.closePathEditor({ refocus: true });
            return;
        }

        let folder = target;
        let file;
        if ( target !== window.shared_path && target !== '/' ) {
            const lookup = this.pathLookup = {};
            try {
                let entry;
                try {
                    entry = await window.puter.fs.stat({ path: target, consistency: 'eventual' });
                } catch {
                    entry = undefined;
                }
                if ( this.pathLookup !== lookup ) return;
                if ( ! entry ) {
                    input.setAttribute('aria-invalid', 'true');
                    await new Promise(resolve => UIAlert({
                        message: i18n('path_not_found', [typed], false),
                        parent_uuid: $(this.el_window).attr('data-element_uuid'),
                        window_options: { on_close: resolve },
                    }));
                    input.focus();
                    input.select();
                    return;
                }
                if ( ! entry.is_dir ) {
                    file = entry.path ?? target;
                    folder = path.dirname(file);
                }
            } finally {
                if ( this.pathLookup === lookup ) this.pathLookup = null;
            }
        }

        this.closePathEditor({ refocus: true });
        await this.navigate(folder, { selectPaths: file ? [file] : null });
    }

    // -- View and sort --

    /** @returns {boolean} */
    isGridView () {
        return this.prefs.view === 'grid' || this.prefs.view === 'grid-sm';
    }

    /**
     * "Shared by" orders only the Shared view; elsewhere it reads as name.
     *
     * @param {string} [folder]
     * @returns {'name' | 'size' | 'modified' | 'shared_by'}
     */
    activeSortColumn (folder = this.currentPath) {
        if ( this.prefs.sortColumn === 'shared_by' && folder !== window.shared_path ) return 'name';
        return this.prefs.sortColumn;
    }

    /** @returns {void} */
    applyViewMode () {
        const grid = this.isGridView();
        this.$files.removeClass('files-list-view files-grid-view files-grid-view-sm');
        if ( this.prefs.view === 'grid-sm' ) this.$files.addClass('files-grid-view files-grid-view-sm');
        else if ( grid ) this.$files.addClass('files-grid-view');
        else this.$files.addClass('files-list-view');
        this.$root.find('.files-tab').toggleClass('files-grid-mode', grid);
        const icon = this.prefs.view === 'grid' ? icons.grid : this.prefs.view === 'grid-sm' ? icons.gridSmall : icons.list;
        this.$root.find('.view-toggle-btn').html(icon);
    }

    /** @returns {void} */
    updateSortIndicators () {
        const $columns = this.$root.find('.header .columns');
        $columns.find('.sortable').removeClass('sort-asc sort-desc');
        $columns.find(`.sortable[data-sort="${this.activeSortColumn()}"]`)
            .addClass(this.prefs.sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
    }

    /**
     * Sorts by a column, flipping the order when it already sorts by it.
     *
     * @param {'name' | 'size' | 'modified' | 'shared_by'} column
     * @returns {void}
     */
    sortBy (column) {
        if ( ! SORT_COLUMNS.includes(column) ) return;
        this.prefs.sortDirection = this.activeSortColumn() === column && this.prefs.sortDirection === 'asc' ? 'desc' : 'asc';
        this.prefs.sortColumn = column;
        this.refresh();
    }

    /**
     * @param {'list' | 'grid' | 'grid-sm'} view
     * @returns {void}
     */
    setView (view) {
        if ( this.prefs.view === view ) return;
        this.prefs.view = view;
        this.applyViewMode();
        // Grid tiles show thumbnails where list rows show type icons.
        this.refresh();
    }

    /**
     * @param {JQuery.ClickEvent} e
     * @returns {{ left?: number, right?: number, top: number }}
     */
    toolbarMenuPosition (e) {
        if ( e.detail > 0 ) return { left: e.pageX, top: e.pageY };
        const rect = e.currentTarget.getBoundingClientRect();
        return { right: rect.right, top: rect.bottom + 3 };
    }

    /**
     * @param {JQuery.ClickEvent} e
     * @returns {void}
     */
    showSortMenu (e) {
        const options = [
            { column: 'name', label: i18n('name') },
            { column: 'size', label: i18n('size') },
            { column: 'modified', label: i18n('date_modified') },
        ];
        if ( this.currentPath === window.shared_path ) {
            options.splice(1, 0, { column: 'shared_by', label: i18n('shared_by') });
        }
        const active = this.activeSortColumn();
        const arrow = this.prefs.sortDirection === 'asc' ? ' ↑' : ' ↓';
        UIContextMenu({
            items: options.map(opt => ({
                html: `<span>${opt.label}${active === opt.column ? arrow : ''}</span>`,
                checked: active === opt.column,
                onClick: () => this.sortBy(opt.column),
            })),
            position: this.toolbarMenuPosition(e),
        });
    }

    /**
     * @param {JQuery.ClickEvent} e
     * @returns {void}
     */
    showViewMenu (e) {
        const options = [
            { view: 'list', label: i18n('view_list') },
            { view: 'grid-sm', label: i18n('view_compact_grid') },
            { view: 'grid', label: i18n('view_grid') },
        ];
        UIContextMenu({
            items: options.map(opt => ({
                html: `<span>${opt.label}</span>`,
                checked: this.prefs.view === opt.view,
                onClick: () => this.setView(opt.view),
            })),
            position: this.toolbarMenuPosition(e),
        });
    }

    // -- Creating, uploading, renaming --

    /**
     * Creates a "New Folder" here, selects it, and opens its name for editing.
     *
     * @returns {Promise<void>}
     */
    async createFolder () {
        if ( ! this.acceptsNewItemsHere() ) return;
        const folder = this.currentPath;
        let created;
        try {
            created = await window.puter.fs.mkdir({
                path: path.join(folder, 'New Folder'),
                rename: true,
                overwrite: false,
            });
        } catch ( err ) {
            await UIAlert({
                message: err?.code === 'directory_depth_limit_exceeded'
                    ? i18n('directory_depth_limit_exceeded')
                    : (err?.message || i18n('error_unknown_cause', [], false)),
                parent_uuid: $(this.el_window).attr('data-element_uuid'),
            });
            return;
        }
        if ( this.currentPath !== folder ) return;
        const createdPath = created?.path ?? path.join(folder, created?.name ?? '');
        await this.refresh({ selectPaths: [createdPath] });
        const row = this.rows().find(r => r.getAttribute('data-path') === createdPath);
        if ( row ) window.activate_item_name_editor(row);
    }

    /**
     * Opens the browser's file chooser and uploads what's picked here.
     *
     * @returns {void}
     */
    pickFilesToUpload () {
        if ( ! this.acceptsNewItemsHere() ) return;
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.style.display = 'none';
        input.addEventListener('change', () => {
            const files = Array.from(input.files ?? []);
            input.remove();
            if ( files.length ) this.upload(files);
        });
        // Removed with the window if nothing is ever picked.
        this.$root.append(input);
        input.click();
    }

    /**
     * Uploads into the folder on screen, then selects what was uploaded.
     *
     * @param {FileList|File[]|DataTransferItemList} items
     * @returns {void}
     */
    upload (items) {
        const folder = this.currentPath;
        window.upload_items(items, folder, {
            onUploaded: (paths) => {
                if ( this.currentPath !== folder || ! this.$root[0].isConnected ) return;
                this.refresh({ selectPaths: paths });
            },
        });
    }

    /**
     * Wires a row's name editor (opened by Rename or F2) to rename the item.
     *
     * @param {HTMLElement} row
     * @param {Object} entry
     * @returns {void}
     */
    bindRowEditor (row, entry) {
        const el_name = row.querySelector('.item-name');
        const el_icon = row.querySelector('.item-icon');
        const el_editor = row.querySelector('.item-name-editor');
        if ( ! el_editor ) return;
        let cancelled = false;

        const close = () => {
            $(el_editor).val(row.getAttribute('data-name')).hide().removeClass('item-name-editor-active');
            $(el_name).show();
        };

        $(el_editor).on('keydown', (e) => {
            if ( ! $(el_editor).hasClass('item-name-editor-active') ) return;
            if ( e.key === 'Enter' ) {
                e.preventDefault();
                e.stopPropagation();
                window.last_enter_pressed_to_rename_ts = Date.now();
                el_editor.blur();
            } else if ( e.key === 'Escape' ) {
                e.preventDefault();
                e.stopPropagation();
                cancelled = true;
                close();
                this.focusListing();
            }
        });

        $(el_editor).on('focusout', () => {
            if ( cancelled ) {
                cancelled = false;
                return;
            }
            if ( ! $(el_editor).hasClass('item-name-editor-active') ) return;
            const oldName = row.getAttribute('data-name');
            const oldPath = row.getAttribute('data-path');
            const newName = $(el_editor).val();
            if ( ! newName || newName === oldName || newName === '.' || newName === '..' ) {
                if ( newName === '.' || newName === '..' ) {
                    UIAlert(i18n('reserved_name_not_allowed', { name: newName }, false));
                }
                close();
                return;
            }
            $(el_editor).removeClass('item-name-editor-active');
            entry.path = oldPath;
            window.rename_file(entry, newName, oldName, oldPath, row, el_name, el_icon, el_editor, row.getAttribute('data-website_url'), false, (fsentry) => {
                if ( ! fsentry || ! row.isConnected ) return;
                this.refresh({ selectPaths: [path.join(path.dirname(oldPath), fsentry.name ?? newName)] });
            });
        });
    }

    // -- Keyboard --

    /**
     * The listing's keys, while the keyboard is anywhere in the picker.
     *
     * @returns {void}
     */
    bindKeyboard () {
        $(this.el_window).on('keydown.filepicker', (e) => {
            const focused = document.activeElement;
            if ( $(focused).is('input, textarea') ) return;
            if ( $('.context-menu, .context-menu-modal-backdrop').length > 0 ) return;
            // A focused control takes its own Enter and Space.
            if ( (e.key === 'Enter' || e.key === ' ') && $(focused).is('button, a, [role="button"], [role="link"]') ) return;
            if ( ! this.$root[0].contains(focused) ) return;
            if ( this.handleKey(e) === false ) {
                e.preventDefault();
                e.stopPropagation();
            }
        });
    }

    /**
     * @param {JQuery.KeyDownEvent} e
     * @returns {boolean | undefined} false when the key was used
     */
    handleKey (e) {
        const rows = this.selectableRows();
        const selected = this.selectedRows();

        if ( e.key === 'Enter' ) {
            if ( ! selected.length ) return undefined;
            this.openSelection();
            return false;
        }

        if ( e.key === 'F2' ) {
            if ( selected.length ) window.activate_item_name_editor(selected[0]);
            return false;
        }

        if ( e.key === 'Delete' || (e.key === 'Backspace' && (e.ctrlKey || e.metaKey)) ) {
            if ( selected.length ) this.restructurableRows(selected).then(movable => this.trashRows(movable));
            return false;
        }

        if ( (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' ) {
            if ( this.multiple ) this.setSelection(rows, rows[rows.length - 1]);
            return false;
        }

        if ( e.which >= 33 && e.which <= 40 && ! e.altKey && ! e.metaKey ) {
            if ( ! rows.length ) return false;
            const cursor = selected.includes(this.anchor) ? this.anchor : selected[selected.length - 1];
            if ( ! cursor ) {
                const first = e.which === 35 ? rows[rows.length - 1] : rows[0];
                this.setSelection([first], first);
                first.scrollIntoView({ block: 'nearest' });
                return false;
            }
            const current = rows.indexOf(cursor);
            const cols = this.isGridView() ? gridColumnCount(rows) : 1;
            const rowHeight = $(rows[0]).outerHeight(true) || 1;
            const next = nextRowIndex(e.which, {
                current,
                count: rows.length,
                cols,
                pageRows: Math.floor(this.$files[0].clientHeight / rowHeight),
            });
            if ( next === current || next < 0 ) return false;
            const target = rows[next];
            if ( e.shiftKey && this.multiple ) {
                this.extendSelectionTo(target, rows);
            } else {
                this.setSelection([target], target);
            }
            target.scrollIntoView({ block: 'nearest' });
            return false;
        }

        // No name holds a slash, so typing one starts a path to go to.
        if ( e.key === '/' && ! e.ctrlKey && ! e.metaKey && ! e.altKey && this.typeSearchTerm === '' ) {
            this.openPathEditor('/');
            return false;
        }

        if ( ! e.ctrlKey && ! e.metaKey && ! e.altKey && e.key.length === 1 ) {
            clearTimeout(this.typeSearchTimeout);
            this.typeSearchTimeout = setTimeout(() => {
                this.typeSearchTerm = '';
            }, 700);
            this.typeSearchTerm += e.key.toLowerCase();
            const names = rows.map(row => (row.getAttribute('data-name') || '').toLowerCase());
            const target = typeSelectTarget(names, rows.indexOf(selected[0]), this.typeSearchTerm);
            if ( target !== -1 ) {
                this.setSelection([rows[target]], rows[target]);
                rows[target].scrollIntoView({ block: 'nearest' });
            }
            return false;
        }
        return undefined;
    }

    /**
     * Shift+arrows: selects from where the run started to `target`, on top
     * of what was selected before it.
     *
     * @param {HTMLElement} target
     * @param {HTMLElement[]} rows
     * @returns {void}
     */
    extendSelectionTo (target, rows) {
        const run = this.shiftRun;
        const selected = this.selectedRows();
        const continuing = run && run.cursor === this.anchor
            && run.after.length === selected.length
            && run.after.every(row => row.classList.contains('selected'));
        const { start, before } = continuing ? run : { start: this.anchor, before: selected };
        const from = rows.indexOf(start);
        const to = rows.indexOf(target);
        const range = rows.slice(Math.min(from, to), Math.max(from, to) + 1);
        this.setSelection([...new Set([...before, ...range])], target);
        this.shiftRun = { start, before, cursor: target, after: this.selectedRows() };
    }

    // -- Rubber band and drops --

    /**
     * Drag-selection across rows, for a picker that takes several items.
     *
     * @returns {void}
     */
    initRubberBand () {
        if ( ! this.multiple || window.isMobile?.phone || window.isMobile?.tablet || ! window.SelectionArea ) return;
        const container = this.$files[0];
        container.id = `file-picker-files-${$(this.el_window).attr('data-id')}`;
        let area = null;
        let startX = 0;
        let startY = 0;
        let ctrlToggled = [];

        const selection = new window.SelectionArea({
            selectionContainerClass: 'selection-area-container',
            selectionAreaClass: 'hidden-selection-area',
            container: `#${container.id}`,
            selectables: [`#${container.id} .row.item:not(.item-disabled)`],
            startareas: [`#${container.id}`],
            boundaries: [`#${container.id}`],
            behaviour: {
                overlap: 'drop',
                intersect: 'touch',
                startThreshold: 10,
                scrolling: { speedDivider: 10, manualSpeed: 750, startScrollMargins: { x: 0, y: 0 } },
            },
            features: { touch: false, range: true, singleTap: { allow: false, intersect: 'native' } },
        });
        this.rubberBand = selection;

        const pointIn = (event) => {
            const rect = container.getBoundingClientRect();
            return {
                x: Math.max(0, Math.min(container.scrollWidth, event.clientX - rect.left + container.scrollLeft)),
                y: Math.max(0, Math.min(container.scrollHeight, event.clientY - rect.top + container.scrollTop)),
            };
        };

        selection.on('beforestart', ({ event }) => {
            if ( $(event.target).closest('.row.selected, .item-name-editor').length ) return false;
            ctrlToggled = [];
            ({ x: startX, y: startY } = pointIn(event));
            return true;
        });
        selection.on('start', ({ event }) => {
            if ( ! event.ctrlKey && ! event.metaKey ) {
                this.$files.find('.row.selected').removeClass('selected');
                selection.clearSelection();
            }
            area = document.createElement('div');
            area.className = 'tabfiles-selection-area';
            $(area).css({ position: 'absolute', top: startY, left: startX, width: 0, height: 0, zIndex: 1000, display: 'block' });
            container.append(area);
        });
        selection.on('move', ({ store: { changed: { added, removed } }, event }) => {
            if ( ! event ) return;
            const { x, y } = pointIn(event);
            $(area).css({
                width: Math.abs(x - startX),
                height: Math.abs(y - startY),
                left: Math.min(x, startX),
                top: Math.min(y, startY),
            });
            for ( const el of added ) {
                if ( (event.ctrlKey || event.metaKey) && el.classList.contains('selected') ) {
                    el.classList.remove('selected');
                    ctrlToggled.push(el);
                } else {
                    el.classList.add('selected');
                    this.anchor = el;
                }
            }
            for ( const el of removed ) {
                el.classList.remove('selected');
                if ( ctrlToggled.includes(el) ) el.classList.add('selected');
            }
            this.onChange();
        });
        selection.on('stop', () => {
            if ( area ) {
                area.remove();
                area = null;
                this.rubberBandJustEnded = true;
                setTimeout(() => {
                    this.rubberBandJustEnded = false;
                }, 0);
            }
            this.onChange();
        });
    }

    /**
     * Files dropped from the computer are uploaded into the folder on screen.
     *
     * @returns {void}
     */
    initNativeDrop () {
        const $files = this.$files;
        if ( typeof $files.dragster !== 'function' ) return;
        const isFileDrag = (event) => !! event?.originalEvent?.dataTransfer?.types?.includes('Files');
        $files.dragster({
            enter: (_d, event) => {
                if ( ! isFileDrag(event) || ! this.acceptsNewItemsHere() ) return;
                $('.context-menu').remove();
                $files.addClass('native-drop-active');
            },
            leave: () => $files.removeClass('native-drop-active'),
            over: (_d, event) => {
                if ( isFileDrag(event) && ! this.acceptsNewItemsHere() ) {
                    event.originalEvent.dataTransfer.dropEffect = 'none';
                }
            },
            drop: (_d, event) => {
                $files.removeClass('native-drop-active');
                const e = event.originalEvent;
                if ( ! isFileDrag(event) ) return;
                e.preventDefault();
                e.stopPropagation();
                if ( this.acceptsNewItemsHere() && e.dataTransfer.items?.length ) {
                    this.upload(e.dataTransfer.items);
                }
                return false;
            },
        });
    }

    // -- Changes made elsewhere --

    /**
     * Lists the folder again when another tab or device changes something in it.
     *
     * @returns {void}
     */
    subscribeToChanges () {
        const socket = window.socket;
        if ( ! socket?.on ) return;
        const concerns = (item) => {
            if ( ! item || ! this.currentPath ) return false;
            if ( this.currentPath === window.shared_path ) return true;
            const paths = [item.path, item.old_path, item.from_path].filter(p => typeof p === 'string');
            return paths.some(p => path.dirname(p) === this.currentPath || p === this.currentPath)
                || (!! item.uid && this.$files.find(`.row[data-uid="${CSS.escape(item.uid)}"]`).length > 0);
        };
        for ( const event of ['item.added', 'item.removed', 'item.moved', 'item.renamed', 'item.updated'] ) {
            const handler = (item) => {
                if ( item?.original_client_socket_id === socket.id ) return;
                if ( ! concerns(item) ) return;
                clearTimeout(this.liveRefreshTimer);
                this.liveRefreshTimer = setTimeout(() => {
                    // An open name editor would lose what's typed in it.
                    if ( this.$files.find('.item-name-editor-active').length ) return;
                    this.refresh();
                }, LIVE_REFRESH_DELAY_MS);
            };
            socket.on(event, handler);
            this.socketHandlers.push([event, handler]);
        }
    }

    // -- Loading --

    /** @returns {void} */
    showSpinner () {
        if ( this.$files.find('.files-loading-overlay').length ) return;
        const overlay = $(`<div class="files-loading-overlay"><div class="files-loading-container"><div class="files-loading-spinner"></div><div class="files-loading-text">${i18n('loading')}</div></div></div>`);
        this.$files.append(overlay);
        setTimeout(() => overlay.css('opacity', 1), 100);
    }

    /**
     * Releases what outlives the window: socket listeners and the rubber band.
     *
     * @returns {void}
     */
    destroy () {
        clearTimeout(this.liveRefreshTimer);
        clearTimeout(this.typeSearchTimeout);
        for ( const [event, handler] of this.socketHandlers ) {
            window.socket?.off?.(event, handler);
        }
        this.socketHandlers = [];
        this.rubberBand?.destroy?.();
        this.rubberBand = null;
        this.renderSeq++;
    }
}
