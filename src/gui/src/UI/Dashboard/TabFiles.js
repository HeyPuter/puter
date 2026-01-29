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
};

const { html_encode } = window;

const TabFiles = {
    id: 'files',
    label: 'Files',
    icon: icons.files,

    html () {
        let h = `
            <div class="dashboard-tab-content files-tab">
                <form>
                    <input type="file" name="file" id="upload-file-dialog" style="display: none;" multiple="multiple">
                </form>
                <div class="directories">
                    <ul>
                        <li data-folder="Desktop"><img src="${html_encode(window.icons['folder-desktop.svg'])}"/> <span>Desktop</span></li>
                        <li data-folder="Documents"><img src="${html_encode(window.icons['folder-documents.svg'])}"/> <span>Documents</span></li>
                        <li data-folder="Pictures"><img src="${html_encode(window.icons['folder-pictures.svg'])}"/> <span>Pictures</span></li>
                        <li data-folder="Public"><img src="${html_encode(window.icons['folder-public.svg'])}"/> <span>Public</span></li>
                        <li data-folder="Videos"><img src="${html_encode(window.icons['folder-videos.svg'])}"/> <span>Videos</span></li>
                        <li data-folder="Trash"><img src="${html_encode(window.icons['trash.svg'])}"/> <span>Trash</span></li>
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
                                <button class="path-action-btn view-toggle-btn" title="Toggle view"><img src="${icons.grid}/></button>
                                <button class="path-action-btn new-folder-btn" title="${i18n('new_folder')}">${icons.newFolder}</button>
                                <button class="path-action-btn upload-btn" title="${i18n('upload')}">${icons.upload}</button>
                            </div>
                        </div>
                        <div class="columns">
                            <div class="item-icon"></div>
                            <div class="item-name">File name</div>
                            <div class="item-size">Size</div>
                            <div class="item-modified">Modified</div>
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

    async init ($el_window) {
        const _this = this;
        this.activeMenuFileUid = null;
        this.selectedFolderUid = null;
        this.currentPath = null;
        this.currentView = await puter.kv.get('view_mode') || 'list';

        // Create click handler for each folder item
        $el_window.find('[data-folder]').each(function () {
            const folderElement = this;

            folderElement.onclick = async () => {
                const folderName = folderElement.getAttribute('data-folder');
                const directories = await puter.fs.readdir(`/${window.user.username}`);
                const folderPath = directories.find(f => f.is_dir && f.name === folderName).path;
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

        this.createHeaderEventListeners($el_window);

        // Store reference to $el_window for later use
        this.$el_window = $el_window;

        // Apply initial view
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
    },

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
    },

    selectFolder ($folderElement) {
        $folderElement.parentElement.querySelectorAll('li').forEach(li => {
            li.classList.remove('active');
        });
        $folderElement.classList.add('active');
    },

    updateSidebarSelection () {
        // Clear all sidebar selections first
        this.$el_window.find('.directories li').removeClass('active');

        // Check if current path matches any sidebar folder
        const currentPath = this.currentPath;
        if ( ! currentPath ) return;

        // Find matching sidebar folder
        this.$el_window.find('[data-folder]').each(function () {
            const folderName = this.getAttribute('data-folder');
            const directories = Object.keys(window.user.directories);
            const folderPath = directories.find(f => f.endsWith(folderName));

            if ( folderPath === currentPath ) {
                this.classList.add('active');
            }
        });
    },

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
            // Show New Folder and Upload buttons, hide Empty Trash button
            $pathActions.find('.new-folder-btn, .upload-btn').show();
            $pathActions.find('.empty-trash-btn').hide();
        }
    },

    async renderDirectory (uid) {
        this.selectedFolderUid = uid;
        const _this = this;

        // Clear previous selections
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

        // Store current path for new folder/upload actions
        this.currentPath = path || uid;

        // Update sidebar selection based on current path
        this.updateSidebarSelection();

        // Update action buttons based on whether we're in the trash folder
        const isTrashFolder = this.currentPath === window.trash_path;
        this.updateActionButtons(isTrashFolder);

        $('.path-breadcrumbs').html(this.renderPath(this.currentPath, window.user.username));
        $('.path-breadcrumbs .dirname').each(function () {
            this.onclick = () => {
                const clickedPath = this.getAttribute("data-path");
                _this.pushNavHistory(clickedPath);
                _this.renderDirectory(clickedPath);
            };
        });

        // Clear the container
        $('.files-tab .files').html('');

        // If directory has no files, tell about it
        if ( directoryContents.length === 0 ) {
            $('.files-tab .files').append(`<div class="row">
                <div class="item-icon"></div>
                <div class="item-name">No files in this directory.</div>
                <div class="item-size"></div>
                <div class="item-modified"></div>
                <div class="item-more"></div>
            `);
            this.updateFooterStats();
            this.updateNavButtonStates();
            return;
        }

        // Sort contents folders first, then render each row
        directoryContents.sort((a, b) => b.is_dir - a.is_dir).forEach(file => {
            this.renderItem(file);
        });

        // Update footer with directory stats
        this.updateFooterStats();

        // Update nav button states
        this.updateNavButtonStates();
    },

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
            <pre class="item-name">${displayName}</pre>
            <textarea class="item-name-editor hide-scrollbar" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" data-gramm_editor="false">${displayName}</textarea>
            ${file.is_dir ? '<div class="item-size"></div>' : `<div class="item-size">${this.formatFileSize(file.size)}</div>`}
            <div class="item-modified">${window.timeago.format(file.modified * 1000)}</div>
            <div class="item-more">${icons.more}</div>
        `;
        $('.files-tab .files').append(row);

        this.createItemListeners(row, file);
    },

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

    formatFileSize (bytes) {
        if ( bytes === 0 ) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100 } ${ sizes[i]}`;
    },

    calculateTotalSize (rows) {
        let total = 0;
        rows.forEach(row => {
            const size = parseInt($(row).attr('data-size')) || 0;
            total += size;
        });
        return total;
    },

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

    initNavHistory (initialPath) {
        window.dashboard_nav_history = [initialPath];
        window.dashboard_nav_history_current_position = 0;
        this.updateNavButtonStates();
    },

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
            onRefresh: () => {
                setTimeout(() => {
                    _this.renderDirectory(_this.selectedFolderUid);
                }, 0);
            },
        });

        return menu_items;
    },

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
                onClick: function () {
                    selectedRows.forEach(row => {
                        const metadata = JSON.parse($(row).attr('data-metadata') || '{}');
                        if ( metadata.original_path ) {
                            const dirname = metadata.original_path.substring(0, metadata.original_path.lastIndexOf('/'));
                            window.move_items([row], dirname);
                            setTimeout(() => {
                                _this.renderDirectory(_this.selectedFolderUid);
                            }, 500);
                        }
                    });
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