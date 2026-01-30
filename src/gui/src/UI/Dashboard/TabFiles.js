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
import new_context_menu_item from '../../helpers/new_context_menu_item.js';

const icons = {
    document: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`,
    files: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    folder: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`,
    more: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>`,
    newFolder: `<svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="currentcolor"><path d="M560-320h80v-80h80v-80h-80v-80h-80v80h-80v80h80v80ZM160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80h640v-400H447l-80-80H160v480Zm0 0v-480 480Z"/></svg>`,
    upload: `<svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="currentcolor"><path d="M440-320v-326L336-542l-56-58 200-200 200 200-56 58-104-104v326h-80ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/></svg>`,
    trash: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
    list: `<svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="currentcolor"><path d="M280-600v-80h560v80H280Zm0 160v-80h560v80H280Zm0 160v-80h560v80H280ZM160-600q-17 0-28.5-11.5T120-640q0-17 11.5-28.5T160-680q17 0 28.5 11.5T200-640q0 17-11.5 28.5T160-600Zm0 160q-17 0-28.5-11.5T120-480q0-17 11.5-28.5T160-520q17 0 28.5 11.5T200-480q0 17-11.5 28.5T160-440Zm0 160q-17 0-28.5-11.5T120-320q0-17 11.5-28.5T160-360q17 0 28.5 11.5T200-320q0 17-11.5 28.5T160-280Z"/></svg>`,
    grid: `<svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="currentcolor"><path d="M120-520v-320h320v320H120Zm0 400v-320h320v320H120Zm400-400v-320h320v320H520Zm0 400v-320h320v320H520ZM200-600h160v-160H200v160Zm400 0h160v-160H600v160Zm0 400h160v-160H600v160Zm-400 0h160v-160H200v160Zm400-400Zm0 240Zm-240 0Zm0-240Z"/></svg>`,
    sort: `<svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="currentcolor"><path d="M120-240v-80h240v80H120Zm0-200v-80h480v80H120Zm0-200v-80h720v80H120Z"/></svg>`,
};

