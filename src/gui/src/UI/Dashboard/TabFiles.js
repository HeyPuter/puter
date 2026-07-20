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

/* eslint-disable no-invalid-this */
/* eslint-disable @stylistic/quotes */
import path from '../../lib/path.js';
import open_item from '../../helpers/open_item.js';
import UIContextMenu from '../UIContextMenu.js';
import UIWindowProgress from '../UIWindowProgress.js';
import UIAlert from '../UIAlert.js';
import generate_file_context_menu from '../../helpers/generate_file_context_menu.js';
import truncate_filename from '../../helpers/truncate_filename.js';
import update_title_based_on_uploads from '../../helpers/update_title_based_on_uploads.js';
import item_icon from '../../helpers/item_icon.js';
import new_context_menu_item from '../../helpers/new_context_menu_item.js';
import ContextMenuModal from './ContextMenu/ContextMenu.js';
import UIItemPropertiesModal from './UIItemPropertiesModal.js';

const icons = {
    document: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`,
    files: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    folder: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`,
    more: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>`,
    // Header action icons use the Material Symbols wght300 cut (one step
    // lighter than the default 400) to match the thinned nav arrows.
    newFolder: `<svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="currentcolor"><path d="M570-330h60v-80h80v-60h-80v-80h-60v80h-80v60h80v80ZM172.31-180Q142-180 121-201q-21-21-21-51.31v-455.38Q100-738 121-759q21-21 51.31-21h219.61l80 80h315.77Q818-700 839-679q21 21 21 51.31v375.38Q860-222 839-201q-21 21-51.31 21H172.31Zm0-60h615.38q5.39 0 8.85-3.46t3.46-8.85v-375.38q0-5.39-3.46-8.85t-8.85-3.46H447.38l-80-80H172.31q-5.39 0-8.85 3.46t-3.46 8.85v455.38q0 5.39 3.46 8.85t8.85 3.46ZM160-240v-480 480Z"/></svg>`,
    upload: `<svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="currentcolor"><path d="M450-328.46v-336l-98.61 98.61-42.16-43.38L480-780l170.77 170.77-42.16 43.38L510-664.46v336h-60ZM252.31-180Q222-180 201-201q-21-21-21-51.31v-108.46h60v108.46q0 4.62 3.85 8.46 3.84 3.85 8.46 3.85h455.38q4.62 0 8.46-3.85 3.85-3.84 3.85-8.46v-108.46h60v108.46Q780-222 759-201q-21 21-51.31 21H252.31Z"/></svg>`,
    trash: `<svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="currentcolor"><path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/></svg>`,
    download: `<svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="currentcolor"><path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/></svg>`,
    cut: `<svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="currentcolor"><path d="M760-120 480-400l-94 94q8 15 11 32t3 34q0 66-47 113T240-80q-66 0-113-47T80-240q0-66 47-113t113-47q17 0 34 3t32 11l94-94-94-94q-15 8-32 11t-34 3q-66 0-113-47T80-720q0-66 47-113t113-47q66 0 113 47t47 113q0 17-3 34t-11 32l494 494v40H760ZM600-520l-80-80 240-240h120v40L600-520ZM240-640q33 0 56.5-23.5T320-720q0-33-23.5-56.5T240-800q-33 0-56.5 23.5T160-720q0 33 23.5 56.5T240-640Zm240 180q8 0 14-6t6-14q0-8-6-14t-14-6q-8 0-14 6t-6 14q0 8 6 14t14 6ZM240-160q33 0 56.5-23.5T320-240q0-33-23.5-56.5T240-320q-33 0-56.5 23.5T160-240q0 33 23.5 56.5T240-160Z"/></svg>`,
    copy: `<svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="currentcolor"><path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z"/></svg>`,
    restore: `<svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="currentcolor"><path d="M440-320h80v-166l64 62 56-56-160-160-160 160 56 56 64-62v166ZM280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520Zm-400 0v520-520Z"/></svg>`,
    list: `<svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="currentcolor"><path d="M293.08-597.69v-60H820v60H293.08Zm0 147.69v-60H820v60H293.08Zm0 147.69v-60H820v60H293.08ZM172.31-595.38q-13.73 0-23.02-9.4t-9.29-23.3q0-13.56 9.29-22.74 9.29-9.18 23.02-9.18t23.02 9.18q9.29 9.18 9.29 22.74 0 13.9-9.29 23.3t-23.02 9.4Zm0 147.3q-13.73 0-23.02-9.18Q140-466.43 140-480q0-14.31 9.29-23.5t23.02-9.19q13.73 0 23.02 9.19t9.29 23.5q0 13.57-9.29 22.74-9.29 9.18-23.02 9.18Zm0 148.08q-13.73 0-23.02-9.4T140-332.69q0-13.57 9.29-22.75t23.02-9.18q13.73 0 23.02 9.18t9.29 22.75q0 13.89-9.29 23.29-9.29 9.4-23.02 9.4Z"/></svg>`,
    grid: `<svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="currentcolor"><path d="M140-520v-300h300v300H140Zm0 380v-300h300v300H140Zm380-380v-300h300v300H520Zm0 380v-300h300v300H520ZM200-580h180v-180H200v180Zm380 0h180v-180H580v180Zm0 380h180v-180H580v180Zm-380 0h180v-180H200v180Zm380-380Zm0 200Zm-200 0Zm0-200Z"/></svg>`,
    gridSmall: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3.2" y="3.2" width="4.8" height="4.8" rx="0.8"/><rect x="9.6" y="3.2" width="4.8" height="4.8" rx="0.8"/><rect x="16" y="3.2" width="4.8" height="4.8" rx="0.8"/><rect x="3.2" y="9.6" width="4.8" height="4.8" rx="0.8"/><rect x="9.6" y="9.6" width="4.8" height="4.8" rx="0.8"/><rect x="16" y="9.6" width="4.8" height="4.8" rx="0.8"/><rect x="3.2" y="16" width="4.8" height="4.8" rx="0.8"/><rect x="9.6" y="16" width="4.8" height="4.8" rx="0.8"/><rect x="16" y="16" width="4.8" height="4.8" rx="0.8"/></svg>`,
    sort: `<svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="currentcolor"><path d="M140-260v-60h215v60H140Zm0-190v-60h447.31v60H140Zm0-190v-60h680v60H140Z"/></svg>`,
    select: `<svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="currentcolor"><path d="m424-325.85 268.92-268.92-42.15-42.15L424-410.15l-114-114L267.85-482 424-325.85ZM212.31-140Q182-140 161-161q-21-21-21-51.31v-535.38Q140-778 161-799q21-21 51.31-21h535.38Q778-820 799-799q21 21 21 51.31v535.38Q820-182 799-161q-21 21-51.31 21H212.31Zm0-60h535.38q4.62 0 8.46-3.85 3.85-3.84 3.85-8.46v-535.38q0-4.62-3.85-8.46-3.84-3.85-8.46-3.85H212.31q-4.62 0-8.46 3.85-3.85 3.84-3.85 8.46v535.38q0 4.62 3.85 8.46 3.84 3.85 8.46 3.85ZM200-760v560-560Z"/></svg>`,
    done: `<svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="currentcolor"><path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/></svg>`,
    worker: `<svg xmlns="http://www.w3.org/2000/svg" color="#455a64" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentcolor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-zap-icon lucide-zap"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>`,
};

const { html_encode, SelectionArea } = window;

/**
 * TabFiles - File browser tab component for the Puter Dashboard.
 *
 * Provides a full-featured file management interface including:
 * - Directory navigation with breadcrumb path
 * - List and grid view modes
 * - File sorting by name, size, or modification date
 * - Drag-and-drop file operations (move, copy, shortcut)
 * - Context menus for file/folder operations
 * - File upload with progress tracking
 * - Trash folder support with restore/permanent delete
 *
 * @module TabFiles
 */