const { html_encode } = window;

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
                        <li data-folder="Desktop" data-path="${html_encode(window.docs_path)}"><img src="${html_encode(window.icons['folder-desktop.svg'])}"/> <span>Desktop</span></li>
                        <li data-folder="Documents" data-path="${html_encode(window.public_path)}"><img src="${html_encode(window.icons['folder-documents.svg'])}"/> <span>Documents</span></li>
                        <li data-folder="Pictures" data-path="${html_encode(window.pictures_path)}"><img src="${html_encode(window.icons['folder-pictures.svg'])}"/> <span>Pictures</span></li>
                        <li data-folder="Public" data-path="${html_encode(window.desktop_path)}"><img src="${html_encode(window.icons['folder-public.svg'])}"/> <span>Public</span></li>
                        <li data-folder="Videos" data-path="${html_encode(window.videos_path)}"><img src="${html_encode(window.icons['folder-videos.svg'])}"/> <span>Videos</span></li>
                        <li data-folder="Trash" data-path="${html_encode(window.trash_path)}"><img src="${html_encode(window.icons['trash.svg'])}"/> <span>Trash</span></li>
                    </ul>
                </div>
                <div class="directory-contents">
                    <div class="header">
                        <div class="path">
                            <div class="path-nav-buttons">
                                <img draggable="false" class="path-btn path-btn-back path-btn-disabled" src="${html_encode(window.icons['arrow-left.svg'])}" title="${i18n('window_click_to_go_back')}">
                                <img draggable="false" class="path-btn path-btn-forward path-btn-disabled" src="${html_encode(window.icons['arrow-right.svg'])}" title="${i18n('window_click_to_go_forward')}">
                                <img draggable="false" class="path-btn path-btn-up path-btn-disabled" src="${html_encode(window.icons['arrow-up.svg'])}" title="${i18n('window_click_to_go_up')}">
                            </div>
                            <div class="path-breadcrumbs"></div>
                            <div class="path-actions">
                                <button class="path-action-btn sort-btn" title="Sort by">${icons.sort}</button>
                                <button class="path-action-btn view-toggle-btn" title="Toggle view">${icons.grid}</button>
                                <button class="path-action-btn new-folder-btn" title="${i18n('new_folder')}">${icons.newFolder}</button>
                                <button class="path-action-btn upload-btn" title="${i18n('upload')}">${icons.upload}</button>
                            </div>
                        </div>
                        <div class="columns">
                            <div class="item-icon"></div>
                            <div class="item-name sortable" data-sort="name">File name</div>
                            <div class="col-resize-handle" data-resize="name"></div>
                            <div class="item-size sortable" data-sort="size">Size</div>
                            <div class="col-resize-handle" data-resize="size"></div>
                            <div class="item-modified sortable" data-sort="modified">Modified</div>
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
        const _this = this;
        this.activeMenuFileUid = null;
        this.selectedFolderUid = null;
        this.currentPath = null;
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
        if ( window.isMobile.phone || window.isMobile.tablet ) {
            $el_window.find('.files-tab').addClass('touch-device');
        }

        // Create click handler for each folder item
        $el_window.find('[data-folder]').each(function () {
            const folderElement = this;

            folderElement.onclick = async () => {
                const folderName = folderElement.getAttribute('data-folder');
                const directories = await puter.fs.readdir(`/${window.user.username}`);
                const folderPath = folderElement.getAttribute('data-path'); //directories.find(f => f.is_dir && f.name === folderName).path;
                const folderUid = directories.find(f => f.is_dir && f.name === folderName).uid;

                _this.pushNavHistory(folderPath);
                _this.renderDirectory(folderUid);
                _this.selectedFolderUid = folderUid;
                _this.selectFolder(folderElement);
            };

            // Make sidebar folders droppable
            $(folderElement).droppable({
                accept: '.row',
                tolerance: 'pointer',

                drop: async function (event, ui) {
                    // Block if ctrl and trashed
                    const draggedPath = $(ui.draggable).attr('data-path');
                    if ( event.ctrlKey && draggedPath?.startsWith(`${window.trash_path}/`) ) {
                        return;
                    }

                    ui.helper.data('dropped', true);

                    // Get target folder path
                    const folderName = folderElement.getAttribute('data-folder');
                    const directories = Object.keys(window.user.directories);
                    const targetPath = directories.find(f => f.endsWith(folderName));

                    if ( ! targetPath ) return;

                    // Collect all items to move
                    const itemsToMove = [ui.draggable[0]];

                    // Add other selected items
                    $('.item-selected-clone').each(function () {
                        const sourceId = $(this).attr('data-id');
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

                    setTimeout(() => _this.renderDirectory(_this.selectedFolderUid), 100);
                },

                over: function (_event, ui) {
                    if ( $(ui.draggable).hasClass('row') ) {
                        $(folderElement).addClass('active');
                    }
                },

                out: function (_event, ui) {
                    if ( $(ui.draggable).hasClass('row') ) {
                        // Only remove active if it's not the currently selected folder
                        const folderName = folderElement.getAttribute('data-folder');
                        const directories = Object.keys(window.user.directories);
                        const folderUid = window.user.directories[directories.find(f => f.endsWith(folderName))];

                        if ( folderUid !== _this.selectedFolderUid ) {
                            $(folderElement).removeClass('active');
                        }
                    }
                },
            });
        });

        // Clear selection when clicking empty area
        $el_window.find('.dashboard-tab-content').on('click', (e) => {
            if ( e.target === this || e.target.classList.contains('files') ) {
                document.querySelectorAll('.files-tab .row.selected').forEach(r => {
                    r.classList.remove('selected');
                });
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
                // Clear selection when right-clicking background
                document.querySelectorAll('.files-tab .row.selected').forEach(r => {
                    r.classList.remove('selected');
                });
                const items = await _this.generateFolderContextMenu();
                UIContextMenu({ items: items, position: { left: e.pageX, top: e.pageY } });
            }
        });

        // Store reference to $el_window for later use (must be before createHeaderEventListeners)
        this.$el_window = $el_window;

        this.createHeaderEventListeners($el_window);

        // Apply initial view mode from persisted preferences

        const $filesContainer = this.$el_window.find('.files-tab .files');
        const $tabContent = this.$el_window.find('.files-tab');
        if ( this.currentView === 'grid' ) {
            $filesContainer.addClass('files-grid-view');
            $tabContent.addClass('files-grid-mode');
            this.$el_window.find('.view-toggle-btn').html(icons.list);
        } else {
            $filesContainer.addClass('files-list-view');
            this.$el_window.find('.view-toggle-btn').html(icons.grid);
        }

        // Auto-select Documents folder on initialization
        const documentsFolder = $el_window.find('[data-folder="Documents"]');
        if ( documentsFolder.length ) {
            documentsFolder.trigger('click');
        }
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
        $(el_window_navbar_back_btn).on('click', function (e) {
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
                    html: `<span>${history_item === window.home_path ? i18n('home') : path.basename(history_item)}</span>`,
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
        $(el_window_navbar_forward_btn).on('click', function (e) {
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
                    html: `<span>${history_item === window.home_path ? i18n('home') : path.basename(history_item)}</span>`,
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
        $(el_window_navbar_up_btn).on('click', function (e) {
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
                await _this.renderDirectory(_this.selectedFolderUid);
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
                    _this.renderDirectory(_this.selectedFolderUid);
                    // Clear the input value to allow uploading the same file again
                    fileInput.value = '';
                    document.querySelector('form').reset();
                },
                // error
                error: async function (err) {
                    upload_progress_window.show_error(i18n('error_uploading_files'), err.message);
                    // remove from active_uploads
                    delete window.active_uploads[opid];
                },
                // abort
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

        // View toggle button
        document.querySelector('.view-toggle-btn').onclick = () => {
            this.toggleView();
        };

        // Sort button (shows dropdown menu)
        document.querySelector('.sort-btn').onclick = (e) => {
            this.showSortMenu(e);
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
    },

    /**
     * Applies the current column widths to the header and file rows.
     *
     * @returns {void}
     */
    applyColumnWidths () {
        const $filesTab = this.$el_window.find('.files-tab');
        const nameWidth = this.columnWidths.name;
        const sizeWidth = this.columnWidths.size || 100;
        const modifiedWidth = this.columnWidths.modified || 120;

        const nameCol = nameWidth ? `${nameWidth}px` : 'auto';
        const gridTemplate = `24px ${nameCol} 4px ${sizeWidth}px 4px ${modifiedWidth}px 4px 20px`;

        $filesTab.find('.header .columns').css('grid-template-columns', gridTemplate);
        $filesTab.find('.files.files-list-view .row').css('grid-template-columns', gridTemplate);
    },

    /**
     * Visually selects a folder in the sidebar directory list.
     *
     * @param {HTMLElement} $folderElement - The folder list item element to select
     * @returns {void}
     */
    selectFolder ($folderElement) {
        $folderElement.parentElement.querySelectorAll('li').forEach(li => {
            li.classList.remove('active');
        });
        $folderElement.classList.add('active');
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

        this.$el_window.find('[data-folder]').each(function () {
            const folderName = this.getAttribute('data-folder');
            const directories = Object.keys(window.user.directories);
            const folderPath = directories.find(f => f.endsWith(folderName));

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
                    window.empty_trash(() => {
                        this.renderDirectory(this.selectedFolderUid);
                    });
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

        this.renderDirectory(this.selectedFolderUid);
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
     * @returns {Promise<void>}
     */
    async renderDirectory (uid) {
        this.selectedFolderUid = uid;
        const _this = this;

        document.querySelectorAll('.files-tab .row.selected').forEach(r => {
            r.classList.remove('selected');
        });

        const directoryContents = await window.puter.fs.readdir({ uid });
        if ( ! directoryContents ) {
            return;
        }

        let path = null;
        Object.entries(window.user.directories).forEach(o => {
            if ( o[1] === uid ) {
                path = o[0];
            }
        });

        this.currentPath = path || uid;

        this.updateSidebarSelection();

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
                const items = _this.generateFolderContextMenu(clickedPath);
                UIContextMenu({ items: items, position: { left: e.pageX, top: e.pageY } });
            });
        });

        $('.files-tab .files').html('');

        if ( directoryContents.length === 0 ) {
            $('.files-tab .files').append(`<div class="row">
                <div class="item-icon"></div>
                <div class="item-name">No files in this directory.</div>
                <div class="col-spacer"></div>
                <div class="item-size"></div>
                <div class="col-spacer"></div>
                <div class="item-modified"></div>
                <div class="col-spacer"></div>
                <div class="item-more"></div>
            `);
            this.updateFooterStats();
            this.updateNavButtonStates();
            return;
        }

        const sortedContents = this.sortFiles(directoryContents);
        sortedContents.forEach(file => {
            this.renderItem(file);
        });

        this.applyColumnWidths();
        this.updateFooterStats();
        this.updateNavButtonStates();
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
    renderItem (file) {
        // For trashed items, use original_name from metadata if available
        const metadata = JSON.parse(file.metadata) || {};
        const displayName = metadata.original_name || file.name;

        const icon = file.is_dir ? `<img src="${html_encode(window.icons['folder.svg'])}"/>` : (file.thumbnail ? `<img src="${file.thumbnail}" alt="${displayName}" />` : this.determineIcon(file));
        const row = document.createElement("div");
        row.setAttribute('class', `row ${file.is_dir ? 'folder' : 'file'}`);
        row.setAttribute("data-id", file.id);
        row.setAttribute("data-name", displayName);
        row.setAttribute("data-uid", file.uid);
        row.setAttribute("data-is_dir", file.is_dir ? "1" : "0");
        row.setAttribute("data-is_trash", 0);
        row.setAttribute("data-has_website", 0);
        row.setAttribute("data-website_url", "");
        row.setAttribute("data-immutable", file.immutable);
        row.setAttribute("data-is_shortcut", file.is_shortcut);
        row.setAttribute("data-shortcut_to", "");
        row.setAttribute("data-shortcut_to_path", "");
        row.setAttribute("data-sortable", "1");
        row.setAttribute("data-metadata", JSON.stringify(metadata));
        row.setAttribute("data-sort_by", "");
        row.setAttribute("data-size", file.size);
        row.setAttribute("data-type", "");
        row.setAttribute("data-modified", file.modified);
        row.setAttribute("data-associated_app_name", "");
        row.setAttribute("data-path", file.path);
        row.innerHTML = `
            <div class="item-icon">${icon}</div>
            <div class="item-name-wrapper">
                <pre class="item-name">${displayName}</pre>
                <textarea class="item-name-editor hide-scrollbar" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" data-gramm_editor="false">${displayName}</textarea>
            </div>
            <div class="col-spacer"></div>
            ${file.is_dir ? '<div class="item-size"></div>' : `<div class="item-size">${this.formatFileSize(file.size)}</div>`}
            <div class="col-spacer"></div>
            <div class="item-modified">${window.timeago.format(file.modified * 1000)}</div>
            <div class="col-spacer"></div>
            <div class="item-more">${icons.more}</div>
        `;
        $('.files-tab .files').append(row);

        this.createItemListeners(row, file);
    },

    /**
     * Determines the appropriate icon for a file based on its extension.
     *
     * @param {Object} file - The file object containing the filename
     * @returns {string} HTML string for the icon image element
     */
    determineIcon (file) {
        const extension = file.name.split('.').pop().toLowerCase();
        switch ( extension ) {
        case 'm4a':
        case 'ogg':
        case 'aac':
        case 'flac':
            return `<img src="${html_encode(window.icons['file-audio.svg'])}"/>`;
        case 'cpp':
            return `<img src="${html_encode(window.icons['file-cpp.svg'])}"/>`;
        case 'css':
            return `<img src="${html_encode(window.icons['file-css.svg'])}"/>`;
        case 'csv':
            return `<img src="${html_encode(window.icons['file-csv.svg'])}"/>`;
        case 'doc':
        case 'docx':
            return `<img src="${html_encode(window.icons['file-word.svg'])}"/>`;
        case 'exe':
            return `<img src="${html_encode(window.icons['file-exe.svg'])}"/>`;
        case 'gzip':
            return `<img src="${html_encode(window.icons['file-gzip.svg'])}"/>`;
        case 'html':
            return `<img src="${html_encode(window.icons['file-html.svg'])}"/>`;
        case 'jpg':
        case 'jpeg':
        case 'png':
        case 'webp':
        case 'gif':
            return `<img src="${html_encode(window.icons['file-image.svg'])}"/>`;
        case 'jar':
            return `<img src="${html_encode(window.icons['file-jar.svg'])}"/>`;
        case 'java':
            return `<img src="${html_encode(window.icons['file-pdf.svg'])}"/>`;
        case 'js':
            return `<img src="${html_encode(window.icons['file-js.svg'])}"/>`;
        case 'json':
            return `<img src="${html_encode(window.icons['file-json.svg'])}"/>`;
        case 'jsp':
            return `<img src="${html_encode(window.icons['file-jsp.svg'])}"/>`;
        case 'log':
            return `<img src="${html_encode(window.icons['file-log.svg'])}"/>`;
        case 'md':
            return `<img src="${html_encode(window.icons['file-md.svg'])}"/>`;
        case 'mp3':
            return `<img src="${html_encode(window.icons['file-mp3.svg'])}"/>`;
        case 'otf':
            return `<img src="${html_encode(window.icons['file-otf.svg'])}"/>`;
        case 'pdf':
            return `<img src="${html_encode(window.icons['file-pdf.svg'])}"/>`;
        case 'php':
            return `<img src="${html_encode(window.icons['file-php.svg'])}"/>`;
        case 'pptx':
            return `<img src="${html_encode(window.icons['file-pptx.svg'])}"/>`;
        case 'psd':
            return `<img src="${html_encode(window.icons['file-psd.svg'])}"/>`;
        case 'py':
            return `<img src="${html_encode(window.icons['file-py.svg'])}"/>`;
        case 'rss':
            return `<img src="${html_encode(window.icons['file-rss.svg'])}"/>`;
        case 'rtf':
            return `<img src="${html_encode(window.icons['file-rtf.svg'])}"/>`;
        case 'ruby':
            return `<img src="${html_encode(window.icons['file-ruby.svg'])}"/>`;
        case 'sketch':
            return `<img src="${html_encode(window.icons['file-sketch.svg'])}"/>`;
        case 'sql':
            return `<img src="${html_encode(window.icons['file-sql.svg'])}"/>`;
        case 'svg':
            return `<img src="${html_encode(window.icons['file-svg.svg'])}"/>`;
        case 'tar':
            return `<img src="${html_encode(window.icons['file-tar.svg'])}"/>`;
        case 'tpl':
        case 'xltx':
        case 'potx':
        case 'tmpl':
            return `<img src="${html_encode(window.icons['file-template.svg'])}"/>`;
        case 'text':
        case 'txt':
            return `<img src="${html_encode(window.icons['file-text.svg'])}"/>`;
        case 'tif':
            return `<img src="${html_encode(window.icons['file-tif.svg'])}"/>`;
        case 'tiff':
            return `<img src="${html_encode(window.icons['file-tiff.svg'])}"/>`;
        case 'ttf':
            return `<img src="${html_encode(window.icons['file-ttf.svg'])}"/>`;
        case 'mp4':
        case 'avi':
        case 'mov':
        case 'wmf':
        case 'mkv':
        case 'webm':
            return `<img src="${html_encode(window.icons['file-video.svg'])}"/>`;
        case 'wav':
            return `<img src="${html_encode(window.icons['file-wav.svg'])}"/>`;
        case 'xlsx':
            return `<img src="${html_encode(window.icons['file-xlsx.svg'])}"/>`;
        case 'xml':
            return `<img src="${html_encode(window.icons['file-xml.svg'])}"/>`;
        case 'zip':
            return `<img src="${html_encode(window.icons['file-zip.svg'])}"/>`;
        default:
            return `<img src="${html_encode(window.icons['file.svg'])}"/>`;
        }
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

        el_item.onpointerdown = (e) => {
            if ( e.target.classList.contains('item-more') ) return;
            if ( el_item.classList.contains('header') ) return;

            shift_clicked = false;

            if ( e.which === 3 && el_item.classList.contains('selected') &&
                el_item.parentElement.querySelectorAll('.row.selected').length > 1 ) {
                return;
            }

            // Handle Shift+Click for range selection
            if ( e.shiftKey && window.latest_selected_item && window.latest_selected_item !== el_item ) {
                e.preventDefault();
                shift_clicked = true;

                const allRows = $(el_item).parent().find('.row').toArray();
                const clickedIndex = allRows.indexOf(el_item);
                const lastSelectedIndex = allRows.indexOf(window.latest_selected_item);

                if ( clickedIndex !== -1 && lastSelectedIndex !== -1 ) {
                    const start = Math.min(clickedIndex, lastSelectedIndex);
                    const end = Math.max(clickedIndex, lastSelectedIndex);

                    // Clear selection if no Ctrl/Cmd held
                    if ( !e.ctrlKey && !e.metaKey ) {
                        el_item.parentElement.querySelectorAll('.row.selected').forEach(r => {
                            r.classList.remove('selected');
                        });
                    }

                    // Select all items in range
                    for ( let i = start; i <= end; i++ ) {
                        allRows[i].classList.add('selected');
                    }

                    // Update latest selected to the clicked item
                    window.latest_selected_item = el_item;
                    window.active_element = el_item;
                    window.active_item_container = el_item.closest('.files');
                    _this.updateFooterStats();
                    return;
                }
            }

            if ( !e.ctrlKey && !e.metaKey && !e.shiftKey && !el_item.classList.contains('selected') ) {
                el_item.parentElement.querySelectorAll('.row.selected').forEach(r => {
                    r.classList.remove('selected');
                });
            }

            if ( ! e.shiftKey ) {
                if ( (e.ctrlKey || e.metaKey) && el_item.classList.contains('selected') ) {
                    el_item.classList.remove('selected');
                } else {
                    el_item.classList.add('selected');
                    window.latest_selected_item = el_item;
                }
            }

            window.active_element = el_item;
            window.active_item_container = el_item.closest('.files');
            _this.updateFooterStats();
        };

        el_item.onclick = (e) => {
            if ( e.target.classList.contains('item-more') ) {
                this.handleMoreClick(el_item, file);
                return;
            }

            // Skip if this was a shift-click (already handled in pointerdown)
            if ( shift_clicked ) {
                shift_clicked = false;
                return;
            }

            if ( !e.ctrlKey && !e.metaKey && !e.shiftKey ) {
                el_item.parentElement.querySelectorAll('.row.selected').forEach(r => {
                    if ( r !== el_item ) r.classList.remove('selected');
                });
            }
            _this.updateFooterStats();
        };

        el_item.ondblclick = () => {
            // if ( el_item.classList.contains('selected') ) {
            //     window.activate_item_name_editor(el_item);
            //     return;
            // }
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
            if ( e.type === 'taphold' && !window.isMobile.phone && !window.isMobile.tablet ) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();

            const selectedRows = document.querySelectorAll('.files-tab .row.selected');
            if ( selectedRows.length > 1 && el_item.classList.contains('selected') ) {
                const items = await _this.generateMultiSelectContextMenu(selectedRows);
                UIContextMenu({ items: items, position: { left: e.pageX, top: e.pageY } });
            } else {
                const items = await _this.generateContextMenuItems(el_item, file);
                UIContextMenu({ items: items, position: { left: e.pageX, top: e.pageY } });
            }
        });

        // Skip header row for drag-and-drop
        if ( el_item.classList.contains('header') ) return;

        $(el_item).draggable({
            appendTo: 'body',
            helper: 'clone',
            revert: 'invalid',
            zIndex: 10000,
            scroll: false,
            distance: 5,
            revertDuration: 100,

            start: function (_event, ui) {
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

                $(el_item).siblings('.row.selected')
                    .clone()
                    .addClass('item-selected-clone')
                    .css('position', 'absolute')
                    .appendTo('body')
                    .hide();

                const itemCount = $('.item-selected-clone').length;
                if ( itemCount > 0 ) {
                    $('body').append(`<span class="draggable-count-badge">${itemCount + 1}</span>`);
                }

                window.an_item_is_being_dragged = true;
                $('.window-app-iframe').css('pointer-events', 'none');
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

            stop: function (_event, _ui) {
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

                    const draggedPath = $(ui.draggable).attr('data-path');
                    if ( event.ctrlKey && draggedPath?.startsWith(`${window.trash_path}/`) ) {
                        return;
                    }

                    ui.helper.data('dropped', true);

                    const itemsToMove = [ui.draggable[0]];

                    $('.item-selected-clone').each(function () {
                        const sourceId = $(this).attr('data-id');
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

                    // Refresh directory
                    setTimeout(() => _this.renderDirectory(_this.selectedFolderUid), 100);
                },

                over: function (_event, ui) {
                    if ( $(ui.draggable).hasClass('row') ) {
                        $(el_item).addClass('selected');
                    }
                },

                out: function (_event, ui) {
                    if ( $(ui.draggable).hasClass('row') ) {
                        $(el_item).removeClass('selected');
                    }
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
     * Formats a byte count into a human-readable size string.
     *
     * @param {number} bytes - The size in bytes
     * @returns {string} Formatted size string (e.g., "1.5 MB")
     */
    formatFileSize (bytes) {
        if ( bytes === 0 ) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100 } ${ sizes[i]}`;
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
        if ( ! $footer.length ) return;

        const allRows = this.$el_window.find('.files-tab .row').toArray();
        const selectedRows = this.$el_window.find('.files-tab .row.selected').toArray();

        const totalCount = allRows.length;
        const selectedCount = selectedRows.length;

        const totalSize = this.calculateTotalSize(allRows);
        const selectedSize = this.calculateTotalSize(selectedRows);

        const itemText = totalCount === 1 ? 'item' : 'items';
        $footer.find('.files-footer-item-count').html(
                        `${totalCount} ${itemText} · ${window.byte_format(totalSize)}`);

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
    },

    /**
     * Toggles between list and grid view modes.
     *
     * Persists the preference to storage.
     *
     * @returns {void}
     */
    toggleView () {
        const $filesContainer = this.$el_window.find('.files-tab .files');
        const $toggleBtn = this.$el_window.find('.view-toggle-btn');
        const $tabContent = this.$el_window.find('.files-tab');

        if ( this.currentView === 'list' ) {
            this.currentView = 'grid';
            $filesContainer.removeClass('files-list-view').addClass('files-grid-view');
            $tabContent.addClass('files-grid-mode');
            $toggleBtn.html(icons.list);
            $toggleBtn.attr('title', 'Switch to list view');
        } else {
            this.currentView = 'list';
            $filesContainer.removeClass('files-grid-view').addClass('files-list-view');
            $tabContent.removeClass('files-grid-mode');
            $toggleBtn.html(icons.grid);
            $toggleBtn.attr('title', 'Switch to grid view');
        }

        puter.kv.set('view_mode', this.currentView);
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
     * Handles click on the "more" button (three dots) for a file row.
     *
     * Shows appropriate context menu for single or multi-selection.
     *
     * @param {HTMLElement} rowElement - The row element that was clicked
     * @param {Object} file - The file/folder object data
     * @returns {Promise<void>}
     */
    async handleMoreClick (rowElement, file) {
        const selectedRows = document.querySelectorAll('.files-tab .row.selected');

        if ( selectedRows.length > 1 && rowElement.classList.contains('selected') ) {
            const items = await this.generateMultiSelectContextMenu(selectedRows);
            UIContextMenu({ items: items });
        }
        else {
            const items = await this.generateContextMenuItems(rowElement, file);
            UIContextMenu({ items: items });
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

        const menu_items = await generate_file_context_menu({
            element: el_item,
            fsentry: options,
            is_trash: is_trash,
            is_trashed: is_trashed,
            suggested_apps: options.suggested_apps,
            associated_app_name: options.associated_app_name,
            onRestore: async (el) => {
                await _this.restoreItem(el);
            },
            onRefresh: () => {
                _this.renderDirectory(_this.selectedFolderUid);
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
                        } catch ( err ) {
                            console.error('Failed to restore item:', err);
                        }
                    }
                    _this.renderDirectory(_this.selectedFolderUid);
                },
            });
            items.push('-');
        }

        if ( ! anyTrashed ) {
            items.push({
                html: `${i18n('download')} (${selectedRows.length})`,
                onClick: function () {
                    window.zipItems(Array.from(selectedRows), _this.selectedFolderUid, true);
                },
            });
            items.push('-');
        }

        // Cut
        items.push({
            html: `${i18n('cut')} (${selectedRows.length})`,
            onClick: function () {
                window.clipboard_op = 'move';
                window.clipboard = [];
                selectedRows.forEach(row => {
                    window.clipboard.push($(row).attr('data-path'));
                });
            },
        });

        // Copy
        if ( ! anyTrashed ) {
            items.push({
                html: `${i18n('copy')} (${selectedRows.length})`,
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
                            { label: i18n('delete'), type: 'primary' },
                            { label: i18n('cancel') },
                        ],
                    });
                    if ( confirmed === 'Delete' ) {
                        for ( const row of selectedRows ) {
                            await window.delete_item(row);
                        }
                        setTimeout(() => {
                            _this.renderDirectory(_this.selectedFolderUid);
                        }, 500);
                    }
                },
            });
        }
        else {
            items.push({
                html: `${i18n('delete')} (${selectedRows.length})`,
                onClick: function () {
                    window.move_items(Array.from(selectedRows), window.trash_path);
                    setTimeout(() => {
                        _this.renderDirectory(_this.selectedFolderUid);
                    }, 500);
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
                    try {
                        const result = await puter.fs.mkdir({
                            path: `${targetPath}/New Folder`,
                            rename: true,
                            overwrite: false,
                        });
                        await _this.renderDirectory(_this.selectedFolderUid);
                        // Find and select the new folder, then activate rename
                        const newFolderRow = _this.$el_window.find(`.files-tab .row[data-name="${result.name}"]`);
                        if ( newFolderRow.length > 0 ) {
                            newFolderRow.addClass('selected');
                            window.activate_item_name_editor(newFolderRow[0]);
                        }
                    } catch ( err ) {
                        // Folder creation failed silently
                    }
                };

                // Override other file creation items to also refresh the directory
                for ( let i = 2; i < newMenuItems.items.length; i++ ) {
                    const item = newMenuItems.items[i];
                    if ( item && item.onClick && typeof item !== 'string' ) {
                        const originalItemOnClick = item.onClick;
                        item.onClick = async () => {
                            await originalItemOnClick();
                            setTimeout(() => {
                                _this.renderDirectory(_this.selectedFolderUid);
                            }, 500);
                        };
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
                onClick: function () {
                    if ( window.clipboard_op === 'copy' ) {
                        window.copy_clipboard_items(targetPath, null);
                    } else if ( window.clipboard_op === 'move' ) {
                        window.move_clipboard_items(null, targetPath);
                    }
                    setTimeout(() => {
                        _this.renderDirectory(_this.selectedFolderUid);
                    }, 500);
                },
            });
        }

        // Undo - if there are actions to undo
        if ( window.actions_history && window.actions_history.length > 0 ) {
            items.push({
                html: i18n('undo'),
                onClick: function () {
                    window.undo_last_action();
                    setTimeout(() => {
                        _this.renderDirectory(_this.selectedFolderUid);
                    }, 500);
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
                _this.renderDirectory(_this.selectedFolderUid);
            },
        });

        // Empty Trash - only in Trash folder
        if ( isTrashFolder ) {
            items.push('-');
            items.push({
                html: i18n('empty_trash'),
                onClick: function () {
                    window.empty_trash(() => {
                        _this.renderDirectory(_this.selectedFolderUid);
                    });
                },
            });
        }

        return items;
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
};

export default TabFiles;