const TabFiles = {
    id: 'files',
    label: 'Files',
    icon: icons.files,

    /**
     * Generates the HTML template for the files tab.
     *
     * @returns {string} HTML string containing the file browser structure
     */
    html () {
        let h = `
            <div class="dashboard-tab-content files-tab">
                <form>
                    <input type="file" name="file" id="upload-file-dialog" style="display: none;" multiple="multiple">
                </form>
                <div class="directories">
                    <ul>
                        <li data-folder="Home" style="display: none !important;" data-path="${html_encode(window.home_path)}"><img src="${html_encode(window.icons['folder-home.svg'])}"/> <span>Home</span></li>
                        <li data-folder="Desktop" data-path="${html_encode(window.desktop_path)}"><img src="${html_encode(window.icons['folder-desktop.svg'])}"/> <span>Desktop</span></li>
                        <li data-folder="Documents" data-path="${html_encode(window.documents_path)}"><img src="${html_encode(window.icons['folder-documents.svg'])}"/> <span>Documents</span></li>
                        <li data-folder="Pictures" data-path="${html_encode(window.pictures_path)}"><img src="${html_encode(window.icons['folder-pictures.svg'])}"/> <span>Pictures</span></li>
                        <li data-folder="Public" data-path="${html_encode(window.public_path)}"><img src="${html_encode(window.icons['folder-public.svg'])}"/> <span>Public</span></li>
                        <li data-folder="Videos" data-path="${html_encode(window.videos_path)}"><img src="${html_encode(window.icons['folder-videos.svg'])}"/> <span>Videos</span></li>
                        <li data-folder="Trash" data-path="${html_encode(window.trash_path)}"><img src="${html_encode(window.icons['trash.svg'])}"/> <span>Trash</span></li>
                    </ul>
                </div>
                <div class="directory-contents">
                    <div class="header">
                        <div class="path">
                            <div class="path-nav-buttons">
                                <img draggable="false" class="path-btn path-btn-back path-btn-disabled" src="${html_encode(window.icons['arrow-left-thin.svg'])}" title="${i18n('window_click_to_go_back')}">
                                <img draggable="false" class="path-btn path-btn-forward path-btn-disabled" src="${html_encode(window.icons['arrow-right-thin.svg'])}" title="${i18n('window_click_to_go_forward')}">
                                <img draggable="false" class="path-btn path-btn-up path-btn-disabled" src="${html_encode(window.icons['arrow-up-thin.svg'])}" title="${i18n('window_click_to_go_up')}">
                            </div>
                            <div class="path-breadcrumbs"></div>
                            <div class="path-actions">
                                <button class="path-action-btn select-mode-btn" title="${i18n('select')}">${icons.select}</button>
                                <button class="path-action-btn sort-btn" title="${i18n('sort_by')}">${icons.sort}</button>
                                <button class="path-action-btn view-toggle-btn" title="${i18n('toggle_view')}">${icons.grid}</button>
                                <button class="path-action-btn new-folder-btn" title="${i18n('new_folder')}">${icons.newFolder}</button>
                                <button class="path-action-btn upload-btn" title="${i18n('upload')}">${icons.upload}</button>
                            </div>
                        </div>
                        <div class="columns">
                            <div class="item-icon"></div>
                            <div class="item-name sortable" data-sort="name">${i18n('name')}</div>
                            <div class="col-resize-handle" data-resize="name"></div>
                            <div class="item-size sortable" data-sort="size">${i18n('size')}</div>
                            <div class="col-resize-handle" data-resize="size"></div>
                            <div class="item-modified sortable" data-sort="modified">${i18n('modified')}</div>
                            <div class="col-resize-handle" data-resize="modified"></div>
                            <div class="item-more"></div>
                        </div>
                    </div>
                    <div class="files"></div>
                    <div class="files-footer">
                        <span class="files-footer-item-count"></span>
                        <span class="files-footer-separator"> | </span>
                        <span class="files-footer-selected-items"></span>
                    </div>
                    <div class="files-selection-actions">
                        <button class="selection-action-btn restore-btn" title="${i18n('restore')}">${icons.restore}<span>${i18n('restore')}</span></button>
                        <button class="selection-action-btn download-btn" title="${i18n('download')}">${icons.download}<span>${i18n('download')}</span></button>
                        <button class="selection-action-btn cut-btn" title="${i18n('cut')}">${icons.cut}<span>${i18n('cut')}</span></button>
                        <button class="selection-action-btn copy-btn" title="${i18n('copy')}">${icons.copy}<span>${i18n('copy')}</span></button>
                        <button class="selection-action-btn delete-btn" title="${i18n('delete')}">${icons.trash}<span>${i18n('delete')}</span></button>
                        <button class="selection-action-btn done-btn" title="${i18n('done')}">${icons.done}<span>${i18n('done')}</span></button>
                    </div>
                </div>
            </div>
        `;
        return h;
    },

    /**
     * Initializes the files tab with event listeners and state.
     *
     * Sets up folder click handlers, drag-and-drop zones, context menus,
     * and restores persisted preferences (view mode, sort settings, column widths).
     *
     * @param {jQuery} $el_window - The jQuery-wrapped window/container element
     * @returns {Promise<void>}
     */
    async init ($el_window) {
        this.showSpinner();
        const _this = this;
        window.dashboard_object = _this;

        // Refresh an existing row in place from an fs entry. Shared with
        // UIDashboard's item.updated socket handler so the two paths can't
        // drift — e.g. trashed items must show metadata.original_name, not
        // the UID that is their raw name (matching renderItem).
        window.UIDashboardFileItemUpdate = function ($row, file) {
            // Minimal update payloads may omit fields — only write what the
            // event actually carries, so it can't blank a correct name/path
            // (or zero a size) that is already on screen. A metadata-only
            // payload without original_name resolves to '' and is skipped too.
            let displayName = file.name || '';
            try {
                const meta = file.metadata ? JSON.parse(file.metadata) : null;
                if ( meta && meta.original_name ) displayName = meta.original_name;
            } catch { /* keep raw name */ }
            if ( displayName ) {
                $row.attr('data-name', displayName);
                $row.find('.item-name').text(displayName);
                $row.find('.item-name-editor').val(displayName);
            }
            if ( file.path ) $row.attr('data-path', file.path);
            if ( typeof file.type !== 'undefined' ) $row.attr('data-type', file.type || '');
            // Refresh the visible Size/Modified cells too, not just the
            // hidden data attributes, so a remote overwrite is reflected.
            // Only when the payload actually carries the field — a minimal
            // update event must not zero out a correct value on screen.
            if ( typeof file.size !== 'undefined' ) {
                $row.attr('data-size', file.size || 0);
                if ( $row.attr('data-is_dir') !== '1' ) {
                    $row.find('.item-size').text(_this.formatFileSize(file.size));
                }
            }
            if ( file.modified ) {
                $row.attr('data-modified', file.modified);
                $row.find('.item-modified').text(window.timeago.format(file.modified * 1000));
            }
            if (
                _this.isGridView() &&
                typeof file.thumbnail === 'string' &&
                file.thumbnail.length > 0
            ) {
                $row.find('.item-icon img').attr('src', file.thumbnail);
            }
            // The footer's item-count/total-size line is computed from the
            // rows' data-size attributes — keep it in step with the cell.
            _this.updateFooterStats();
        };

        // Dashboard-compatible item creator for use by helpers.js and socket handlers.
        // Wraps renderItem() with a directory check so items are only added
        // when the user is viewing the relevant directory.
        window.UIDashboardFileItem = async function (file) {
            if ( ! _this.currentPath ) return;
            if ( _this.renderingDirectory ) return;
            if ( _this._creatingItem ) return;

            const parentDir = path.dirname(file.path);
            if ( _this.currentPath !== parentDir ) return;

            // If item already exists in view, update in-place.
            const $existingRow = $(`.files-tab .files .item[data-uid='${file.uid}']`);
            if ( $existingRow.length > 0 ) {
                window.UIDashboardFileItemUpdate($existingRow, file);
                return;
            }

            // If the directory was empty, drop the "No files in this directory."
            // placeholder before inserting the first real row — otherwise it
            // stays and overlaps the new item.
            _this.$el_window.find('.files-tab .files > div:not(.item)').remove();

            await _this.renderItem(file);

            // Get the newly appended row (it's always last after renderItem)
            const $newRow = _this.$el_window.find(`.files-tab .files .item[data-uid='${file.uid}']`);
            if ( $newRow.length === 0 ) return;

            // Insert at correct sorted position
            _this.insertAtSortedPosition($newRow, file);

            // Apply column widths to match existing rows
            _this.applyColumnWidths();

            // Highlight animation to indicate newly added item
            $newRow.addClass('item-newly-added');

            // Reflect the new item in the footer item count / total size.
            _this.updateFooterStats();
        };

        this.renderingDirectory = false;
        this._creatingItem = false;
        this.activeMenuFileUid = null;
        this.currentPath = null;
        this.currentPath = null;
        this.folderDwellTimer = null;
        this.folderDwellTarget = null;
        this.springLoadedActive = false;
        this.springLoadedOriginalPath = null;
        this.previewOpen = false;
        this.previewCurrentUid = null;
        this.typeSearchTerm = '';
        this.typeSearchTimeout = null;
        this.selectModeActive = false;
        this.currentView = await puter.kv.get('view_mode') || 'list';

        // Sorting state
        this.sortColumn = await puter.kv.get('sort_column') || 'name';
        this.sortDirection = await puter.kv.get('sort_direction') || 'asc';

        // Column widths state (for resizing)
        const savedWidths = await puter.kv.get('column_widths');
        this.columnWidths = savedWidths ? JSON.parse(savedWidths) : {
            name: null, // auto/flex
            size: 100,
            modified: 120,
        };

        // Add touch-device class for touch devices to show .item-more button
        // Use multiple detection methods since user-agent sniffing can miss devices
        if ( window.isMobile.phone || window.isMobile.tablet || navigator.maxTouchPoints > 0 ) {
            $el_window.find('.files-tab').addClass('touch-device');
        }

        // Create click handler for each folder item
        $el_window.find('[data-folder]').each(function () {
            const folderElement = this;

            folderElement.onclick = async () => {
                const folderPath = folderElement.getAttribute('data-path');
                _this.pushNavHistory(folderPath);
                _this.renderDirectory(folderPath);
            };

            // Context menu for sidebar folders
            $(folderElement).on('contextmenu taphold', async (e) => {
                if ( e.type === 'taphold' && !window.isMobile.phone && !window.isMobile.tablet ) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                $(folderElement).addClass('context-menu-active');
                const folderPath = folderElement.getAttribute('data-path');
                const items = _this.generateFolderContextMenu(folderPath);

                if ( window.isMobile.phone || window.isMobile.tablet ) {
                    const modal = new ContextMenuModal({
                        onClose: () => $(folderElement).removeClass('context-menu-active'),
                    });
                    modal.show(items, folderElement.getBoundingClientRect());
                } else {
                    const menu = UIContextMenu({ items: items, position: { left: e.pageX, top: e.pageY } });
                    menu.onClose = () => {
                        $(folderElement).removeClass('context-menu-active');
                    };
                }
            });

            // Make sidebar folders droppable
            $(folderElement).droppable({
                accept: '.row',
                tolerance: 'pointer',

                drop: async function (event, ui) {
                    // Clear dwell timer to prevent folder from opening after drop
                    clearTimeout(_this.folderDwellTimer);
                    _this.folderDwellTimer = null;
                    _this.folderDwellTarget = null;

                    // Block if ctrl and trashed
                    const draggedPath = $(ui.draggable).attr('data-path');
                    if ( event.ctrlKey && draggedPath?.startsWith(`${window.trash_path}/`) ) {
                        return;
                    }

                    ui.helper.data('dropped', true);

                    // Get target folder path from the element itself. Using the
                    // element's own data-path covers folders (Public, Home) that
                    // aren't keyed in window.user.directories.
                    const targetPath = folderElement.getAttribute('data-path');

                    if ( ! targetPath ) return;

                    // Collect all items to move
                    const itemsToMove = [ui.draggable[0]];

                    // Add other selected items
                    $('.item-selected-clone').each(function () {
                        const sourceId = $(this).find('.row').attr('data-id');
                        const sourceItem = document.querySelector(`.row[data-id="${sourceId}"]`);
                        if ( sourceItem ) itemsToMove.push(sourceItem);
                    });

                    // Perform operation based on modifier keys
                    if ( event.ctrlKey ) {
                        // Copy
                        await window.copy_items(itemsToMove, targetPath);
                    }
                    else if ( event.altKey && window.feature_flags?.create_shortcut ) {
                        // Create shortcuts
                        for ( const item of itemsToMove ) {
                            const itemPath = $(item).attr('data-path');
                            const itemName = itemPath.split('/').pop();
                            const isDir = $(item).attr('data-is_dir') === '1';
                            const shortcutTo = $(item).attr('data-shortcut_to') || $(item).attr('data-uid');
                            const shortcutToPath = $(item).attr('data-shortcut_to_path') || itemPath;

                            await window.create_shortcut(itemName, isDir, targetPath, null, shortcutTo, shortcutToPath);
                        }
                    }
                    else {
                        // Move
                        await window.move_items(itemsToMove, targetPath);
                    }
                },

                over: function (_event, ui) {
                    if ( $(ui.draggable).hasClass('row') ) {
                        $(folderElement).addClass('active');

                        const folderPath = folderElement.getAttribute('data-path');

                        // Don't auto-open the current directory or trash
                        if ( folderPath === _this.currentPath ||
                            folderPath === window.trash_path ) {
                            return;
                        }

                        // Clear any existing dwell timer
                        clearTimeout(_this.folderDwellTimer);

                        // Add visual feedback animation
                        $(folderElement).addClass('dwell-opening');
                        _this.folderDwellTarget = folderElement;

                        // Start dwell timer — navigate into folder after 700ms
                        _this.folderDwellTimer = setTimeout(async () => {
                            _this.folderDwellTimer = null;
                            _this.folderDwellTarget = null;
                            if ( ! _this.springLoadedActive ) {
                                _this.springLoadedOriginalPath = _this.currentPath;
                            }
                            _this.springLoadedActive = true;
                            $('.drag-cancel-zone').show();
                            $(folderElement).removeClass('dwell-opening active');

                            _this.pushNavHistory(folderPath);
                            await _this.renderDirectory(folderPath);

                            // Refresh jQuery UI droppable detection for the active drag
                            if ( $.ui.ddmanager && $.ui.ddmanager.current ) {
                                $.ui.ddmanager.current.helper.addClass('ui-draggable-dragging');
                                $.ui.ddmanager.prepareOffsets($.ui.ddmanager.current);
                            }
                        }, 700);
                    }
                },

                out: function (_event, ui) {
                    if ( $(ui.draggable).hasClass('row') ) {
                        // Clear dwell timer
                        if ( _this.folderDwellTarget === folderElement ) {
                            clearTimeout(_this.folderDwellTimer);
                            _this.folderDwellTimer = null;
                            _this.folderDwellTarget = null;
                        }
                        $(folderElement).removeClass('dwell-opening');

                        // Only remove active if it's not the currently selected folder
                        const folderPath = folderElement.getAttribute('data-path');

                        if ( folderPath !== _this.currentPath ) {
                            $(folderElement).removeClass('active');
                        }
                    }
                },
            });

            // Add native file drop support to sidebar folders
            $(folderElement).dragster({
                enter: function (_dragsterEvent, event) {
                    const e = event.originalEvent;
                    if ( ! e.dataTransfer?.types?.includes('Files') ) {
                        return;
                    }

                    const folderPath = folderElement.getAttribute('data-path');

                    // Don't allow drop on trash
                    if ( folderPath === window.trash_path ) {
                        return;
                    }

                    $(folderElement).addClass('native-drop-target');
                },

                leave: function (_dragsterEvent, _event) {
                    $(folderElement).removeClass('native-drop-target');
                },

                drop: async function (_dragsterEvent, event) {
                    const e = event.originalEvent;
                    $(folderElement).removeClass('native-drop-target');

                    if ( ! e.dataTransfer?.types?.includes('Files') ) {
                        return;
                    }

                    const folderPath = folderElement.getAttribute('data-path');

                    // Block uploads to trash
                    if ( folderPath === window.trash_path ) {
                        return;
                    }

                    if ( e.dataTransfer?.items?.length > 0 ) {
                        _this.uploadFiles(e.dataTransfer.items, folderPath);
                    }

                    e.stopPropagation();
                    e.preventDefault();
                    return false;
                },
            });
        });

        // Clear selection when clicking empty area (but not after rubber band selection)
        $el_window.find('.dashboard-tab-content').on('click', (e) => {
            // Skip if this click is the end of a rubber band selection
            if ( _this.rubberBandSelectionJustEnded ) {
                _this.rubberBandSelectionJustEnded = false;
                return;
            }
            if ( e.target === e.currentTarget || e.target.classList.contains('files') ) {
                document.querySelectorAll('.files-tab .row.selected').forEach(r => {
                    r.classList.remove('selected');
                });
                _this.updateFooterStats();
            }
        });

        // Right-click on background shows folder context menu
        $el_window.find('.files').on('contextmenu taphold', async (e) => {
            // Dismiss taphold on non-touch devices
            if ( e.type === 'taphold' && !window.isMobile.phone && !window.isMobile.tablet ) {
                return;
            }
            // Only trigger if clicking directly on .files container (not on a row)
            if ( e.target.classList.contains('files') ||
                e.target.classList.contains('files-list-view') ||
                e.target.classList.contains('files-grid-view') ) {
                e.preventDefault();
                e.stopPropagation();
                // Clear selection when right-clicking background
                document.querySelectorAll('.files-tab .row.selected').forEach(r => {
                    r.classList.remove('selected');
                });
                _this.updateFooterStats();
                const items = await _this.generateFolderContextMenu();
                if ( window.isMobile.phone || window.isMobile.tablet ) {
                    const modal = new ContextMenuModal();
                    modal.show(items, e.target.getBoundingClientRect());
                } else {
                    UIContextMenu({ items: items, position: { left: e.pageX, top: e.pageY } });
                }
            }
        });

        // Store reference to $el_window for later use (must be before createHeaderEventListeners)
        this.$el_window = $el_window;

        this.createHeaderEventListeners($el_window);
        this.createSelectionActionListeners($el_window);
        this.initRubberBandSelection();
        this.initNativeFileDrop();

        // Apply initial view mode from persisted preferences
        this.applyViewMode();

        // Check for initial file path from URL routing
        if ( window.dashboard_initial_file_path ) {
            const initialPath = window.dashboard_initial_file_path;
            delete window.dashboard_initial_file_path; // Clear so it only runs once
            this.pushNavHistory(initialPath);
            this.renderDirectory(initialPath, { skipUrlUpdate: true });
        } else {
            // Auto-select Desktop folder on initialization
            const desktopFolder = $el_window.find('[data-folder="Desktop"]');
            if ( desktopFolder.length ) {
                desktopFolder.trigger('click');
            }
        }

        // Setup keyboard shortcuts
        this.setupKeyboardShortcuts();

        // Refresh current directory when the user returns to this browser tab
        document.addEventListener('visibilitychange', () => {
            if ( document.visibilityState === 'visible' && this.currentPath ) {
                this.renderDirectory(this.currentPath, { skipNavHistory: true, skipUrlUpdate: true });
            }
        });
    },

    /**
     * Called when the Files tab becomes active.
     * Updates the URL hash to reflect the current file path.
     *
     * @param {jQuery} _$el_window - The jQuery-wrapped window/container element (unused)
     * @returns {void}
     */
    onActivate (_$el_window) {
        // Update URL to show current path when Files tab becomes active
        if ( this.currentPath && window.is_dashboard_mode ) {
            this.updateDashboardUrl(this.currentPath);
        }
    },

    /**
     * Checks if the Dashboard Files tab is currently active and visible.
     *
     * @returns {boolean} True if Dashboard is visible and Files tab is active
     */
    isDashboardFilesActive () {
        if ( !this.$el_window || !this.$el_window.is(':visible') ) return false;
        const filesSection = this.$el_window.find('.dashboard-section-files');
        return filesSection.hasClass('active');
    },

    /**
     * Sets up Dashboard-specific keyboard shortcuts.
     *
     * Handles arrow navigation, selection, copy/cut/paste, delete, rename, etc.
     */
    setupKeyboardShortcuts () {
        const _this = this;

        $(document).on('keydown.tabfiles', async function (e) {
            // Only handle if Dashboard Files tab is active
            if ( ! _this.isDashboardFilesActive() ) return;

            const focused_el = document.activeElement;

            // Skip if user is typing in an input/textarea (except for Escape)
            if ( $(focused_el).is('input, textarea') && e.which !== 27 ) return;

            // When a context menu is open, yield control to keyboard.js
            if ( $('.context-menu').length > 0 ) {
                if ( (e.which >= 37 && e.which <= 40) || e.which === 13 || e.which === 27 ) {
                    return;
                }
                if ( !e.ctrlKey && !e.metaKey && e.key.length === 1 ) {
                    return;
                }
            }

            const $container = _this.$el_window.find('.files-tab .files');
            const $allRows = $container.find('.row');
            const $selectedRows = $container.find('.row.selected');

            // F2 - Rename selected item
            if ( e.which === 113 ) {
                const $selectedRow = $selectedRows.first();
                if ( $selectedRow.length > 0 ) {
                    e.preventDefault();
                    e.stopPropagation();
                    const $nameEditor = $selectedRow.find('.item-name-editor');
                    const $itemName = $selectedRow.find('.item-name');
                    if ( $nameEditor.length > 0 ) {
                        $itemName.hide();
                        $nameEditor.show().addClass('item-name-editor-active').focus().select();
                    }
                }
                return false;
            }

            // Enter - Open selected items
            if ( e.which === 13 && !$(focused_el).hasClass('item-name-editor') ) {
                if ( $selectedRows.length > 0 ) {
                    e.preventDefault();
                    e.stopPropagation();
                    $selectedRows.each(function () {
                        const isDir = $(this).attr('data-is_dir') === '1';
                        const itemPath = $(this).attr('data-path');
                        if ( isDir ) {
                            _this.pushNavHistory(itemPath);
                            _this.renderDirectory(itemPath);
                        } else {
                            open_item({ item: this });
                        }
                    });
                }
                return false;
            }

            // Escape - Cancel drag, clear selection, or cancel rename
            if ( e.which === 27 ) {
                // Cancel active drag operation
                if ( window.an_item_is_being_dragged ) {
                    e.preventDefault();
                    e.stopPropagation();

                    if ( _this.springLoadedActive ) {
                        _this.navigateBackFromSpringLoad();
                    }
                    _this.springLoadedActive = false;
                    _this.springLoadedOriginalPath = null;

                    // Force jQuery UI to end the drag
                    $(document).trigger('mouseup');

                    // Cleanup
                    $('.drag-cancel-zone').remove();
                    $('.item-selected-clone').remove();
                    $('.draggable-count-badge').remove();
                    window.an_item_is_being_dragged = false;
                    $('.window-app-iframe').css('pointer-events', 'auto');
                    return false;
                }

                if ( $(focused_el).hasClass('item-name-editor') ) {
                    // Cancel rename - handled by item's own keyup handler
                    return;
                }
                $selectedRows.removeClass('selected');
                _this.updateFooterStats();
                return false;
            }

            // Delete - Move to trash or permanently delete
            if ( e.keyCode === 46 || (e.keyCode === 8 && (e.ctrlKey || e.metaKey)) ) {
                if ( $selectedRows.length > 0 ) {
                    e.preventDefault();
                    e.stopPropagation();

                    // Check if any items are in trash (for permanent delete)
                    const trashedItems = $selectedRows.filter(function () {
                        return $(this).attr('data-path')?.startsWith(`${window.trash_path}/`);
                    });

                    if ( trashedItems.length > 0 ) {
                        // Permanent delete with confirmation
                        const alert_resp = await UIAlert({
                            message: i18n('confirm_delete_multiple_items'),
                            buttons: [
                                { label: i18n('delete'), value: 'delete', type: 'primary' },
                                { label: i18n('cancel'), value: 'cancel' },
                            ],
                        });
                        if ( alert_resp === 'delete' ) {
                            for ( const row of trashedItems.toArray() ) {
                                await window.delete_item(row);
                            }
                        }
                    } else {
                        // Move to trash
                        await window.move_items($selectedRows.toArray(), window.trash_path);
                    }
                }
                return false;
            }

            // Ctrl/Cmd + A - Select all
            if ( (e.ctrlKey || e.metaKey) && e.which === 65 ) {
                e.preventDefault();
                e.stopPropagation();
                $allRows.addClass('selected');
                if ( $allRows.length > 0 ) {
                    window.active_element = $allRows.last().get(0);
                    window.latest_selected_item = $allRows.last().get(0);
                }
                _this.updateFooterStats();
                return false;
            }

            // Ctrl/Cmd + C - Copy
            if ( (e.ctrlKey || e.metaKey) && e.which === 67 ) {
                if ( $selectedRows.length > 0 ) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.clipboard = [];
                    window.clipboard_op = 'copy';
                    $selectedRows.each(function () {
                        if ( $(this).attr('data-path') !== window.trash_path ) {
                            window.clipboard.push({
                                path: $(this).attr('data-path'),
                                uid: $(this).attr('data-uid'),
                                metadata: $(this).attr('data-metadata'),
                            });
                        }
                    });
                }
                return false;
            }

            // Ctrl/Cmd + X - Cut
            if ( (e.ctrlKey || e.metaKey) && e.which === 88 ) {
                if ( $selectedRows.length > 0 ) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.clipboard = [];
                    window.clipboard_op = 'move';
                    $selectedRows.each(function () {
                        window.clipboard.push({
                            path: $(this).attr('data-path'),
                            uid: $(this).attr('data-uid'),
                        });
                    });
                }
                return false;
            }

            // Ctrl/Cmd + V - Paste
            if ( (e.ctrlKey || e.metaKey) && e.which === 86 ) {
                if ( window.clipboard.length > 0 && _this.currentPath ) {
                    e.preventDefault();
                    e.stopPropagation();
                    // Don't allow paste in Trash unless it's a move operation
                    if ( _this.currentPath.startsWith(window.trash_path) && window.clipboard_op !== 'move' ) {
                        return false;
                    }
                    if ( window.clipboard_op === 'copy' ) {
                        window.copy_clipboard_items(_this.currentPath, null);
                    } else {
                        _this.moveClipboardItems(_this.currentPath).then(() => {
                            _this.renderDirectory(_this.currentPath);
                        });
                    }
                }
                return false;
            }

            // Arrow keys - Navigate items
            if ( e.which >= 37 && e.which <= 40 ) {
                e.preventDefault();
                e.stopPropagation();

                if ( $allRows.length === 0 ) return false;

                // If nothing selected, select first item
                if ( $selectedRows.length === 0 ) {
                    const $first = $allRows.first();
                    $first.addClass('selected');
                    window.active_element = $first.get(0);
                    window.latest_selected_item = $first.get(0);
                    $first.get(0).scrollIntoView({ block: 'nearest' });
                    _this.updateFooterStats();
                    return false;
                }

                // Find current item and calculate next
                const $current = $(window.latest_selected_item || $selectedRows.last().get(0));
                const currentIndex = $allRows.index($current);
                let nextIndex = currentIndex;

                // Calculate grid dimensions for grid view
                const isGridView = $container.hasClass('files-grid-view');
                let cols = 1;
                if ( isGridView && $allRows.length > 1 ) {
                    const firstTop = $allRows.eq(0).offset().top;
                    for ( let i = 1; i < $allRows.length; i++ ) {
                        if ( $allRows.eq(i).offset().top !== firstTop ) {
                            cols = i;
                            break;
                        }
                    }
                    if ( cols === 1 ) cols = $allRows.length; // All on one row
                }

                // Calculate next index based on arrow key
                switch ( e.which ) {
                    case 37: // Left
                        nextIndex = Math.max(0, currentIndex - 1);
                        break;
                    case 38: // Up
                        nextIndex = Math.max(0, currentIndex - cols);
                        break;
                    case 39: // Right
                        nextIndex = Math.min($allRows.length - 1, currentIndex + 1);
                        break;
                    case 40: // Down
                        nextIndex = Math.min($allRows.length - 1, currentIndex + cols);
                        break;
                }

                if ( nextIndex !== currentIndex ) {
                    const $next = $allRows.eq(nextIndex);

                    if ( ! e.shiftKey ) {
                        // Normal navigation - clear selection
                        $allRows.removeClass('selected');
                    }

                    $next.addClass('selected');
                    window.active_element = $next.get(0);
                    window.latest_selected_item = $next.get(0);
                    $next.get(0).scrollIntoView({ block: 'nearest' });
                    _this.updateFooterStats();

                    // If preview is open, switch to newly selected file
                    if ( _this.previewOpen && !e.shiftKey ) {
                        const newUid = $next.attr('data-uid');
                        if ( newUid !== _this.previewCurrentUid ) {
                            _this.showImagePreview($next);
                        }
                    }
                }

                return false;
            }

            // Space - Toggle image preview
            if ( e.which === 32 ) {
                e.preventDefault();
                e.stopPropagation();

                // If preview is open, close it
                if ( _this.previewOpen ) {
                    _this.closeImagePreview();
                    return false;
                }

                // Open preview for single selected image file
                if ( $selectedRows.length === 1 ) {
                    const $row = $selectedRows.first();
                    const isDir = $row.attr('data-is_dir') === '1';
                    if ( ! isDir ) {
                        _this.showImagePreview($row);
                    }
                }
                return false;
            }

            // Type-to-select: letter/number keys search items by name
            if ( !e.ctrlKey && !e.metaKey && e.key.length === 1 ) {
                e.preventDefault();
                e.stopImmediatePropagation();

                if ( _this.typeSearchTerm !== '' ) {
                    clearTimeout(_this.typeSearchTimeout);
                }

                _this.typeSearchTimeout = setTimeout(() => {
                    _this.typeSearchTerm = '';
                }, 700);

                _this.typeSearchTerm += e.key.toLocaleLowerCase();

                let matches = [];
                const $currentSelected = $selectedRows.first();

                // If selected item already matches, keep it
                if ( $currentSelected.length === 1 ) {
                    const selectedName = ($currentSelected.attr('data-name') || '').toLowerCase();
                    if ( selectedName.startsWith(_this.typeSearchTerm) ) {
                        return false;
                    }
                }

                // Search all rows for matches
                for ( let j = 0; j < $allRows.length; j++ ) {
                    const name = ($allRows.eq(j).attr('data-name') || '').toLowerCase();
                    if ( name.startsWith(_this.typeSearchTerm) ) {
                        matches.push($allRows.get(j));
                    }
                }

                if ( matches.length > 0 ) {
                    // If multiple matches and one is selected, cycle past it
                    if ( $currentSelected.length > 0 && matches.length > 1 ) {
                        let match_index;
                        for ( let i = 0; i < matches.length - 1; i++ ) {
                            if ( $(matches[i]).is($currentSelected) ) {
                                match_index = i;
                                break;
                            }
                        }
                        if ( match_index !== undefined ) {
                            matches.splice(0, match_index + 1);
                        }
                    }

                    // Deselect all, select the match
                    $allRows.removeClass('selected');
                    $(matches[0]).addClass('selected');
                    window.active_element = matches[0];
                    window.latest_selected_item = matches[0];
                    matches[0].scrollIntoView({ block: 'nearest' });
                    _this.updateFooterStats();
                }

                return false;
            }
        });
    },

    /**
     * Shows an image preview popover for the selected file.
     *
     * Fetches a signed URL for the actual image and displays it in a centered
     * popover. The popover can be dismissed by pressing spacebar or clicking outside.
     *
     * @param {jQuery} $row - The selected row element
     * @returns {Promise<void>}
     */
    async showImagePreview ($row) {
        const uid = $row.attr('data-uid');
        const fileName = $row.attr('data-name');
        const filePath = $row.attr('data-path');

        // Check if it's an image file
        const extension = fileName.split('.').pop().toLowerCase();
        const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
        if ( ! imageExtensions.includes(extension) ) {
            return;
        }

        // Get read URL for the actual image
        const imageUrl = await puter.fs.getReadURL(filePath);

        // Remove any existing preview
        $('.image-preview-popover').remove();

        const $filesContainer = this.$el_window.find('.files-tab .files');
        const containerWidth = $filesContainer.width();
        const containerOffset = $filesContainer.offset();

        const previewHtml = `
            <div class="image-preview-popover" data-uid="${html_encode(uid)}">
                <img src="${html_encode(imageUrl)}" alt="${html_encode(fileName)}" />
                <div class="image-preview-name">${html_encode(fileName)}</div>
            </div>
        `;

        $('body').append(previewHtml);
        const $popover = $('.image-preview-popover');

        // Position centered over the files container
        $popover.css({
            maxWidth: `${containerWidth - 40}px`,
            width: '100%',
            left: `${containerOffset.left + (containerWidth / 2)}px`,
            top: `${containerOffset.top + ($filesContainer.height() / 2)}px`,
            transform: 'translate(-50%, -50%)',
        });

        this.previewOpen = true;
        this.previewCurrentUid = uid;

        // Close on click outside the popover. Remove any prior handler first so
        // repeated calls (image arrow-navigation) don't stack duplicate handlers.
        const _this = this;
        $(document).off('click.imagepreview').on('click.imagepreview', (e) => {
            if ( ! $(e.target).closest('.image-preview-popover').length ) {
                _this.closeImagePreview();
            }
        });
    },

    /**
     * Closes the image preview popover.
     *
     * @returns {void}
     */
    closeImagePreview () {
        $('.image-preview-popover').remove();
        $(document).off('click.imagepreview');
        this.previewOpen = false;
        this.previewCurrentUid = null;
    },

    /**
     * Sets up event listeners for header controls.
     *
     * Handles navigation buttons (back/forward/up), new folder, upload,
     * view toggle, sort menu, and column header sorting.
     *
     * @returns {void}
     */
    createHeaderEventListeners () {
        const _this = this;
        const fileInput = document.querySelector('#upload-file-dialog');

        const el_window_navbar_back_btn = document.querySelector(`.path-btn-back`);
        const el_window_navbar_forward_btn = document.querySelector(`.path-btn-forward`);
        const el_window_navbar_up_btn = document.querySelector(`.path-btn-up`);

        // Back button
        $(el_window_navbar_back_btn).on('click', function () {
            // if history menu is open don't continue
            if ( $(el_window_navbar_back_btn).hasClass('has-open-contextmenu') ) {
                return;
            }
            if ( window.dashboard_nav_history_current_position > 0 ) {
                window.dashboard_nav_history_current_position--;
                const new_path = window.dashboard_nav_history[window.dashboard_nav_history_current_position];
                _this.renderDirectory(new_path);
            }
        });

        // Back button (hold click)
        $(el_window_navbar_back_btn).on('taphold', function () {
            let items = [];
            const pos = el_window_navbar_back_btn.getBoundingClientRect();

            for ( let index = window.dashboard_nav_history_current_position - 1; index >= 0; index-- ) {
                const history_item = window.dashboard_nav_history[index];

                items.push({
                    html: `<span>${history_item === window.home_path ? i18n('home') : html_encode(path.basename(history_item))}</span>`,
                    val: index,
                    onClick: function (e) {
                        window.dashboard_nav_history_current_position = e.value;
                        const new_path = window.dashboard_nav_history[window.dashboard_nav_history_current_position];
                        _this.renderDirectory(new_path);
                    },
                });
            }

            if ( items.length > 0 ) {
                UIContextMenu({
                    position: { top: pos.top + pos.height + 3, left: pos.left },
                    parent_element: el_window_navbar_back_btn,
                    items: items,
                });
            }
        });

        // Forward button
        $(el_window_navbar_forward_btn).on('click', function () {
            // if history menu is open don't continue
            if ( $(el_window_navbar_forward_btn).hasClass('has-open-contextmenu') ) {
                return;
            }
            if ( window.dashboard_nav_history_current_position < window.dashboard_nav_history.length - 1 ) {
                window.dashboard_nav_history_current_position++;
                const target_path = window.dashboard_nav_history[window.dashboard_nav_history_current_position];
                _this.renderDirectory(target_path);
            }
        });

        // Forward button (hold click)
        $(el_window_navbar_forward_btn).on('taphold', function () {
            let items = [];
            const pos = el_window_navbar_forward_btn.getBoundingClientRect();

            for ( let index = window.dashboard_nav_history_current_position + 1; index < window.dashboard_nav_history.length; index++ ) {
                const history_item = window.dashboard_nav_history[index];

                items.push({
                    html: `<span>${history_item === window.home_path ? i18n('home') : html_encode(path.basename(history_item))}</span>`,
                    val: index,
                    onClick: function (e) {
                        window.dashboard_nav_history_current_position = e.value;
                        const new_path = window.dashboard_nav_history[window.dashboard_nav_history_current_position];
                        _this.renderDirectory(new_path);
                    },
                });
            }

            if ( items.length > 0 ) {
                UIContextMenu({
                    parent_element: el_window_navbar_forward_btn,
                    position: { top: pos.top + pos.height + 3, left: pos.left },
                    items: items,
                });
            }
        });

        // Up button
        $(el_window_navbar_up_btn).on('click', function () {
            if ( _this.currentPath === '/' ) return;

            const target_path = path.resolve(path.join(_this.currentPath, '..'));
            _this.pushNavHistory(target_path);
            _this.renderDirectory(target_path);
        });

        // New folder button
        document.querySelector('.new-folder-btn').onclick = async () => {
            if ( ! _this.currentPath ) return;
            try {
                const result = await puter.fs.mkdir({
                    path: `${_this.currentPath}/New Folder`,
                    rename: true,
                    overwrite: false,
                });
                await _this.renderDirectory(_this.currentPath);
                // Find and select the new folder, then activate rename
                const newFolderRow = this.$el_window.find(`.files-tab .row[data-name="${result.name}"]`);
                if ( newFolderRow.length > 0 ) {
                    newFolderRow.addClass('selected');
                    window.activate_item_name_editor(newFolderRow[0]);
                }
            } catch ( err ) {
                // Folder creation failed silently
            }
        };

        // Upload input element
        fileInput.onchange = async (e) => {
            const files = e.target.files;
            if ( !files || files.length === 0 ) return;

            let upload_progress_window;
            let opid;

            puter.fs.upload(files, _this.currentPath, {
                generateThumbnails: true,
                init: async (operation_id, xhr) => {
                    opid = operation_id;
                    // create upload progress window
                    upload_progress_window = await UIWindowProgress({
                        title: i18n('upload'),
                        icon: window.icons['app-icon-uploader.svg'],
                        operation_id: operation_id,
                        show_progress: true,
                        on_cancel: () => {
                            window.show_save_account_notice_if_needed();
                            xhr.abort();
                        },
                    });
                    // add to active_uploads
                    window.active_uploads[opid] = 0;
                },
                // start
                start: async function () {
                    // change upload progress window message to uploading
                    upload_progress_window.set_status('Uploading');
                    upload_progress_window.set_progress(0);
                },
                // progress
                progress: async function (operation_id, op_progress) {
                    upload_progress_window.set_progress(op_progress);
                    // update active_uploads
                    window.active_uploads[opid] = op_progress;
                    // update title if window is not visible
                    if ( document.visibilityState !== 'visible' ) {
                        update_title_based_on_uploads();
                    }
                },
                // success
                success: function (items) {
                    // Add action to actions_history for undo ability
                    const files = [];
                    if ( typeof items[Symbol.iterator] === 'function' ) {
                        for ( const item of items ) {
                            files.push(item.path);
                        }
                    } else {
                        files.push(items.path);
                    }
                    window.actions_history.push({
                        operation: 'upload',
                        data: files,
                    });
                    setTimeout(() => {
                        upload_progress_window.close();
                    }, 1000);
                    window.show_save_account_notice_if_needed();
                    // remove from active_uploads
                    delete window.active_uploads[opid];
                    // refresh
                    _this.renderDirectory(_this.currentPath, { consistency: 'strong' });
                    // Clear the input value to allow uploading the same file again
                    fileInput.value = '';
                    document.querySelector('form').reset();
                },
                // error
                error: async function (err) {
                    const failedItems = Array.isArray(err?.failedItems) ? err.failedItems : [];
                    if ( failedItems.length > 0 ) {
                        const failedSummary = failedItems.map((item) => {
                            const failedPath = item?.path || item?.name || `item ${item?.requestIndex ?? '?'}`;
                            const failedMessage = typeof item?.message === 'string' && item.message.length > 0
                                ? ` (${item.message})`
                                : '';
                            return `- ${failedPath}${failedMessage}`;
                        }).join('\n');
                        UIAlert(`Some uploads failed:\n${failedSummary}`);
                    }
                    upload_progress_window.show_error(i18n('error_uploading_files'), err.message);
                    // remove from active_uploads
                    delete window.active_uploads[opid];
                    _this.renderDirectory(_this.currentPath, { consistency: 'strong' });
                },
                // abort
                // eslint-disable-next-line no-unused-vars
                abort: async function (operation_id) {
                    // remove from active_uploads
                    delete window.active_uploads[opid];
                },
            });
        };

        // Upload button
        document.querySelector('.upload-btn').onclick = async () => {
            if ( ! this.currentPath ) return;
            fileInput.click();
        };

        // View button (shows dropdown menu: list / compact grid / grid)
        document.querySelector('.view-toggle-btn').onclick = (e) => {
            this.showViewMenu(e);
        };

        // Sort button (shows dropdown menu)
        document.querySelector('.sort-btn').onclick = (e) => {
            this.showSortMenu(e);
        };

        // Select mode toggle button (mobile only)
        document.querySelector('.select-mode-btn').onclick = () => {
            this.toggleSelectMode();
        };

        // Column header sorting
        this.$el_window.find('.header .columns .sortable').on('click', (e) => {
            const column = $(e.currentTarget).attr('data-sort');
            if ( column ) {
                this.handleSort(column);
            }
        });

        // Initialize sort indicators
        this.updateSortIndicators();

        // Column resize handles
        this.initColumnResizing();
    },

    /**
     * Creates event listeners for the floating selection action buttons.
     *
     * @param {jQuery} $el_window - The jQuery-wrapped window/container element
     * @returns {void}
     */
    createSelectionActionListeners ($el_window) {
        const _this = this;
        const $actions = $el_window.find('.files-selection-actions');

        // Restore button (for trash items)
        $actions.find('.restore-btn').on('click', async function () {
            const selectedRows = document.querySelectorAll('.files-tab .row.selected');
            for ( const row of selectedRows ) {
                try {
                    await _this.restoreItem(row);
                    $(row).fadeOut(150, function () {
                        $(this).remove();
                    });
                } catch ( err ) {
                    console.error('Failed to restore item:', err);
                }
            }
            _this.updateFooterStats();
        });

        // Download button
        $actions.find('.download-btn').on('click', function () {
            const selectedRows = document.querySelectorAll('.files-tab .row.selected');
            if ( selectedRows.length > 0 ) {
                window.zipItems(Array.from(selectedRows), _this.currentPath, true);
            }
        });

        // Cut button
        $actions.find('.cut-btn').on('click', function () {
            const selectedRows = document.querySelectorAll('.files-tab .row.selected');
            window.clipboard_op = 'move';
            window.clipboard = [];
            selectedRows.forEach(row => {
                window.clipboard.push({
                    path: $(row).attr('data-path'),
                    uid: $(row).attr('data-uid'),
                });
            });
        });

        // Copy button
        $actions.find('.copy-btn').on('click', function () {
            const selectedRows = document.querySelectorAll('.files-tab .row.selected');
            window.clipboard_op = 'copy';
            window.clipboard = [];
            selectedRows.forEach(row => {
                window.clipboard.push({ path: $(row).attr('data-path') });
            });
        });

        // Delete button
        $actions.find('.delete-btn').on('click', async function () {
            const selectedRows = document.querySelectorAll('.files-tab .row.selected');

            // Check if any items are in trash (for permanent delete)
            const anyTrashed = Array.from(selectedRows).some(row => {
                const rowPath = $(row).attr('data-path');
                return rowPath?.startsWith(`${window.trash_path}/`);
            });

            if ( anyTrashed ) {
                const confirmed = await UIAlert({
                    message: i18n('confirm_delete_multiple_items'),
                    buttons: [
                        { label: i18n('delete'), value: 'delete', type: 'primary' },
                        { label: i18n('cancel'), value: 'cancel' },
                    ],
                });
                if ( confirmed === 'delete' ) {
                    for ( const row of selectedRows ) {
                        await window.delete_item(row);
                    }
                }
            } else {
                window.move_items(Array.from(selectedRows), window.trash_path);
            }
            $actions.removeClass('visible');
        });

        // Done button (exits select mode on mobile)
        $actions.find('.done-btn').on('click', function () {
            _this.exitSelectMode();
        });
    },

    /**
     * Updates the state of selection action buttons based on current selection.
     * Hides download/copy for trashed items, changes delete label for trash.
     *
     * @param {Array<HTMLElement>} selectedRows - The selected row elements
     * @returns {void}
     */
    updateSelectionActionsState (selectedRows) {
        const $actions = this.$el_window.find('.files-selection-actions');

        const anyTrashed = Array.from(selectedRows).some(row => {
            const rowPath = $(row).attr('data-path');
            return rowPath?.startsWith(`${window.trash_path}/`);
        });

        if ( anyTrashed ) {
            // Show restore, hide download and copy for trashed items
            $actions.find('.restore-btn').show();
            $actions.find('.download-btn').hide();
            $actions.find('.cut-btn').hide();
            $actions.find('.copy-btn').hide();
            // Change delete label to "Delete Permanently"
            $actions.find('.delete-btn span').text(i18n('delete_permanently') || 'Delete Permanently');
        } else {
            // Hide restore, show normal actions
            $actions.find('.restore-btn').hide();
            $actions.find('.download-btn').show();
            $actions.find('.cut-btn').show();
            $actions.find('.copy-btn').show();
            $actions.find('.delete-btn span').text(i18n('delete'));
        }
    },

    /**
     * Initializes column resize functionality for list view.
     *
     * Enables drag-to-resize on column headers and persists widths to storage.
     *
     * @returns {void}
     */
    initColumnResizing () {
        const _this = this;
        const $columns = this.$el_window.find('.header .columns');

        this.applyColumnWidths();

        $columns.find('.col-resize-handle').on('mousedown', function (e) {
            e.preventDefault();
            e.stopPropagation();

            const $handle = $(this);
            const column = $handle.attr('data-resize');
            const $header = $columns;
            const startX = e.pageX;

            // Get the column element to resize
            let $targetColumn;
            if ( column === 'name' ) {
                $targetColumn = $header.find('.item-name');
            } else if ( column === 'size' ) {
                $targetColumn = $header.find('.item-size');
            } else if ( column === 'modified' ) {
                $targetColumn = $header.find('.item-modified');
            }

            const startWidth = $targetColumn.outerWidth();

            $(document).on('mousemove.colresize', function (moveEvent) {
                const diff = moveEvent.pageX - startX;
                let newWidth = Math.max(60, startWidth + diff); // Minimum width of 60px

                // For name column, limit max width
                if ( column === 'name' ) {
                    newWidth = Math.max(100, newWidth);
                }

                _this.columnWidths[column] = newWidth;
                _this.applyColumnWidths();
            });

            $(document).on('mouseup.colresize', function () {
                $(document).off('mousemove.colresize mouseup.colresize');
                puter.kv.set('column_widths', JSON.stringify(_this.columnWidths));
            });
        });

        // Double-click on resize handle to auto-fit column to longest content
        $columns.find('.col-resize-handle').on('dblclick', function (e) {
            e.preventDefault();
            e.stopPropagation();

            const column = $(this).attr('data-resize');
            const $filesTab = _this.$el_window.find('.files-tab');
            const padding = 16; // 8px padding on each side
            let maxWidth = 60; // Minimum width

            if ( column === 'name' ) {
                maxWidth = 100;
                $filesTab.find('.files.files-list-view .row:not(.header)').each(function () {
                    const fullName = $(this).attr('data-name');
                    if ( fullName ) {
                        const textWidth = measureTextWidth(fullName) + padding;
                        maxWidth = Math.max(maxWidth, textWidth);
                    }
                });
            } else if ( column === 'size' ) {
                $filesTab.find('.files.files-list-view .row:not(.header) .item-size').each(function () {
                    const text = $(this).text();
                    if ( text ) {
                        const textWidth = measureTextWidth(text) + padding;
                        maxWidth = Math.max(maxWidth, textWidth);
                    }
                });
            } else if ( column === 'modified' ) {
                $filesTab.find('.files.files-list-view .row:not(.header) .item-modified').each(function () {
                    const text = $(this).text();
                    if ( text ) {
                        const textWidth = measureTextWidth(text) + padding;
                        maxWidth = Math.max(maxWidth, textWidth);
                    }
                });
            }

            // Apply the new width
            _this.columnWidths[column] = Math.ceil(maxWidth);
            _this.applyColumnWidths();
            puter.kv.set('column_widths', JSON.stringify(_this.columnWidths));
        });
    },

    /**
     * Applies the current column widths to the header and file rows.
     * Also truncates file names to fit the available width.
     * Resets to defaults if saved widths don't fit the current screen.
     *
     * @returns {void}
     */
    applyColumnWidths () {
        const $filesTab = this.$el_window.find('.files-tab');
        const $container = $filesTab.find('.files');
        const containerWidth = $container.width();

        // Fixed widths: icon(24) + spacers(4*3) + more(20) = 56px, plus some margin
        const fixedWidth = 56 + 20;

        let nameWidth = this.columnWidths.name;
        let sizeWidth = this.columnWidths.size || 100;
        let modifiedWidth = this.columnWidths.modified || 120;

        // Check if total width exceeds container width
        if ( containerWidth > 0 && nameWidth ) {
            const totalWidth = fixedWidth + nameWidth + sizeWidth + modifiedWidth;
            if ( totalWidth > containerWidth ) {
                // Reset to defaults - columns don't fit
                this.columnWidths = {
                    name: null,
                    size: 100,
                    modified: 120,
                };
                nameWidth = null;
                sizeWidth = 100;
                modifiedWidth = 120;
            }
        }

        const nameCol = nameWidth ? `${nameWidth}px` : 'auto';
        const gridTemplate = `24px ${nameCol} 4px ${sizeWidth}px 4px ${modifiedWidth}px 4px 20px`;

        $filesTab.find('.header .columns').css('grid-template-columns', gridTemplate);
        $filesTab.find('.files.files-list-view .row').css('grid-template-columns', gridTemplate);

        // Apply middle-truncation to file names
        if ( this.currentView === 'list' && nameWidth ) {
            const padding = 16; // 8px padding on each side
            const availableWidth = nameWidth - padding;
            $filesTab.find('.files.files-list-view .row:not(.header) .item-name').each(function () {
                const $name = $(this);
                const fullName = $name.closest('.row').attr('data-name');
                if ( fullName ) {
                    $name.text(truncateFilenameToWidth(fullName, availableWidth));
                }
            });
        } else if ( this.currentView === 'list' ) {
            // Reset to full names when column is auto-width
            $filesTab.find('.files.files-list-view .row:not(.header) .item-name').each(function () {
                const $name = $(this);
                const fullName = $name.closest('.row').attr('data-name');
                if ( fullName ) {
                    $name.text(fullName);
                }
            });
        } else if ( this.isGridView() ) {
            // Apply middle-truncation in grid view
            $filesTab.find('.files.files-grid-view .row .item-name').each(function () {
                const $name = $(this);
                const fullName = $name.closest('.row').attr('data-name');
                if ( fullName ) {
                    const itemWidth = $name.width() || 156;
                    $name.text(truncateFilenameToWidth(fullName, itemWidth));
                }
            });
        }
    },

    /**
     * Updates the sidebar folder selection to match the current path.
     *
     * @returns {void}
     */
    updateSidebarSelection () {
        this.$el_window.find('.directories li').removeClass('active');

        const currentPath = this.currentPath;
        if ( ! currentPath ) return;

        this.$el_window.find('[data-path]').each(function () {
            const folderPath = this.getAttribute('data-path');
            if ( folderPath === currentPath ) {
                this.classList.add('active');
            }
        });
    },

    /**
     * Updates header action buttons based on current folder context.
     *
     * Shows/hides new folder, upload, and empty trash buttons as appropriate.
     *
     * @param {boolean} isTrashFolder - Whether the current folder is the Trash
     * @returns {void}
     */
    updateActionButtons (isTrashFolder) {
        const $pathActions = this.$el_window.find('.path-actions');

        if ( isTrashFolder ) {
            $pathActions.find('.new-folder-btn, .upload-btn').hide();

            if ( $pathActions.find('.empty-trash-btn').length === 0 ) {
                const emptyTrashBtn = $(`<button class="path-action-btn empty-trash-btn" title="${i18n('empty_trash')}">${icons.trash}</button>`);
                $pathActions.append(emptyTrashBtn);
                emptyTrashBtn.on('click', () => {
                    window.empty_trash();
                });
            }
            $pathActions.find('.empty-trash-btn').show();
        } else {
            $pathActions.find('.new-folder-btn, .upload-btn').show();
            $pathActions.find('.empty-trash-btn').hide();
        }
    },

    /**
     * Displays the sort options context menu.
     *
     * @param {MouseEvent} e - The click event from the sort button
     * @returns {void}
     */
    showSortMenu (e) {
        const _this = this;

        const sortOptions = [
            { column: 'name', label: 'Name' },
            { column: 'size', label: 'Size' },
            { column: 'modified', label: 'Date Modified' },
        ];

        const items = sortOptions.map(opt => {
            const isActive = _this.sortColumn === opt.column;
            const directionIcon = _this.sortDirection === 'asc' ? ' ↑' : ' ↓';

            return {
                html: `<span>${opt.label}${isActive ? directionIcon : ''}</span>`,
                checked: isActive,
                onClick: () => {
                    _this.handleSort(opt.column);
                },
            };
        });

        UIContextMenu({
            items: items,
            position: { left: e.pageX, top: e.pageY },
        });
    },

    /**
     * Sorts an array of files according to current sort settings.
     *
     * Folders are always sorted before files. Within each group, items are
     * sorted by the selected column (name, size, or modified date).
     *
     * @param {Array<Object>} files - Array of file/folder objects to sort
     * @returns {Array<Object>} Sorted array with folders first, then files
     */
    sortFiles (files) {
        const folders = files.filter(f => f.is_dir);
        const regularFiles = files.filter(f => !f.is_dir);

        const getDisplayName = (file) => {
            try {
                const metadata = file.metadata ? JSON.parse(file.metadata) : {};
                return (metadata.original_name || file.name).toLowerCase();
            } catch {
                return file.name.toLowerCase();
            }
        };

        const sortFn = (a, b) => {
            let comparison = 0;
            const aName = getDisplayName(a);
            const bName = getDisplayName(b);

            switch ( this.sortColumn ) {
                case 'name':
                    comparison = aName.localeCompare(bName);
                    break;
                case 'size':
                    comparison = (a.size || 0) - (b.size || 0);
                    break;
                case 'modified':
                    comparison = (a.modified || 0) - (b.modified || 0);
                    break;
                default:
                    comparison = aName.localeCompare(bName);
            }

            return this.sortDirection === 'asc' ? comparison : -comparison;
        };

        folders.sort(sortFn);
        regularFiles.sort(sortFn);

        return [...folders, ...regularFiles];
    },

    /**
     * Moves a newly appended row to its correct sorted position among
     * existing items. Folders always come before files; within each group,
     * items are ordered by the current sortColumn and sortDirection.
     *
     * @param {jQuery} $newRow - The jQuery-wrapped row element to reposition
     * @param {Object} file - The file object with name, size, modified, is_dir
     */
    insertAtSortedPosition ($newRow, file) {
        const $container = this.$el_window.find('.files-tab .files');
        const $existingRows = $container.find('.item.row').not($newRow);

        if ( $existingRows.length === 0 ) return;

        const newIsDir = !!file.is_dir;
        // Compare on the display name (data-name = metadata.original_name || name),
        // matching sortFiles and the existing rows below. Using raw file.name here
        // mis-sorts trashed items, whose name is the UID and whose real name lives
        // in metadata.original_name.
        const newName = ($newRow.attr('data-name') || file.name || '').toLowerCase();
        const newSize = file.size || 0;
        const newModified = file.modified || 0;
        const sortColumn = this.sortColumn;
        const sortDirection = this.sortDirection;

        $existingRows.each(function () {
            const $existing = $(this);
            const existingIsDir = $existing.attr('data-is_dir') === '1';

            // Folders always come before files
            if ( newIsDir && !existingIsDir ) {
                $newRow.insertBefore($existing);
                return false;
            }
            if ( !newIsDir && existingIsDir ) {
                return true;
            }

            // Same type — compare by sort column
            let comparison = 0;
            switch ( sortColumn ) {
                case 'name':
                    comparison = newName.localeCompare(($existing.attr('data-name') || '').toLowerCase());
                    break;
                case 'size':
                    comparison = newSize - (parseInt($existing.attr('data-size')) || 0);
                    break;
                case 'modified':
                    comparison = newModified - (parseInt($existing.attr('data-modified')) || 0);
                    break;
                default:
                    comparison = newName.localeCompare(($existing.attr('data-name') || '').toLowerCase());
            }

            if ( sortDirection !== 'asc' ) comparison = -comparison;

            if ( comparison < 0 ) {
                $newRow.insertBefore($existing);
                return false;
            }
        });

        // If not inserted, it belongs at the end (already there from append)
    },

    /**
     * Handles sort column selection or direction toggle.
     *
     * Clicking the same column toggles direction; clicking a new column
     * sets ascending order. Persists settings and re-renders the directory.
     *
     * @param {string} column - Column name to sort by ('name', 'size', or 'modified')
     * @returns {Promise<void>}
     */
    async handleSort (column) {
        if ( this.sortColumn === column ) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortColumn = column;
            this.sortDirection = 'asc';
        }

        await puter.kv.set('sort_column', this.sortColumn);
        await puter.kv.set('sort_direction', this.sortDirection);

        this.updateSortIndicators();
        this.renderDirectory(this.currentPath);
    },

    /**
     * Updates visual sort indicators on column headers.
     *
     * @returns {void}
     */
    updateSortIndicators () {
        if ( ! this.$el_window ) return;

        const $columns = this.$el_window.find('.header .columns');

        $columns.find('.sortable').removeClass('sort-asc sort-desc');

        const $activeColumn = $columns.find(`.sortable[data-sort="${this.sortColumn}"]`);
        $activeColumn.addClass(this.sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
    },

    /**
     * Renders the contents of a directory.
     *
     * Fetches directory contents, applies sorting, renders each item,
     * and updates navigation UI elements.
     *
     * @param {string} uid - The UID or path of the directory to render
     * @param {Object} [options] - Optional settings
     * @param {boolean} [options.skipUrlUpdate] - If true, don't update browser URL
     * @param {boolean} [options.skipNavHistory] - If true, don't add to navigation history
     * @returns {Promise<void>}
     */
    async renderDirectory (target, options = {}) {
        if ( this.renderingDirectory ) return;
        this.renderingDirectory = true;
        this.$el_window.find('.files-tab .files').html('');
        this.showSpinner();
        const _this = this;

        document.querySelectorAll('.files-tab .row.selected').forEach(r => {
            r.classList.remove('selected');
        });

        // Drop the shift-click anchor — it points at a row from the directory
        // we're leaving, and a stale detached anchor makes the first shift-click
        // in the new directory select nothing.
        if ( window.latest_selected_item && ! document.body.contains(window.latest_selected_item) ) {
            window.latest_selected_item = null;
            window.active_element = null;
        }

        // Determine whether target is a path or uid
        const isPath = typeof target === 'string' && target.startsWith('/');
        const readdirArg = isPath
            ? { path: target, consistency: options.consistency || 'eventual' }
            : { uid: target, consistency: options.consistency || 'eventual' };
        let directoryContents;
        try {
            directoryContents = await window.puter.fs.readdir(readdirArg);
        } catch ( err ) {
            // readdir rejects on any backend error (permission, deleted dir,
            // network). Without this, renderingDirectory would stay true and
            // the guard above would block all further navigation.
            console.error('Failed to read directory:', err);
            // The container was already emptied above; show a message instead of
            // leaving a blank pane with no explanation.
            this.$el_window.find('.files-tab .files').html(`<div style="
                display: flex;
                justify-content: center;
                align-items: center;
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                pointer-events: none;
                text-align: center;
                padding: 0 16px;
            ">This folder couldn't be opened.</div>`);
            // The list was emptied above; without this the footer keeps the
            // previous directory's item count over a pane with zero rows.
            this.updateFooterStats();
            this.hideSpinner();
            this.renderingDirectory = false;
            return;
        }
        if ( ! directoryContents ) {
            this.hideSpinner();
            this.renderingDirectory = false;
            return;
        }

        // Resolve path: if target was a path we already know it,
        // otherwise look it up from known user directories.
        if ( isPath ) {
            this.currentPath = target;
        } else {
            let path = null;
            Object.entries(window.user.directories).forEach(o => {
                if ( o[1] === target ) {
                    path = o[0];
                }
            });
            this.currentPath = path || target;
        }

        // Update browser URL to reflect current file path (only when Files tab is active)
        if ( !options.skipUrlUpdate && window.is_dashboard_mode && this.isDashboardFilesActive() ) {
            this.updateDashboardUrl(this.currentPath);
        }

        this.updateSidebarSelection();

        // Filter out hidden files/folders and AppData in home directory
        directoryContents = directoryContents.filter(file => {
            if ( file.name.startsWith('.') ) return false;
            if ( file.name === 'AppData' && this.currentPath === window.home_path ) return false;
            return true;
        });

        const isTrashFolder = this.currentPath === window.trash_path;
        this.updateActionButtons(isTrashFolder);

        $('.path-breadcrumbs').html(this.renderPath(this.currentPath, window.user.username));
        $('.path-breadcrumbs .dirname').each(function () {
            const dirnameElement = this;
            const clickedPath = dirnameElement.getAttribute("data-path");

            dirnameElement.onclick = () => {
                _this.pushNavHistory(clickedPath);
                _this.renderDirectory(clickedPath);
            };

            $(dirnameElement).on('contextmenu taphold', async (e) => {
                // Dismiss taphold on non-touch devices
                if ( e.type === 'taphold' && !window.isMobile.phone && !window.isMobile.tablet ) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                $(dirnameElement).addClass('context-menu-active');
                const items = _this.generateFolderContextMenu(clickedPath);
                const menu = UIContextMenu({ items: items, position: { left: e.pageX, top: e.pageY } });
                menu.onClose = () => {
                    $(dirnameElement).removeClass('context-menu-active');
                };
            });

            // Make breadcrumb items droppable for file/folder moves
            $(dirnameElement).droppable({
                accept: '.row',
                tolerance: 'pointer',

                drop: async function (event, ui) {
                    const targetPath = $(this).attr('data-path');
                    const draggedPath = $(ui.draggable).attr('data-path');

                    // Block copying trashed items
                    if ( event.ctrlKey && draggedPath?.startsWith(`${window.trash_path}/`) ) {
                        return;
                    }

                    // Don't drop on current directory
                    if ( targetPath === _this.currentPath ) {
                        return;
                    }

                    ui.helper.data('dropped', true);

                    // Collect all items to move (primary + any selected clones)
                    const itemsToMove = [ui.draggable[0]];
                    $('.item-selected-clone').each(function () {
                        const sourceId = $(this).find('.row').attr('data-id');
                        const sourceItem = document.querySelector(`.row[data-id="${sourceId}"]`);
                        if ( sourceItem ) itemsToMove.push(sourceItem);
                    });

                    // Perform operation based on modifier keys
                    if ( event.ctrlKey ) {
                        await window.copy_items(itemsToMove, targetPath);
                    } else if ( event.altKey && window.feature_flags?.create_shortcut ) {
                        for ( const item of itemsToMove ) {
                            const itemPath = $(item).attr('data-path');
                            const itemName = itemPath.split('/').pop();
                            const isDir = $(item).attr('data-is_dir') === '1';
                            const shortcutTo = $(item).attr('data-shortcut_to') || $(item).attr('data-uid');
                            const shortcutToPath = $(item).attr('data-shortcut_to_path') || itemPath;
                            await window.create_shortcut(itemName, isDir, targetPath, null, shortcutTo, shortcutToPath);
                        }
                    } else {
                        await window.move_items(itemsToMove, targetPath);
                    }
                },

                over: function (_event, ui) {
                    if ( $(ui.draggable).hasClass('row') ) {
                        $(this).addClass('drop-target');
                    }
                },

                out: function (_event, ui) {
                    if ( $(ui.draggable).hasClass('row') ) {
                        $(this).removeClass('drop-target');
                    }
                },
            });
        });

        if ( directoryContents.length === 0 ) {
            this.$el_window.find('.files-tab .files').append(`<div style="
                display: flex;
                justify-content: center;
                align-items: center;
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                pointer-events: none;
            ">
                No files in this directory.
            `);
            this.updateFooterStats();
            this.updateNavButtonStates();
            this.hideSpinner();
            this.renderingDirectory = false;
            return;
        }

        const sortedContents = this.sortFiles(directoryContents);
        // allSettled so one item that fails to render can't reject the batch,
        // which would skip cleanup and leave the tab stuck (renderingDirectory).
        await Promise.allSettled(sortedContents.map(file => this.renderItem(file)));

        this.applyColumnWidths();
        this.updateFooterStats();
        this.updateNavButtonStates();
        this.hideSpinner();
        this.renderingDirectory = false;
    },

    /**
     * Renders a single file or folder item as a row in the file list.
     *
     * Creates the DOM element with appropriate data attributes and appends
     * it to the files container, then attaches event listeners.
     *
     * @param {Object} file - The file/folder object from the filesystem API
     * @returns {void}
     */
    async renderItem (file) {
        // For trashed items, use original_name from metadata if available
        const item_id = window.global_element_id++;
        // metadata is a client-writable, untrusted string stored verbatim, so
        // it may be '', undefined, or malformed. Guard the parse (as item_icon.js
        // does) — an unguarded throw here aborts the whole directory render.
        let metadata = {};
        try {
            if ( file.metadata ) metadata = JSON.parse(file.metadata) || {};
        } catch {
            metadata = {};
        }
        const displayName = metadata.original_name || file.name;
        let website_url = window.determine_website_url(file.path);
        // Normalize is_shortcut to 0/1. Directory listings return it as a number,
        // but the puter.fs.upload() result used to render newly-created items omits
        // it, and an undefined value trips the `!== 0` badge check below (showing a
        // phantom shortcut badge on every new file). Coerce to a plain 0/1 here.
        const is_shortcut = file.is_shortcut ? 1 : 0;
        const is_worker = file.workers?.length > 0;
        const worker_url = is_worker ? file.workers[0]?.address : '';
        const iconResult = await item_icon(file);
        const icon = `<img src="${html_encode(iconResult.image)}"/>`;
        const row = document.createElement("div");
        row.setAttribute('class', `item row ${file.is_dir ? 'folder' : 'file'}`);
        row.setAttribute("data-id", item_id);
        row.setAttribute("data-name", displayName);
        row.setAttribute("data-uid", file.uid);
        row.setAttribute("data-is_dir", file.is_dir ? "1" : "0");
        row.setAttribute("data-is_trash", file.is_trash ? "1" : "0");
        row.setAttribute("data-has_website", file.has_website ? "1" : "0");
        // setAttribute stores values literally (no HTML parsing), so values must
        // stay raw — encoding here would leave e.g. `&amp;` inside data-path and
        // break every fs operation that reads the attribute back.
        row.setAttribute("data-website_url", website_url || '');
        row.setAttribute("data-immutable", file.immutable ? "1" : "0");
        row.setAttribute("data-is_shortcut", is_shortcut);
        row.setAttribute("data-shortcut_to", file.shortcut_to ?? '');
        row.setAttribute("data-shortcut_to_path", file.shortcut_to_path ?? '');
        row.setAttribute("data-is_worker", is_worker ? "1" : "0");
        row.setAttribute("data-worker_url", is_worker ? worker_url : "0");
        row.setAttribute("data-sortable", file.sortable ?? 'true');
        row.setAttribute("data-metadata", JSON.stringify(metadata));
        row.setAttribute("data-sort_by", file.sort_by ?? 'name');
        row.setAttribute("data-size", file.size);
        row.setAttribute("data-type", file.type ?? '');
        row.setAttribute("data-modified", file.modified);
        row.setAttribute("data-associated_app_name", file.associated_app?.name ?? '');
        row.setAttribute("data-path", file.path);
        row.innerHTML = `
            <div class="item-checkbox"><span class="checkbox-icon"></span></div>
            <div class="item-icon">
                ${icon}
            </div>
            <div class="item-badges">
                <img class="item-badge item-has-website-badge long-hover"
                    style="${file.has_website && !is_worker ? 'display:block;' : ''}"
                    src="${html_encode(window.icons['world.svg'])}"
                    data-item-id="${item_id}"
                />
                <img class="item-badge item-has-website-url-badge" 
                    style="${website_url ? 'display:block;' : ''}" 
                    src="${html_encode(window.icons['link.svg'])}" 
                    data-item-id="${item_id}"
                >
                <img class="item-badge item-shortcut"
                    style="background-color: #ffffff; padding: 2px; ${is_shortcut !== 0 ? 'display:block;' : ''}"
                    src="${html_encode(window.icons['shortcut.svg'])}" 
                    data-item-id="${item_id}"
                    title="Shortcut"
                >
                <img  class="item-badge item-is-worker long-hover" 
                    style="background-color: #ffffff; padding: 2px; ${is_worker ? 'display:block;' : ''}" 
                    src="${html_encode(window.icons['worker.svg'])}" 
                    data-item-id="${item_id}"
                >
            </div>
            <div class="item-name-wrapper">
                <pre class="item-name">${html_encode(displayName)}</pre>
                <textarea class="item-name-editor hide-scrollbar" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" data-gramm_editor="false">${html_encode(displayName)}</textarea>
            </div>
            <div class="col-spacer"></div>
            <div class="item-metadata">
                ${file.is_dir ? '<div class="item-size"></div>' : `<div class="item-size">${this.formatFileSize(file.size)}</div>`}
                <div class="col-spacer"></div>
                <div class="item-modified">${window.timeago.format(file.modified * 1000)}</div>
            </div>
            <div class="col-spacer"></div>
            <div class="item-more">${icons.more}</div>
        `;
        this.$el_window.find('.files-tab .files').append(row);

        this.createItemListeners(row, file);
    },

    /**
     * Attaches event listeners to a file/folder row element.
     *
     * Handles selection, double-click to open, rename functionality,
     * context menus, and drag-and-drop operations.
     *
     * @param {HTMLElement} el_item - The row DOM element
     * @param {Object} file - The file/folder object data
     * @returns {void}
     */
    createItemListeners (el_item, file) {
        const _this = this;
        const el_item_name = el_item.querySelector(`.item-name`);
        const el_item_icon = el_item.querySelector('.item-icon');
        const el_item_name_editor = el_item.querySelector(`.item-name-editor`);
        const isFolder = el_item.getAttribute('data-is_dir');
        let website_url = window.determine_website_url(file.path);
        let rename_cancelled = false;
        let shift_clicked = false;
        let itemWasSelectedOnMousedown = false;
        let lastPointerType = null;

        el_item.onpointerdown = (e) => {
            if ( e.target.classList.contains('item-more') ) return;
            if ( el_item.classList.contains('header') ) return;

            // Track pointer type so onclick can distinguish touch from mouse.
            lastPointerType = e.pointerType;

            // On touch devices, skip all selection logic here.
            // Taps are handled by onclick (opens item) and taphold (context menu),
            // so pointerdown never accidentally selects while the user is scrolling.
            if ( e.pointerType === 'touch' ) return;

            shift_clicked = false;

            // Track whether item was already selected before this mousedown
            itemWasSelectedOnMousedown = el_item.classList.contains('selected');

            if ( e.which === 3 && el_item.classList.contains('selected') &&
                el_item.parentElement.querySelectorAll('.row.selected').length > 1 ) {
                return;
            }

            // Select the given rows (replacing the current selection unless
            // additive) and make el_item the anchor. Shared by the range,
            // no-anchor shift-click, and drag-handle paths so their selection
            // bookkeeping can't drift apart.
            const applySelection = (rows, additive = false) => {
                if ( ! additive ) {
                    el_item.parentElement.querySelectorAll('.row.selected').forEach(r => {
                        r.classList.remove('selected');
                    });
                }
                for ( const row of rows ) row.classList.add('selected');
                window.latest_selected_item = el_item;
                window.active_element = el_item;
                window.active_item_container = el_item.closest('.files');
                _this.updateFooterStats();
            };

            // Handle Shift+Click for range selection. Require the anchor to
            // still be in this row list — a detached anchor (indexOf === -1)
            // would otherwise set shift_clicked and then select nothing,
            // leaving the click a no-op. The row lookup happens only under
            // Shift: this handler is the hot path for every click in the list.
            if ( e.shiftKey ) {
                const allRows = $(el_item).parent().find('.row').toArray();
                const hasShiftAnchor = window.latest_selected_item
                    && allRows.indexOf(window.latest_selected_item) !== -1;
                if ( hasShiftAnchor && window.latest_selected_item !== el_item ) {
                    e.preventDefault();
                    shift_clicked = true;

                    const clickedIndex = allRows.indexOf(el_item);
                    const lastSelectedIndex = allRows.indexOf(window.latest_selected_item);

                    if ( clickedIndex !== -1 && lastSelectedIndex !== -1 ) {
                        const start = Math.min(clickedIndex, lastSelectedIndex);
                        const end = Math.max(clickedIndex, lastSelectedIndex);
                        // Select the whole range; Ctrl/Cmd extends instead of
                        // replacing.
                        applySelection(allRows.slice(start, end + 1), e.ctrlKey || e.metaKey);
                        return;
                    }
                } else if ( ! hasShiftAnchor ) {
                    // Shift-click with no valid anchor (e.g. the first click
                    // after navigating to a new directory): select just this
                    // item and make it the anchor. onclick skips selection
                    // while Shift is held, so without this the click would
                    // select nothing. Ctrl/Cmd+Shift extends instead of
                    // clearing.
                    e.preventDefault();
                    shift_clicked = true;
                    applySelection([el_item], e.ctrlKey || e.metaKey);
                    return;
                }
                // Shift-click on the current anchor itself: deliberate no-op —
                // it must not collapse an existing multi-selection.
            }

            // In select mode on mobile, treat taps like Ctrl+click (toggle selection)
            const isMobileSelectMode = (window.isMobile.phone || window.isMobile.tablet) && _this.selectModeActive;

            // If clicking on .item-name, .item-icon, or .item-badges, select immediately so item drag works.
            // On touch devices, these elements have pointer-events:none via CSS so this path
            // won't be reached — touches land on .row instead, deferring selection to onclick.
            const isDragHandle = e.target.closest('.item-name, .item-icon, .item-badges');
            if ( e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !el_item.classList.contains('selected') && !isMobileSelectMode && isDragHandle ) {
                applySelection([el_item]);
                itemWasSelectedOnMousedown = true;
                return;
            }

            // If item is NOT selected and no modifier keys: defer selection to click handler.
            // This allows rubberband selection to start when dragging from unselected items.
            if ( e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !el_item.classList.contains('selected') && !isMobileSelectMode ) {
                window.active_element = el_item;
                window.active_item_container = el_item.closest('.files');
                return;
            }

            // A right-click must not change the selection: an unselected item
            // gets the grey context-menu state instead (added by the
            // contextmenu handler), and an existing selection is preserved
            // so the multi-select menu still applies to it.
            if ( e.button === 2 ) {
                window.active_element = el_item;
                window.active_item_container = el_item.closest('.files');
                return;
            }

            if ( !e.ctrlKey && !e.metaKey && !e.shiftKey && !el_item.classList.contains('selected') && !isMobileSelectMode ) {
                el_item.parentElement.querySelectorAll('.row.selected').forEach(r => {
                    r.classList.remove('selected');
                });
            }

            if ( ! e.shiftKey ) {
                if ( ((e.ctrlKey || e.metaKey) || isMobileSelectMode) && el_item.classList.contains('selected') ) {
                    el_item.classList.remove('selected');
                } else {
                    el_item.classList.add('selected');
                    window.latest_selected_item = el_item;
                }
            }

            window.active_element = el_item;
            window.active_item_container = el_item.closest('.files');
            _this.updateFooterStats();

            // If preview is open, switch to newly selected file
            if ( _this.previewOpen ) {
                const $container = $(el_item).closest('.files');
                const $newSelected = $container.find('.row.selected');
                if ( $newSelected.length === 1 ) {
                    const newUid = $newSelected.attr('data-uid');
                    if ( newUid !== _this.previewCurrentUid ) {
                        _this.showImagePreview($newSelected);
                    }
                }
            }
        };

        el_item.onclick = (e) => {
            if ( e.target.classList.contains('item-more') ) {
                this.handleMoreClick(el_item, file, e.target);
                return;
            }

            // Skip if this click is the end of a rubber band selection
            if ( _this.rubberBandSelectionJustEnded ) {
                _this.rubberBandSelectionJustEnded = false;
                return;
            }

            // Skip if this was a shift-click (already handled in pointerdown)
            if ( shift_clicked ) {
                shift_clicked = false;
                return;
            }

            // On touch/mobile: tap opens the item directly, no selection step needed.
            // Selection (and context menu) is handled via taphold.
            // Use lastPointerType as primary signal (works even if isMobile misdetects).
            if ( lastPointerType === 'touch' || window.isMobile.phone || window.isMobile.tablet ) {
                // In select mode, tap toggles selection instead of opening
                if ( _this.selectModeActive ) {
                    el_item.classList.toggle('selected');
                    window.latest_selected_item = el_item;
                    _this.updateFooterStats();
                    return;
                }
                if ( isFolder === "1" ) {
                    _this.pushNavHistory(file.path);
                    _this.renderDirectory(file.path);
                } else {
                    open_item({ item: el_item });
                }
                return;
            }

            if ( !e.ctrlKey && !e.metaKey && !e.shiftKey ) {
                el_item.parentElement.querySelectorAll('.row.selected').forEach(r => {
                    if ( r !== el_item ) r.classList.remove('selected');
                });
                // Ensure clicked item is selected (handles deferred selection from pointerdown)
                if ( ! el_item.classList.contains('selected') ) {
                    el_item.classList.add('selected');
                    window.latest_selected_item = el_item;
                }
            }
            _this.updateFooterStats();

            // If preview is open, switch to newly selected file
            if ( _this.previewOpen ) {
                const $container = $(el_item).closest('.files');
                const $newSelected = $container.find('.row.selected');
                if ( $newSelected.length === 1 ) {
                    const newUid = $newSelected.attr('data-uid');
                    if ( newUid !== _this.previewCurrentUid ) {
                        _this.showImagePreview($newSelected);
                    }
                }
            }
        };

        el_item.ondblclick = (e) => {
            if ( e.target.classList.contains('item-name-editor') ) {
                return;
            }
            if ( isFolder === "1" ) {
                _this.pushNavHistory(file.path);
                _this.renderDirectory(file.path);
            } else {
                open_item({ item: el_item });
            }
            el_item.classList.remove('selected');
        };

        // --------------------------------------------------------
        // Rename
        // --------------------------------------------------------
        function rename () {
            if ( rename_cancelled ) {
                rename_cancelled = false;
                return;
            }

            const old_name = $(el_item).attr('data-name');
            const old_path = $(el_item).attr('data-path');
            const new_name = $(el_item_name_editor).val();

            // Don't send a rename request if:
            // the new name is the same as the old one,
            // or it's empty,
            // or editable was not even active at all
            if ( old_name === new_name || !new_name || new_name === '.' || new_name === '..' || !$(el_item_name_editor).hasClass('item-name-editor-active') ) {
                if ( new_name === '.' ) {
                    UIAlert('The name "." is not allowed, because it is a reserved name. Please choose another name.');
                }
                else if ( new_name === '..' ) {
                    UIAlert('The name ".." is not allowed, because it is a reserved name. Please choose another name.');
                }
                $(el_item_name).html(html_encode(truncate_filename(file.name)));
                $(el_item_name).show();
                $(el_item_name_editor).val($(el_item).attr('data-name'));
                $(el_item_name_editor).hide();
                return;
            }
            // deactivate item name editable
            $(el_item_name_editor).removeClass('item-name-editor-active');

            // Perform rename request
            window.rename_file(file, new_name, old_name, old_path, el_item, el_item_name, el_item_icon, el_item_name_editor, website_url, false, (new_name) => {
                $(el_item_name).html(html_encode(new_name));
            });
        }

        // --------------------------------------------------------
        // Rename if enter pressed on Item Name Editor
        // --------------------------------------------------------
        $(el_item_name_editor).on('keypress', function (e) {
            // If name editor is not active don't continue
            if ( ! $(el_item_name_editor).is(':visible') )
            {
                return;
            }

            // Enter key = rename
            if ( e.which === 13 ) {
                e.stopPropagation();
                e.preventDefault();
                $(el_item_name_editor).blur();
                $(el_item).addClass('selected');
                window.last_enter_pressed_to_rename_ts = Date.now();
                window.update_explorer_footer_selected_items_count($(el_item).closest('.item-container'));
                return false;
            }
        });

        // --------------------------------------------------------
        // Cancel and undo if escape pressed on Item Name Editor
        // --------------------------------------------------------
        $(el_item_name_editor).on('keyup', function (e) {
            if ( ! $(el_item_name_editor).is(':visible') )
            {
                return;
            }

            // Escape = undo rename
            else if ( e.which === 27 ) {
                e.stopPropagation();
                e.preventDefault();
                rename_cancelled = true;
                $(el_item_name_editor).hide();
                $(el_item_name_editor).val(file.name);
                $(el_item_name).show();
            }
        });

        $(el_item_name_editor).on('focusout', function (e) {
            e.stopPropagation();
            e.preventDefault();
            rename();
        });

        // Right-click context menu handler (desktop) and taphold (touch devices)
        $(el_item).on('contextmenu taphold', async (e) => {
            // Dismiss taphold on non-touch devices
            if ( e.type === 'taphold' && !window.isMobile.phone && !window.isMobile.tablet && !(navigator.maxTouchPoints > 0) ) {
                return;
            }
            // On iOS, both contextmenu and taphold can fire for the same long-press.
            // Debounce to prevent duplicate modals.
            if ( el_item._contextMenuShownAt && Date.now() - el_item._contextMenuShownAt < 500 ) {
                e.preventDefault();
                return;
            }
            el_item._contextMenuShownAt = Date.now();
            e.preventDefault();
            e.stopPropagation();

            const selectedRows = document.querySelectorAll('.files-tab .row.selected');
            let items;
            if ( selectedRows.length > 1 && el_item.classList.contains('selected') ) {
                items = await _this.generateMultiSelectContextMenu(selectedRows);
            } else {
                items = await _this.generateContextMenuItems(el_item, file);
            }

            if ( window.isMobile.phone || window.isMobile.tablet || navigator.maxTouchPoints > 0 ) {
                const modal = new ContextMenuModal();
                modal.show(items, el_item.getBoundingClientRect(), { title: file.name });
            } else {
                // Keep the row visually active while its menu is open — the
                // pointer moves onto the menu, so :hover alone would drop it.
                // Class managed manually rather than via parent_element, whose
                // inline overflow side effects would break the row's layout.
                const releaseCtxState = _this.markRowContextMenuOpen(el_item);
                const menu = UIContextMenu({ items: items, position: { left: e.pageX, top: e.pageY } });
                menu.onClose = releaseCtxState;
            }
        });

        // Skip header row for drag-and-drop
        if ( el_item.classList.contains('header') ) return;

        $(el_item).draggable({
            appendTo: 'body',
            refreshPositions: true,
            helper: function () {
                const $clone = $(el_item).clone();

                // Wrap in container structure so CSS selectors match
                const viewClass = _this.viewClass();
                const $wrapper = $(`<div class="dashboard-section-files"><div class="files-tab"><div class="files ${viewClass}"></div></div></div>`);
                $wrapper.find('.files').append($clone);

                // In grid view, set fixed width since the grid auto-fill
                // doesn't work without a proper parent width context
                if ( _this.isGridView() ) {
                    $clone.css('width', $(el_item).outerWidth());
                    $wrapper.find('.files').css('display', 'block');
                }

                return $wrapper;
            },
            revert: 'invalid',
            zIndex: 10000,
            scroll: false,
            distance: 5,
            revertDuration: 100,

            start: function (_event, ui) {
                // Don't start drag if item wasn't already selected before mousedown;
                // rubberband selection should handle this case instead.
                if ( ! itemWasSelectedOnMousedown ) {
                    return false;
                }

                if ( $(el_item).attr('data-immutable') !== '0' ) {
                    return false;
                }

                if ( ! el_item.classList.contains('selected') ) {
                    el_item.parentElement.querySelectorAll('.row.selected').forEach(r => {
                        r.classList.remove('selected');
                    });
                    el_item.classList.add('selected');
                }

                ui.helper.addClass('selected');

                // Clone other selected items with proper container structure
                const viewClass = _this.viewClass();
                $(el_item).siblings('.row.selected').each(function () {
                    const $clone = $(this).clone();
                    const $wrapper = $(`<div class="dashboard-section-files item-selected-clone"><div class="files-tab"><div class="files ${viewClass}"></div></div></div>`);
                    $wrapper.find('.files').append($clone);
                    $wrapper.css('position', 'absolute').appendTo('body').hide();
                });

                const itemCount = $('.item-selected-clone').length;
                if ( itemCount > 0 ) {
                    $('body').append(`<span class="draggable-count-badge">${itemCount + 1}</span>`);
                }

                window.an_item_is_being_dragged = true;
                $('.window-app-iframe').css('pointer-events', 'none');

                // Create hidden cancel zone (shown when spring-load activates)
                const $cancelZone = $(`<div class="drag-cancel-zone" style="display:none;">\u2715 ${i18n('cancel')}</div>`);
                _this.$el_window.find('.dashboard-section-files').append($cancelZone);
                $cancelZone.droppable({
                    accept: '.row',
                    tolerance: 'pointer',
                    over: function () {
                        $(this).addClass('drag-cancel-hover');
                    },
                    out: function () {
                        $(this).removeClass('drag-cancel-hover');
                    },
                    drop: function (_event, ui) {
                        ui.helper.data('dropped', true);
                        ui.helper.data('cancelled', true);
                    },
                });
            },

            drag: function (event, ui) {
                // Show helpers after 5px movement
                if ( Math.abs(ui.originalPosition.top - ui.offset.top) > 5 ||
                    Math.abs(ui.originalPosition.left - ui.offset.left) > 5 ) {
                    ui.helper.show();
                    $('.item-selected-clone').show();
                    $('.draggable-count-badge').show();
                }

                $('.draggable-count-badge').css({
                    top: event.pageY,
                    left: event.pageX + 10,
                });

                $('.item-selected-clone').each(function (i) {
                    $(this).css({
                        left: ui.position.left + 3 * (i + 1),
                        top: ui.position.top + 3 * (i + 1),
                        'z-index': 999 - i,
                        'opacity': 0.5 - i * 0.1,
                    });
                });
            },

            stop: function (event, ui) {
                const _this = TabFiles;

                // Clean up dwell state from any folder we were hovering over
                clearTimeout(_this.folderDwellTimer);
                _this.folderDwellTimer = null;
                _this.folderDwellTarget = null;
                $('.dwell-opening').removeClass('dwell-opening');

                // Handle spring-loaded folder drag resolution
                if ( _this.springLoadedActive ) {
                    if ( ui.helper.data('cancelled') ) {
                        // Dropped on cancel zone → navigate back, no move
                        _this.navigateBackFromSpringLoad();
                    } else if ( ! ui.helper.data('dropped') ) {
                        // Not dropped on a specific target — check if within .files area
                        const filesEl = _this.$el_window.find('.files')[0];
                        const rect = filesEl.getBoundingClientRect();
                        const inFiles = event.clientX >= rect.left && event.clientX <= rect.right &&
                            event.clientY >= rect.top && event.clientY <= rect.bottom;

                        if ( inFiles ) {
                            // Dropped in file list but not on a folder → move to current dir
                            const itemsToMove = [el_item];
                            $('.item-selected-clone').find('.row').each(function () {
                                itemsToMove.push(this);
                            });

                            if ( event.ctrlKey ) {
                                window.copy_items(itemsToMove, _this.currentPath);
                            }
                            else if ( event.altKey && window.feature_flags?.create_shortcut ) {
                                for ( const item of itemsToMove ) {
                                    const itemPath = $(item).attr('data-path');
                                    const itemName = itemPath.split('/').pop();
                                    const isDir = $(item).attr('data-is_dir') === '1';
                                    const shortcutTo = $(item).attr('data-shortcut_to') || $(item).attr('data-uid');
                                    const shortcutToPath = $(item).attr('data-shortcut_to_path') || itemPath;
                                    window.create_shortcut(itemName, isDir, _this.currentPath, null, shortcutTo, shortcutToPath);
                                }
                            }
                            else {
                                window.move_items(itemsToMove, _this.currentPath);
                            }
                        } else {
                            // Dropped outside file list → cancel, navigate back
                            _this.navigateBackFromSpringLoad();
                        }
                    }
                    // If dropped on a specific folder/breadcrumb target, the drop
                    // handler already processed it — nothing to do here.
                }

                _this.springLoadedActive = false;
                _this.springLoadedOriginalPath = null;
                $('.drag-cancel-zone').remove();
                $('.item-selected-clone').remove();
                $('.draggable-count-badge').remove();
                window.an_item_is_being_dragged = false;
                $('.window-app-iframe').css('pointer-events', 'auto');
            },
        });

        if ( file.is_dir ) {
            $(el_item).droppable({
                accept: '.row',
                tolerance: 'pointer',

                drop: async function (event, ui) {
                    const _this = TabFiles;

                    // Clear dwell timer to prevent folder from opening after drop
                    clearTimeout(_this.folderDwellTimer);
                    _this.folderDwellTimer = null;
                    _this.folderDwellTarget = null;

                    const draggedPath = $(ui.draggable).attr('data-path');
                    if ( event.ctrlKey && draggedPath?.startsWith(`${window.trash_path}/`) ) {
                        return;
                    }

                    ui.helper.data('dropped', true);

                    const itemsToMove = [ui.draggable[0]];

                    $('.item-selected-clone').each(function () {
                        const sourceId = $(this).find('.row').attr('data-id');
                        const sourceItem = document.querySelector(`.row[data-id="${sourceId}"]`);
                        if ( sourceItem ) itemsToMove.push(sourceItem);
                    });

                    const targetPath = $(el_item).attr('data-path');

                    if ( event.ctrlKey ) {
                        // Copy
                        await window.copy_items(itemsToMove, targetPath);
                    }
                    else if ( event.altKey && window.feature_flags?.create_shortcut ) {
                        // Create shortcuts
                        for ( const item of itemsToMove ) {
                            const itemPath = $(item).attr('data-path');
                            const itemName = itemPath.split('/').pop();
                            const isDir = $(item).attr('data-is_dir') === '1';
                            const shortcutTo = $(item).attr('data-shortcut_to') || $(item).attr('data-uid');
                            const shortcutToPath = $(item).attr('data-shortcut_to_path') || itemPath;

                            await window.create_shortcut(itemName, isDir, targetPath, null, shortcutTo, shortcutToPath);
                        }
                    }
                    else {
                        await window.move_items(itemsToMove, targetPath);
                    }
                },

                over: function (_event, ui) {
                    if ( $(ui.draggable).hasClass('row') ) {
                        $(el_item).addClass('selected');

                        const _this = TabFiles;
                        const targetPath = $(el_item).attr('data-path');

                        // Don't auto-open the current directory or trash
                        if ( targetPath === _this.currentPath ||
                            targetPath === window.trash_path ||
                            targetPath?.startsWith(`${window.trash_path}/`) ) {
                            return;
                        }

                        // Clear any existing dwell timer
                        clearTimeout(_this.folderDwellTimer);

                        // Add visual feedback animation
                        $(el_item).addClass('dwell-opening');
                        _this.folderDwellTarget = el_item;

                        // Start dwell timer — navigate into folder after 700ms
                        _this.folderDwellTimer = setTimeout(async () => {
                            _this.folderDwellTimer = null;
                            _this.folderDwellTarget = null;
                            if ( ! _this.springLoadedActive ) {
                                _this.springLoadedOriginalPath = _this.currentPath;
                            }
                            _this.springLoadedActive = true;
                            $('.drag-cancel-zone').show();
                            $(el_item).removeClass('dwell-opening selected');

                            _this.pushNavHistory(targetPath);
                            _this.renderDirectory(targetPath);

                            // Refresh jQuery UI droppable detection for the active drag
                            if ( $.ui.ddmanager && $.ui.ddmanager.current ) {
                                $.ui.ddmanager.current.helper.addClass('ui-draggable-dragging');
                                $.ui.ddmanager.prepareOffsets($.ui.ddmanager.current);
                            }
                        }, 700);
                    }
                },

                out: function (_event, ui) {
                    if ( $(ui.draggable).hasClass('row') ) {
                        $(el_item).removeClass('selected dwell-opening');

                        const _this = TabFiles;
                        if ( _this.folderDwellTarget === el_item ) {
                            clearTimeout(_this.folderDwellTimer);
                            _this.folderDwellTimer = null;
                            _this.folderDwellTarget = null;
                        }
                    }
                },
            });

            // Add native file drop support to folder rows
            $(el_item).dragster({
                enter: function (_dragsterEvent, event) {
                    const e = event.originalEvent;
                    if ( ! e.dataTransfer?.types?.includes('Files') ) {
                        return;
                    }

                    const targetPath = $(el_item).attr('data-path');

                    // Don't allow drop on trash folder
                    if ( targetPath === window.trash_path ||
                        targetPath?.startsWith(`${window.trash_path}/`) ) {
                        return;
                    }

                    $(el_item).addClass('native-drop-target');
                },

                leave: function (_dragsterEvent, _event) {
                    $(el_item).removeClass('native-drop-target');
                },

                drop: async function (_dragsterEvent, event) {
                    const e = event.originalEvent;
                    $(el_item).removeClass('native-drop-target');

                    if ( ! e.dataTransfer?.types?.includes('Files') ) {
                        return;
                    }

                    const targetPath = $(el_item).attr('data-path');

                    // Block uploads to trash
                    if ( targetPath === window.trash_path ||
                        targetPath?.startsWith(`${window.trash_path}/`) ) {
                        return;
                    }

                    if ( e.dataTransfer?.items?.length > 0 ) {
                        TabFiles.uploadFiles(e.dataTransfer.items, targetPath);
                    }

                    e.stopPropagation();
                    e.preventDefault();
                    return false;
                },
            });
        }
    },

    /**
     * Restores a trashed item to its original location.
     *
     * This is a simplified restore function for the dashboard that calls
     * puter.fs.move() directly, avoiding the complexity of window.move_items()
     * which is designed for the desktop window system.
     *
     * @param {HTMLElement} el_item - The row element representing the trashed item
     * @returns {Promise<Object>} The result from puter.fs.move()
     */
    async restoreItem (el_item) {
        const uid = $(el_item).attr('data-uid');
        const metadataStr = $(el_item).attr('data-metadata');
        const metadata = metadataStr ? JSON.parse(metadataStr) : {};

        if ( ! metadata.original_path ) {
            throw new Error('Cannot restore: original path not found in metadata');
        }

        const destPath = path.dirname(metadata.original_path);
        const originalName = metadata.original_name;

        const resp = await puter.fs.move({
            source: uid,
            destination: destPath,
            newName: originalName,
            newMetadata: {},
            createMissingParents: true,
        });

        return resp;
    },

    /**
     * Moves clipboard items to the specified destination path.
     *
     * This is a Dashboard-specific implementation that calls puter.fs.move()
     * directly, bypassing window.move_clipboard_items() which relies on
     * .item DOM elements that don't exist in the Dashboard.
     *
     * @param {string} destPath - The destination folder path
     * @returns {Promise<void>}
     */
    async moveClipboardItems (destPath) {
        if ( !window.clipboard || window.clipboard.length === 0 ) {
            return;
        }

        for ( const item of window.clipboard ) {
            // Handle both object format { path, uid } and legacy string format
            const source = item.uid || item.path || item;
            try {
                await puter.fs.move({
                    source: source,
                    destination: destPath,
                });
            } catch ( err ) {
                console.error('Failed to move item:', err);
            }
        }

        window.clipboard = [];
    },

    /**
     * Formats a byte count into a human-readable size string.
     *
     * @param {number} bytes - The size in bytes
     * @returns {string} Formatted size string (e.g., "1.5 MB")
     */
    formatFileSize (bytes) {
        const num = Number(bytes);
        // Missing/invalid sizes (undefined, null, NaN) and non-positive values
        // shouldn't render as "NaN undefined".
        if ( ! Number.isFinite(num) || num <= 0 ) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
        // Clamp the index so sizes beyond PB don't index past the array (which
        // produced "1.5 undefined" for terabyte-plus files).
        const i = Math.min(Math.floor(Math.log(num) / Math.log(k)), sizes.length - 1);
        return `${Math.round((num / Math.pow(k, i)) * 100) / 100 } ${ sizes[i]}`;
    },

    /**
     * Calculates the total size of files represented by row elements.
     *
     * @param {Array<HTMLElement>} rows - Array of row DOM elements with data-size attributes
     * @returns {number} Total size in bytes
     */
    calculateTotalSize (rows) {
        let total = 0;
        rows.forEach(row => {
            const size = parseInt($(row).attr('data-size')) || 0;
            total += size;
        });
        return total;
    },

    /**
     * Updates the footer status bar with item counts and sizes.
     *
     * Shows total item count and size, plus selected item count and size if any.
     *
     * @returns {void}
     */
    updateFooterStats () {
        const $footer = this.$el_window.find('.files-footer');
        const $selectionActions = this.$el_window.find('.files-selection-actions');
        if ( ! $footer.length ) return;

        const allRows = this.$el_window.find('.files-tab .row').toArray();
        const selectedRows = this.$el_window.find('.files-tab .row.selected').toArray();

        const totalCount = allRows.length;
        const selectedCount = selectedRows.length;

        const totalSize = this.calculateTotalSize(allRows);
        const selectedSize = this.calculateTotalSize(selectedRows);

        const itemText = totalCount === 1 ? 'item' : 'items';
        $footer.find('.files-footer-item-count').html(
            `${totalCount} ${itemText} · ${window.byte_format(totalSize)}`,
        );

        if ( selectedCount > 0 ) {
            const selectedItemText = selectedCount === 1 ? 'item' : 'items';
            $footer.find('.files-footer-selected-items')
                .html(`${selectedCount} ${selectedItemText} selected · ${window.byte_format(selectedSize)}`)
                .css('display', 'inline');
            $footer.find('.files-footer-separator').css('display', 'inline');
        } else {
            $footer.find('.files-footer-selected-items').css('display', 'none');
            $footer.find('.files-footer-separator').css('display', 'none');
        }

        // Show/hide floating action bar based on selection count
        // In mobile select mode, show with 1+ items; otherwise require 2+
        const isMobileSelectMode = (window.isMobile.phone || window.isMobile.tablet) && this.selectModeActive;
        const minCountForActionBar = isMobileSelectMode ? 1 : 2;

        if ( selectedCount >= minCountForActionBar ) {
            $selectionActions.addClass('visible');
            this.updateSelectionActionsState(selectedRows);
        } else {
            $selectionActions.removeClass('visible');
        }
    },

    /**
     * Whether the current view mode is one of the grid variants.
     *
     * Both 'grid' and 'grid-sm' share the files-grid-view container class
     * (and all grid behavior); 'grid-sm' adds a size-modifier class on top.
     *
     * @returns {boolean}
     */
    isGridView () {
        return this.currentView === 'grid' || this.currentView === 'grid-sm';
    },

    /**
     * Container classes for the current view mode, e.g. for drag-ghost wrappers.
     *
     * @returns {string} Space-separated class list for the .files container
     */
    viewClass () {
        if ( this.currentView === 'grid-sm' ) return 'files-grid-view files-grid-view-sm';
        if ( this.currentView === 'grid' ) return 'files-grid-view';
        return 'files-list-view';
    },

    /**
     * Displays the view mode selection menu (list / compact grid / grid).
     *
     * @param {MouseEvent} e - The click event from the view button
     * @returns {void}
     */
    showViewMenu (e) {
        const _this = this;

        const viewOptions = [
            { mode: 'list', label: 'List' },
            { mode: 'grid-sm', label: 'Compact Grid' },
            { mode: 'grid', label: 'Grid' },
        ];

        const items = viewOptions.map(opt => {
            return {
                html: `<span>${opt.label}</span>`,
                checked: _this.currentView === opt.mode,
                onClick: () => {
                    _this.setView(opt.mode);
                },
            };
        });

        UIContextMenu({
            items: items,
            position: { left: e.pageX, top: e.pageY },
        });
    },

    /**
     * Switches to the given view mode and persists the preference.
     *
     * @param {string} mode - 'list', 'grid', or 'grid-sm'
     * @returns {void}
     */
    setView (mode) {
        if ( this.currentView === mode ) return;
        this.currentView = mode;
        this.applyViewMode();

        puter.kv.set('view_mode', mode);

        // Refresh content to update icons for the new view mode
        if ( this.currentPath ) {
            this.renderDirectory(this.currentPath);
        }
    },

    /**
     * Applies the current view mode's classes and button icon to the DOM.
     *
     * @returns {void}
     */
    applyViewMode () {
        const $filesContainer = this.$el_window.find('.files-tab .files');
        const $toggleBtn = this.$el_window.find('.view-toggle-btn');
        const $tabContent = this.$el_window.find('.files-tab');

        $filesContainer.removeClass('files-list-view files-grid-view files-grid-view-sm');
        if ( this.isGridView() ) {
            $filesContainer.addClass(this.viewClass());
            $tabContent.addClass('files-grid-mode');
        } else {
            $filesContainer.addClass('files-list-view');
            $tabContent.removeClass('files-grid-mode');
        }

        // The button shows the active view's icon and opens the view menu
        const btnIcon = this.currentView === 'grid' ? icons.grid
            : this.currentView === 'grid-sm' ? icons.gridSmall
                : icons.list;
        $toggleBtn.html(btnIcon);
    },

    /**
     * Toggles select mode for mobile multi-file selection.
     *
     * When active, tapping files toggles their selection instead of opening them.
     * Checkboxes appear next to each item for visual feedback.
     *
     * @returns {void}
     */
    toggleSelectMode () {
        this.selectModeActive = !this.selectModeActive;
        const $filesTab = this.$el_window.find('.files-tab');
        const $selectBtn = this.$el_window.find('.select-mode-btn');

        if ( this.selectModeActive ) {
            $filesTab.addClass('select-mode-active');
            $selectBtn.addClass('active');
        } else {
            $filesTab.removeClass('select-mode-active');
            $selectBtn.removeClass('active');
            // Clear all selections when exiting select mode
            this.$el_window.find('.files .row.selected').removeClass('selected');
            this.updateFooterStats();
        }
    },

    /**
     * Exits select mode and clears selections.
     *
     * @returns {void}
     */
    exitSelectMode () {
        if ( this.selectModeActive ) {
            this.selectModeActive = false;
            const $filesTab = this.$el_window.find('.files-tab');
            const $selectBtn = this.$el_window.find('.select-mode-btn');
            $filesTab.removeClass('select-mode-active');
            $selectBtn.removeClass('active');
            // Clear all selections
            this.$el_window.find('.files .row.selected').removeClass('selected');
            this.updateFooterStats();
        }
    },

    /**
     * Navigates back to the original folder after cancelling a spring-loaded drag.
     * Walks back through nav history to find the original path position.
     *
     * @returns {void}
     */
    navigateBackFromSpringLoad () {
        if ( ! this.springLoadedOriginalPath ) return;

        // Walk back through nav history to find the original path
        for ( let i = window.dashboard_nav_history_current_position - 1; i >= 0; i-- ) {
            if ( window.dashboard_nav_history[i] === this.springLoadedOriginalPath ) {
                window.dashboard_nav_history_current_position = i;
                this.renderDirectory(this.springLoadedOriginalPath);
                return;
            }
        }
        // Fallback: render the original path directly
        this.renderDirectory(this.springLoadedOriginalPath);
    },

    /**
     * Initializes the navigation history with a starting path.
     *
     * @param {string} initialPath - The initial directory path
     * @returns {void}
     */
    initNavHistory (initialPath) {
        window.dashboard_nav_history = [initialPath];
        window.dashboard_nav_history_current_position = 0;
        this.updateNavButtonStates();
    },

    /**
     * Pushes a new path onto the navigation history stack.
     *
     * Truncates any forward history when navigating to a new location.
     *
     * @param {string} newPath - The path to add to history
     * @returns {void}
     */
    pushNavHistory (newPath) {
        // If history is empty, initialize with this path
        if ( window.dashboard_nav_history.length === 0 ) {
            window.dashboard_nav_history = [newPath];
            window.dashboard_nav_history_current_position = 0;
        } else {
            // Truncate forward history when navigating to new location
            window.dashboard_nav_history = window.dashboard_nav_history.slice(0, window.dashboard_nav_history_current_position + 1);
            window.dashboard_nav_history.push(newPath);
            window.dashboard_nav_history_current_position++;
        }
        this.updateNavButtonStates();
    },

    /**
     * Updates the enabled/disabled state of navigation buttons.
     *
     * Disables back button at history start, forward button at history end,
     * and up button at root directory.
     *
     * @returns {void}
     */
    updateNavButtonStates () {
        if ( ! this.$el_window ) return;

        const backBtn = this.$el_window.find('.path-btn-back');
        const forwardBtn = this.$el_window.find('.path-btn-forward');
        const upBtn = this.$el_window.find('.path-btn-up');

        if ( window.dashboard_nav_history_current_position === 0 ) {
            backBtn.addClass('path-btn-disabled');
        } else {
            backBtn.removeClass('path-btn-disabled');
        }

        if ( window.dashboard_nav_history_current_position >= window.dashboard_nav_history.length - 1 ) {
            forwardBtn.addClass('path-btn-disabled');
        } else {
            forwardBtn.removeClass('path-btn-disabled');
        }

        if ( this.currentPath === '/' ) {
            upBtn.addClass('path-btn-disabled');
        } else {
            upBtn.removeClass('path-btn-disabled');
        }
    },

    /**
     * Updates the browser URL hash to reflect the current file path in Dashboard.
     *
     * @param {string} filePath - The current file system path (e.g., /username/Documents)
     * @returns {void}
     */
    updateDashboardUrl (filePath) {
        // Disabled: don't modify the browser URL when navigating files.
    },

    /**
     * Handles click on the "more" button (three dots) for a file row.
     *
     * Shows appropriate context menu for single or multi-selection.
     *
     * @param {HTMLElement} rowElement - The row element that was clicked
     * @param {Object} file - The file/folder object data
     * @returns {Promise<void>}
     */
    /**
     * Marks a row as visually active for an open context menu and returns
     * the release function for that menu's onClose. Menus can overlap on the
     * same row (e.g. right-click while the '⋯' menu is still open): the newer
     * menu takes ownership of the state, so the older menu's late close must
     * not strip it — release only acts if its menu is still the owner.
     *
     * @param {HTMLElement} rowElement - The row the menu belongs to
     * @returns {Function} Release callback to assign as the menu's onClose
     */
    markRowContextMenuOpen (rowElement) {
        const token = (rowElement._ctxMenuToken = {});
        rowElement.classList.add('has-open-contextmenu');
        return () => {
            if ( rowElement._ctxMenuToken === token ) {
                rowElement.classList.remove('has-open-contextmenu');
                delete rowElement._ctxMenuToken;
            }
        };
    },

    async handleMoreClick (rowElement, file, targetElement) {
        const selectedRows = document.querySelectorAll('.files-tab .row.selected');

        let items;
        if ( selectedRows.length > 1 && rowElement.classList.contains('selected') ) {
            items = await this.generateMultiSelectContextMenu(selectedRows);
        }
        else {
            items = await this.generateContextMenuItems(rowElement, file);
        }

        // Use mobile-friendly context menu on touch devices
        if ( window.isMobile.phone || window.isMobile.tablet || navigator.maxTouchPoints > 0 ) {
            const targetRect = targetElement.getBoundingClientRect();
            const modal = new ContextMenuModal();
            modal.show(items, targetRect, { title: file.name });
        } else {
            // The '⋯' click doesn't select the row, so without this class the
            // row would lose all visual state the moment the pointer moves
            // onto the menu (same treatment as the right-click handler).
            const releaseCtxState = this.markRowContextMenuOpen(rowElement);
            const menu = UIContextMenu({ items: items });
            menu.onClose = releaseCtxState;
        }
    },

    /**
     * Generates context menu items for a single file/folder.
     *
     * @param {HTMLElement} el_item - The row DOM element
     * @param {Object} options - The file/folder object with metadata
     * @returns {Promise<Array>} Array of menu item objects
     */
    async generateContextMenuItems (el_item, options) {
        const _this = this;

        const is_trash = $(el_item).attr('data-path') === window.trash_path || $(el_item).attr('data-shortcut_to_path') === window.trash_path;
        const is_trashed = ($(el_item).attr('data-path') || '').startsWith(`${window.trash_path }/`);
        const is_worker = $(el_item).attr('data-is_worker') === "1";

        const menu_items = await generate_file_context_menu({
            element: el_item,
            fsentry: options,
            is_trash,
            is_trashed,
            is_worker,
            suggested_apps: options.suggested_apps,
            associated_app_name: options.associated_app_name,
            onRestore: async (el) => {
                await _this.restoreItem(el);
                $(el).fadeOut(150, function () {
                    $(this).remove();
                });
                _this.updateFooterStats();
            },
            onOpen: (el, fsentry) => {
                // Custom open handler for Dashboard (avoids window_nav_history issues)
                if ( fsentry.is_dir ) {
                    _this.pushNavHistory(fsentry.path);
                    _this.renderDirectory(fsentry.path);
                } else {
                    open_item({ item: el });
                }
            },
            onShowProperties: ({ name, path: item_path, uid }) => {
                // Dashboard uses a responsive modal instead of the desktop UIWindow.
                UIItemPropertiesModal({
                    name,
                    path: item_path,
                    uid,
                    $container: _this.$el_window,
                });
            },
        });

        return menu_items;
    },

    /**
     * Generates context menu items for multiple selected files/folders.
     *
     * Provides bulk operations like download, cut, copy, and delete.
     *
     * @param {NodeList|Array<HTMLElement>} selectedRows - The selected row elements
     * @returns {Promise<Array>} Array of menu item objects
     */
    async generateMultiSelectContextMenu (selectedRows) {
        const _this = this;
        const items = [];

        // Check if any are trashed
        const anyTrashed = Array.from(selectedRows).some(row => {
            const path = $(row).attr('data-path');
            return path?.startsWith(`${window.trash_path}/`);
        });

        if ( anyTrashed ) {
            items.push({
                html: i18n('restore'),
                onClick: async function () {
                    for ( const row of selectedRows ) {
                        try {
                            await _this.restoreItem(row);
                            $(row).fadeOut(150, function () {
                                $(this).remove();
                            });
                        } catch ( err ) {
                            console.error('Failed to restore item:', err);
                        }
                    }
                    _this.updateFooterStats();
                },
            });
            items.push('-');
        }

        if ( ! anyTrashed ) {
            items.push({
                html: `${i18n('download')}`,
                onClick: function () {
                    window.zipItems(Array.from(selectedRows), _this.currentPath, true);
                },
            });
            items.push('-');
        }

        // Cut
        items.push({
            html: `${i18n('cut')}`,
            onClick: function () {
                window.clipboard_op = 'move';
                window.clipboard = [];
                selectedRows.forEach(row => {
                    window.clipboard.push({
                        path: $(row).attr('data-path'),
                        uid: $(row).attr('data-uid'),
                    });
                });
            },
        });

        // Copy
        if ( ! anyTrashed ) {
            items.push({
                html: `${i18n('copy')}`,
                onClick: function () {
                    window.clipboard_op = 'copy';
                    window.clipboard = [];
                    selectedRows.forEach(row => {
                        window.clipboard.push({ path: $(row).attr('data-path') });
                    });
                },
            });
        }

        items.push('-');

        // Delete
        if ( anyTrashed ) {
            items.push({
                html: i18n('delete_permanently'),
                onClick: async function () {
                    const confirmed = await UIAlert({
                        message: i18n('confirm_delete_multiple_items'),
                        buttons: [
                            { label: i18n('delete'), value: 'delete', type: 'primary' },
                            { label: i18n('cancel'), value: 'cancel' },
                        ],
                    });
                    if ( confirmed === 'delete' ) {
                        for ( const row of selectedRows ) {
                            await window.delete_item(row);
                        }
                    }
                },
            });
        }
        else {
            items.push({
                html: `${i18n('delete')}`,
                onClick: function () {
                    window.move_items(Array.from(selectedRows), window.trash_path);
                },
            });
        }

        return items;
    },

    /**
     * Generates context menu items for folder background (empty area).
     *
     * Includes options for new folder/file, paste, upload, refresh, etc.
     *
     * @param {string} [folderPath] - The folder path, defaults to current path
     * @returns {Array} Array of menu item objects
     */
    generateFolderContextMenu (folderPath) {
        const _this = this;
        const targetPath = folderPath || this.currentPath;

        if ( ! targetPath ) return [];

        const isTrashFolder = targetPath === window.trash_path;
        const items = [];

        // New submenu (folder, text document, etc.) - not available in Trash
        // We create a custom "New" submenu to handle folder creation with refresh and rename activation
        if ( ! isTrashFolder ) {
            const newMenuItems = new_context_menu_item(targetPath, null);

            // Override the "New Folder" onClick to refresh and activate rename
            if ( newMenuItems.items && newMenuItems.items.length > 0 ) {
                const folderItem = newMenuItems.items[0]; // First item is "New Folder"
                folderItem.onClick = async () => {
                    $('.context-menu').remove();
                    _this._creatingItem = true;
                    try {
                        const result = await puter.fs.mkdir({
                            path: `${targetPath}/New Folder`,
                            rename: true,
                            overwrite: false,
                        });
                        // Remove empty-directory placeholder if present
                        _this.$el_window.find('.files-tab .files > div:not(.item)').remove();
                        // Add the new folder incrementally
                        await _this.renderItem(result);
                        const $newRow = _this.$el_window.find(`.files-tab .files .item[data-uid='${result.uid}']`);
                        if ( $newRow.length > 0 ) {
                            _this.insertAtSortedPosition($newRow, result);
                            _this.applyColumnWidths();
                            _this.updateFooterStats();
                            $newRow.addClass('selected');
                            window.activate_item_name_editor($newRow[0]);
                        }
                    } catch ( err ) {
                        // Folder creation failed silently
                    } finally {
                        _this._creatingItem = false;
                    }
                };

                // Override other file creation items to intercept create_file,
                // refresh directory, and activate rename mode
                const wrapWithDashboardRename = (originalOnClick) => {
                    return async () => {
                        $('.context-menu').remove();
                        _this._creatingItem = true;

                        // Temporarily intercept create_file to capture the upload promise
                        let uploadPromise = null;
                        const origCreateFile = window.create_file;
                        window.create_file = (options) => {
                            const content = options.content ? [options.content] : [];
                            uploadPromise = puter.fs.upload(new File(content, options.name), options.dirname);
                            return uploadPromise;
                        };

                        try {
                            await originalOnClick();

                            // For callback-based creation (e.g., canvas.toBlob), wait briefly
                            if ( ! uploadPromise ) {
                                await new Promise(resolve => setTimeout(resolve, 200));
                            }

                            if ( uploadPromise ) {
                                const result = await uploadPromise;
                                // Remove empty-directory placeholder if present
                                _this.$el_window.find('.files-tab .files > div:not(.item)').remove();
                                // Add the new file incrementally
                                await _this.renderItem(result);
                                const $newRow = _this.$el_window.find(`.files-tab .files .item[data-uid='${result.uid}']`);
                                if ( $newRow.length > 0 ) {
                                    _this.insertAtSortedPosition($newRow, result);
                                    _this.applyColumnWidths();
                                    _this.updateFooterStats();
                                    $newRow.addClass('selected');
                                    window.activate_item_name_editor($newRow[0]);
                                }
                            }
                        } catch ( err ) {
                            // File creation failed silently
                        } finally {
                            window.create_file = origCreateFile;
                            _this._creatingItem = false;
                        }
                    };
                };

                for ( let i = 2; i < newMenuItems.items.length; i++ ) {
                    const item = newMenuItems.items[i];
                    if ( !item || typeof item === 'string' ) continue;
                    if ( item.onClick ) {
                        item.onClick = wrapWithDashboardRename(item.onClick);
                    }
                    // Handle nested submenu items (user templates)
                    if ( item.items && Array.isArray(item.items) ) {
                        for ( const subItem of item.items ) {
                            if ( subItem && subItem.onClick ) {
                                subItem.onClick = wrapWithDashboardRename(subItem.onClick);
                            }
                        }
                    }
                }
            }

            items.push(newMenuItems);
            items.push('-');
        }

        // Paste - only if clipboard has items and not in Trash
        if ( !isTrashFolder && window.clipboard && window.clipboard.length > 0 ) {
            items.push({
                html: i18n('paste'),
                onClick: async function () {
                    if ( window.clipboard_op === 'copy' ) {
                        window.copy_clipboard_items(targetPath, null);
                    } else if ( window.clipboard_op === 'move' ) {
                        await _this.moveClipboardItems(targetPath);
                        // Refresh so moved-away source rows disappear and any
                        // items pasted into the current folder show up.
                        _this.renderDirectory(_this.currentPath);
                    }
                },
            });
        }

        // Undo - if there are actions to undo
        if ( window.actions_history && window.actions_history.length > 0 ) {
            items.push({
                html: i18n('undo'),
                onClick: function () {
                    window.undo_last_action();
                },
            });
        }

        // Add separator if we added paste or undo
        if ( items.length > 2 || (isTrashFolder && items.length > 0) ) {
            items.push('-');
        }

        // Upload Here - not available in Trash
        if ( ! isTrashFolder ) {
            items.push({
                html: i18n('upload'),
                onClick: function () {
                    const fileInput = document.querySelector('#upload-file-dialog');
                    if ( fileInput ) {
                        fileInput.click();
                    }
                },
            });
        }

        // Refresh
        items.push({
            html: i18n('refresh'),
            onClick: function () {
                _this.renderDirectory(_this.currentPath, { consistency: 'strong' });
            },
        });

        // Empty Trash - only in Trash folder
        if ( isTrashFolder ) {
            items.push('-');
            items.push({
                html: i18n('empty_trash'),
                onClick: function () {
                    window.empty_trash();
                },
            });
        }

        return items;
    },

    /**
     * Initializes rubber band (drag-to-select) selection for the files container.
     *
     * Uses the viselect library to enable drag selection in both list and grid views.
     * Only activates when dragging from empty space, not from file/folder items.
     *
     * @returns {void}
     */
    initRubberBandSelection () {
        const _this = this;

        // Skip on mobile/touch devices
        if ( window.isMobile.phone || window.isMobile.tablet ) {
            return;
        }

        let selected_ctrl_items = [];
        let selection_area = null;
        let selection_area_start_x = 0;
        let selection_area_start_y = 0;
        let initial_container_scroll_width = 0;
        let initial_container_scroll_height = 0;

        const filesContainer = this.$el_window.find('.files-tab .files')[0];
        if ( ! filesContainer ) return;

        const containerId = `tabfiles-container-${Date.now()}`;
        filesContainer.id = containerId;

        const selection = new SelectionArea({
            selectionContainerClass: 'selection-area-container',
            selectionAreaClass: 'hidden-selection-area',
            container: `#${containerId}`,
            selectables: [`#${containerId} .row`],
            startareas: [`#${containerId}`],
            boundaries: [`#${containerId}`],
            behaviour: {
                overlap: 'drop',
                intersect: 'touch',
                startThreshold: 10,
                scrolling: {
                    speedDivider: 10,
                    manualSpeed: 750,
                    startScrollMargins: { x: 0, y: 0 },
                },
            },
            features: {
                touch: false,
                range: true,
                singleTap: {
                    allow: false,
                    intersect: 'native',
                },
            },
        });

        this.rubberBandSelection = selection;

        selection.on('beforestart', ({ event }) => {
            selected_ctrl_items = [];

            // Block rubberband when starting from an already-selected item
            // (so that file dragging can take over instead).
            const targetRow = $(event.target).closest('.row:not(.header)');
            if ( targetRow.length && targetRow.hasClass('selected') ) {
                return false;
            }

            // Block rubberband when starting from item drag handles so item drag takes over
            if ( $(event.target).closest('.item-name, .item-icon, .item-badges').length ) {
                return false;
            }

            // Capture starting position (element created later in 'start' event)
            const scrollLeft = $(filesContainer).scrollLeft();
            const scrollTop = $(filesContainer).scrollTop();
            const containerRect = filesContainer.getBoundingClientRect();

            initial_container_scroll_width = filesContainer.scrollWidth;
            initial_container_scroll_height = filesContainer.scrollHeight;

            let relativeX = event.clientX - containerRect.left + scrollLeft;
            let relativeY = event.clientY - containerRect.top + scrollTop;

            relativeX = Math.max(0, Math.min(initial_container_scroll_width, relativeX));
            relativeY = Math.max(0, Math.min(initial_container_scroll_height, relativeY));

            selection_area_start_x = relativeX;
            selection_area_start_y = relativeY;

            return true;
        });

        selection.on('start', ({ store, event }) => {
            if ( !event.ctrlKey && !event.metaKey ) {
                for ( const el of store.stored ) {
                    el.classList.remove('selected');
                }
                selection.clearSelection();
            }

            // Disable pointer events on selection actions bar during drag
            _this.$el_window.find('.files-selection-actions').addClass('rubberband-active');

            // Create selection area element only when drag actually starts (after threshold)
            selection_area = document.createElement('div');
            $(filesContainer).append(selection_area);
            $(selection_area).addClass('tabfiles-selection-area');
            $(selection_area).css({
                position: 'absolute',
                top: selection_area_start_y,
                left: selection_area_start_x,
                width: 0,
                height: 0,
                zIndex: 1000,
                display: 'block',
            });
        });

        selection.on('move', ({ store: { changed: { added, removed } }, event }) => {
            // Skip if no event (can happen during programmatic moves)
            if ( ! event ) return;

            const scrollLeft = $(filesContainer).scrollLeft();
            const scrollTop = $(filesContainer).scrollTop();
            const containerRect = filesContainer.getBoundingClientRect();

            let currentMouseX = event.clientX - containerRect.left + scrollLeft;
            let currentMouseY = event.clientY - containerRect.top + scrollTop;

            const constrainedMouseX = Math.max(0, Math.min(filesContainer.scrollWidth, currentMouseX));
            const constrainedMouseY = Math.max(0, Math.min(filesContainer.scrollHeight, currentMouseY));

            const width = Math.abs(constrainedMouseX - selection_area_start_x);
            const height = Math.abs(constrainedMouseY - selection_area_start_y);
            const left = Math.min(constrainedMouseX, selection_area_start_x);
            const top = Math.min(constrainedMouseY, selection_area_start_y);

            $(selection_area).css({ width, height, left, top });

            for ( const el of added ) {
                if ( (event.ctrlKey || event.metaKey) && $(el).hasClass('selected') ) {
                    el.classList.remove('selected');
                    selected_ctrl_items.push(el);
                } else {
                    el.classList.add('selected');
                    window.active_element = el;
                    window.latest_selected_item = el;
                }
            }

            for ( const el of removed ) {
                el.classList.remove('selected');
                if ( selected_ctrl_items.includes(el) ) {
                    $(el).addClass('selected');
                }
            }

            _this.updateFooterStats();
        });

        selection.on('stop', () => {
            if ( selection_area ) {
                $(selection_area).remove();
                selection_area = null;
                // Flag to prevent the click handler from clearing selection
                _this.rubberBandSelectionJustEnded = true;
            }
            // Re-enable pointer events on selection actions bar
            _this.$el_window.find('.files-selection-actions').removeClass('rubberband-active');
            _this.updateFooterStats();
        });
    },

    /**
     * Initializes native file drag-and-drop upload support.
     *
     * Sets up dragster on the main files container to allow dropping
     * local files for upload. Sidebar folders and folder rows get their
     * dragster initialized in init() and createItemListeners() respectively.
     *
     * @returns {void}
     */
    initNativeFileDrop () {
        this.initContentAreaDragster();
    },

    /**
     * Initializes dragster on the main files content area.
     *
     * Dropping files here uploads them to the current directory (this.currentPath).
     * Only responds to native file drags (from OS), not internal item drags.
     *
     * @returns {void}
     */
    initContentAreaDragster () {
        const _this = this;
        const $filesContainer = this.$el_window.find('.files-tab .files');

        $filesContainer.dragster({
            enter: function (_dragsterEvent, event) {
                const e = event.originalEvent;
                // Only respond to native file drags, not internal item drags
                if ( ! e.dataTransfer?.types?.includes('Files') ) {
                    return;
                }

                // Don't show drop zone if we're in trash
                if ( _this.currentPath === window.trash_path ) {
                    return;
                }

                // Remove any context menus
                $('.context-menu').remove();

                // Add visual drop zone indicator
                $filesContainer.addClass('native-drop-active');
            },

            leave: function (_dragsterEvent, _event) {
                $filesContainer.removeClass('native-drop-active');
            },

            drop: async function (_dragsterEvent, event) {
                const e = event.originalEvent;
                $filesContainer.removeClass('native-drop-active');

                // Only handle native file drops
                if ( ! e.dataTransfer?.types?.includes('Files') ) {
                    return;
                }

                // Skip if drop was on a subfolder (check if target is inside a folder row)
                const $target = $(e.target);
                const $folderRow = $target.closest('.row.folder');
                if ( $folderRow.length > 0 ) {
                    // Drop was on a folder row, let it handle the upload
                    return;
                }

                // Block uploads to trash
                if ( _this.currentPath === window.trash_path ) {
                    return;
                }

                // Upload the dropped files
                if ( e.dataTransfer?.items?.length > 0 ) {
                    _this.uploadFiles(e.dataTransfer.items, _this.currentPath);
                }

                e.stopPropagation();
                e.preventDefault();
                return false;
            },
        });
    },

    /**
     * Uploads files to the specified destination path.
     *
     * This method handles the complete upload flow including progress modal,
     * error handling, and directory refresh on completion. Used by drag-drop
     * upload handlers to ensure the Dashboard view updates after uploads.
     *
     * @param {DataTransferItemList|FileList} items - The files to upload
     * @param {string} destPath - The destination directory path
     * @returns {void}
     */
    uploadFiles (items, destPath) {
        const _this = this;
        let upload_progress_window;
        let opid;

        if ( destPath === window.trash_path ) {
            UIAlert('Uploading to trash is not allowed!');
            return;
        }

        puter.fs.upload(items, destPath, {
            generateThumbnails: true,
            init: async (operation_id, xhr) => {
                opid = operation_id;
                upload_progress_window = await UIWindowProgress({
                    title: i18n('upload'),
                    icon: window.icons['app-icon-uploader.svg'],
                    operation_id: operation_id,
                    show_progress: true,
                    on_cancel: () => {
                        window.show_save_account_notice_if_needed();
                        xhr.abort();
                    },
                });
                window.active_uploads[opid] = 0;
            },
            start: async function () {
                upload_progress_window.set_status('Uploading');
                upload_progress_window.set_progress(0);
            },
            progress: async function (_operation_id, op_progress) {
                upload_progress_window.set_progress(op_progress);
                window.active_uploads[opid] = op_progress;
                if ( document.visibilityState !== 'visible' ) {
                    update_title_based_on_uploads();
                }
            },
            success: function (items) {
                const files = [];
                if ( typeof items[Symbol.iterator] === 'function' ) {
                    for ( const item of items ) {
                        files.push(item.path);
                    }
                } else {
                    files.push(items.path);
                }
                window.actions_history.push({
                    operation: 'upload',
                    data: files,
                });
                setTimeout(() => {
                    upload_progress_window.close();
                }, 1000);
                window.show_save_account_notice_if_needed();
                delete window.active_uploads[opid];
                // Refresh directory to show uploaded files
                _this.renderDirectory(_this.currentPath, { consistency: 'strong' });
            },
            error: async function (err) {
                const failedItems = Array.isArray(err?.failedItems) ? err.failedItems : [];
                if ( failedItems.length > 0 ) {
                    const failedSummary = failedItems.map((item) => {
                        const failedPath = item?.path || item?.name || `item ${item?.requestIndex ?? '?'}`;
                        const failedMessage = typeof item?.message === 'string' && item.message.length > 0
                            ? ` (${item.message})`
                            : '';
                        return `- ${failedPath}${failedMessage}`;
                    }).join('\n');
                    UIAlert(`Some uploads failed:\n${failedSummary}`);
                }
                upload_progress_window.show_error(i18n('error_uploading_files'), err.message);
                delete window.active_uploads[opid];
                _this.renderDirectory(_this.currentPath, { consistency: 'strong' });
            },
            abort: async function (_operation_id) {
                delete window.active_uploads[opid];
            },
        });
    },

    /**
     * Renders the breadcrumb path navigation HTML.
     *
     * Creates clickable path segments with separators.
     *
     * @param {string} abs_path - The absolute path to render
     * @returns {string} HTML string for the breadcrumb navigation
     */
    renderPath (abs_path) {
        const { html_encode } = window;
        // remove trailing slash
        if ( abs_path.endsWith('/') && abs_path !== '/' ) {
            abs_path = abs_path.slice(0, -1);
        }

        const dirs = (abs_path === '/' ? [''] : abs_path.split('/'));
        const dirpaths = (abs_path === '/' ? ['/'] : []);
        const path_seperator_html = `<img class="path-seperator" draggable="false" src="${html_encode(window.icons['triangle-right.svg'])}">`;
        if ( dirs.length > 1 ) {
            for ( let i = 0; i < dirs.length; i++ ) {
                dirpaths[i] = '';
                for ( let j = 1; j <= i; j++ ) {
                    dirpaths[i] += `/${dirs[j]}`;
                }
            }
        }
        let str = `${path_seperator_html}<span class="dirname" data-path="${html_encode('/')}">${html_encode(window.root_dirname)}</span>`;
        for ( let k = 1; k < dirs.length; k++ ) {
            str += `${path_seperator_html}<span class="dirname" data-path="${html_encode(dirpaths[k])}">${dirs[k] === 'Trash' ? i18n('trash') : html_encode(dirs[k])}</span>`;
        }
        return str;
    },

    /**
     *
     * Shows loading spinner over files section
     */
    showSpinner () {
        if ( this.loading ) return;
        this.loading = true;

        const overlay = document.createElement('div');
        overlay.classList.add('files-loading-overlay');
        overlay.innerHTML = `
            <div class="files-loading-container">
                <div class="files-loading-spinner"></div>
                <div class="files-loading-text">Working...</div>
            </div>
        `;

        document.querySelector('.directory-contents .files').appendChild(overlay);
        setTimeout(() => {
            overlay.style.opacity = 1;
        }, 100);
    },

    /**
     *
     * Hides the loading spinner over files section
     */
    hideSpinner () {
        const overlay = document.querySelector('.files-loading-overlay');
        if ( overlay ) {
            overlay.parentNode?.removeChild(overlay);
        }
        this.loading = false;
    },
};

// Canvas context for measuring text width (reused for performance)
let measureContext = null;

/**
 * Measures the pixel width of text using a canvas context.
 *
 * @param {string} text - The text to measure
 * @param {string} font - CSS font string (e.g., '500 13px system-ui')
 * @returns {number} Width in pixels
 */
function measureTextWidth (text, font = '500 13px system-ui, -apple-system, sans-serif') {
    if ( ! measureContext ) {
        const canvas = document.createElement('canvas');
        measureContext = canvas.getContext('2d');
    }
    measureContext.font = font;
    return measureContext.measureText(text).width;
}

/**
 * Truncates a filename in the middle to fit a given pixel width, preserving the extension.
 *
 * @param {string} filename - The full filename to truncate
 * @param {number} maxWidth - Maximum width in pixels
 * @param {string} font - CSS font string for measurement
 * @returns {string} Truncated filename with ellipsis in middle, or original if it fits
 */
function truncateFilenameToWidth (filename, maxWidth, font = '500 13px system-ui, -apple-system, sans-serif') {
    const fullWidth = measureTextWidth(filename, font);
    if ( fullWidth <= maxWidth ) {
        return filename;
    }

    // Find extension
    const lastDot = filename.lastIndexOf('.');
    const hasExtension = lastDot > 0 && lastDot < filename.length - 1;
    const extension = hasExtension ? filename.slice(lastDot) : '';
    const baseName = hasExtension ? filename.slice(0, lastDot) : filename;

    const ellipsis = '…';
    const ellipsisWidth = measureTextWidth(ellipsis, font);
    const extensionWidth = measureTextWidth(extension, font);

    // Available width for the base name (before and after ellipsis)
    const availableWidth = maxWidth - ellipsisWidth - extensionWidth;
    if ( availableWidth <= 0 ) {
        return ellipsis + extension;
    }

    // Binary search to find how many characters fit
    // We want roughly equal parts before and after the ellipsis
    const targetHalfWidth = availableWidth / 2;

    let startChars = 0;
    let endChars = 0;

    // Find characters for start
    for ( let i = 1; i <= baseName.length; i++ ) {
        if ( measureTextWidth(baseName.slice(0, i), font) > targetHalfWidth ) {
            startChars = i - 1;
            break;
        }
        startChars = i;
    }

    // Find characters for end (before extension)
    for ( let i = 1; i <= baseName.length - startChars; i++ ) {
        if ( measureTextWidth(baseName.slice(-i), font) > targetHalfWidth ) {
            endChars = i - 1;
            break;
        }
        endChars = i;
    }

    if ( startChars === 0 && endChars === 0 ) {
        return ellipsis + extension;
    }

    const start = baseName.slice(0, startChars);
    const end = endChars > 0 ? baseName.slice(-endChars) : '';

    return start + ellipsis + end + extension;
}

export default TabFiles;
