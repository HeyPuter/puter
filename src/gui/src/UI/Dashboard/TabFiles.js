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
import open_item from '../../helpers/open_item.js';
import UIContextMenu from '../UIContextMenu.js';
import UIAlert from '../UIAlert.js';
import generate_file_context_menu from '../../helpers/generate_file_context_menu.js';
import truncate_filename from '../../helpers/truncate_filename.js';

const icons = {
    document: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`,
    files: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    folder: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`,
    more: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>`,
    newFolder: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="11" x2="12" y2="17"></line><line x1="9" y1="14" x2="15" y2="14"></line></svg>`,
    upload: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>`,
    trash: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
};

const TabFiles = {
    id: 'files',
    label: 'Files',
    icon: icons.files,

    html () {
        let h = `
            <div class="dashboard-tab-content files-tab">
                <form name="upload-form" id="upload-form" style="display:hidden;">
                    <input type="hidden" name="name" id="upload-filename" value="">
                    <input type="hidden" name="path" id="upload-target-path" value="">
                    <input type="file" name="file" id="upload-file-dialog" style="display: none;" multiple="multiple">
                </form>
                <div class="directories">
                    <ul>
                        <li data-folder="Desktop">${icons.folder} <span>Desktop</span></li>
                        <li data-folder="Documents">${icons.folder} <span>Documents</span></li>
                        <li data-folder="Pictures">${icons.folder} <span>Pictures</span></li>
                        <li data-folder="Videos">${icons.folder} <span>Videos</span></li>
                        <li data-folder="Trash">${icons.folder} <span>Trash</span></li>
                    </ul>
                </div>
                <div class="directory-contents">
                    <div class="path">
                        <div class="path-breadcrumbs"></div>
                        <div class="path-actions">
                            <button class="path-action-btn new-folder-btn" title="${i18n('new_folder')}">${icons.newFolder}</button>
                            <button class="path-action-btn upload-btn" title="${i18n('upload')}">${icons.upload}</button>
                        </div>
                    </div>
                    <div class="files"></div>
                </div>
            </div>
        `;
        return h;
    },

    init ($el_window) {
        const _this = this;
        this.activeMenuFileUid = null;
        this.selectedFolderUid = null;
        this.currentPath = null;
        // Create click handler for each folder item
        $el_window.find('[data-folder]').each(function () {
            const folderElement = this;

            folderElement.onclick = () => {
                const folderName = folderElement.getAttribute('data-folder');
                const directories = Object.keys(window.user.directories);
                const path = directories.find(f => f.endsWith(folderName));
                _this.renderDirectory(window.user.directories[path]);
                _this.selectedFolderUid = window.user.directories[path];
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
        $el_window.find('.dashboard-tab-content').on('click', function (e) {
            if ( e.target === this || e.target.classList.contains('files') ) {
                document.querySelectorAll('.files-tab .row.selected').forEach(r => {
                    r.classList.remove('selected');
                });
            }
        });

        // New folder button
        $el_window.find('.new-folder-btn').on('click', async () => {
            if ( ! _this.currentPath ) return;
            try {
                const result = await puter.fs.mkdir({
                    path: `${_this.currentPath}/New Folder`,
                    rename: true,
                    overwrite: false,
                });
                await _this.renderDirectory(_this.selectedFolderUid);
                // Find and select the new folder, then activate rename
                const newFolderRow = $el_window.find(`.files-tab .row[data-name="${result.name}"]`);
                if ( newFolderRow.length > 0 ) {
                    newFolderRow.addClass('selected');
                    window.activate_item_name_editor(newFolderRow[0]);
                }
            } catch ( err ) {
                // Folder creation failed silently
            }
        });

        // Upload button
        $el_window.find('.upload-btn').on('click', async () => {
            console.log(_this.currentPath);
            if ( ! _this.currentPath ) return;
            const filesContainer = $el_window.find('.files-tab .files')[0];
            window.init_upload_using_dialog(filesContainer, `${_this.currentPath}/`);
            // _this.renderDirectory(_this.selectedFolderUid)
        });

        // Store reference to $el_window for later use
        this.$el_window = $el_window;
    },

    selectFolder ($folderElement) {
        $folderElement.parentElement.querySelectorAll('li').forEach(li => {
            li.classList.remove('active');
        });
        $folderElement.classList.add('active');
    },

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

        // Update action buttons based on whether we're in the trash folder
        const isTrashFolder = this.currentPath === window.trash_path;
        this.updateActionButtons(isTrashFolder);

        $('.path-breadcrumbs').html(this.renderPath(this.currentPath, window.user.username));
        $('.path-breadcrumbs .dirname').each(function () {
            this.onclick = () => {
                _this.renderDirectory(this.getAttribute("data-path"));
            };
        });

        // Clear the container
        $('.files-tab .files').html('');

        // Add header row
        $('.files-tab .files').html(`<div class="row header">
            <div class="item-icon"></div>
            <div class="item-name">File name</div>
            <div class="item-size">Size</div>
            <div class="item-modified">Modified</div>
            <div class="item-more"></div>
        </div>`);

        // If directory has no files, tell about it
        if ( directoryContents.length === 0 ) {
            $('.files-tab .files').append(`<div class="row">
                <div class="item-icon"></div>
                <div class="item-name">No files in this directory.</div>
                <div class="item-size"></div>
                <div class="item-modified"></div>
                <div class="item-more"></div>
            `);
            return;
        }

        // Sort contents folders first, then render each row
        directoryContents.sort((a, b) => b.is_dir - a.is_dir).forEach(file => {
            this.renderItem(file);
        });
    },

    renderItem (file) {
        // For trashed items, use original_name from metadata if available
        const metadata = JSON.parse(file.metadata) || {};
        const displayName = metadata.original_name || file.name;

        const icon = file.is_dir ? icons.folder : (file.thumbnail ? `<img src="${file.thumbnail}" alt="${displayName}" />` : icons.document);
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

    createItemListeners (el_item, file) {
        const el_item_name = el_item.querySelector(`.item-name`);
        const el_item_icon = el_item.querySelector('.item-icon');
        const el_item_name_editor = el_item.querySelector(`.item-name-editor`);
        const isFolder = el_item.getAttribute('data-is_dir');
        let website_url = window.determine_website_url(file.path);
        let rename_cancelled = false;

        el_item.onpointerdown = (e) => {
            if ( e.target.classList.contains('item-more') ) return;
            if ( el_item.classList.contains('header') ) return;

            if ( e.which === 3 && el_item.classList.contains('selected') &&
                el_item.parentElement.querySelectorAll('.row.selected').length > 1 ) {
                return;
            }

            if ( !e.ctrlKey && !e.metaKey && !el_item.classList.contains('selected') ) {
                el_item.parentElement.querySelectorAll('.row.selected').forEach(r => {
                    r.classList.remove('selected');
                });
            }

            if ( (e.ctrlKey || e.metaKey) && el_item.classList.contains('selected') ) {
                el_item.classList.remove('selected');
            } else {
                el_item.classList.add('selected');
                window.latest_selected_item = el_item;
            }

            window.active_element = el_item;
            window.active_item_container = el_item.closest('.files');
        };

        el_item.onclick = (e) => {
            if ( e.target.classList.contains('item-more') ) {
                this.handleMoreClick(el_item, file);
                return;
            }
            if ( el_item.classList.contains('header') ) return;

            if ( !e.ctrlKey && !e.metaKey ) {
                el_item.parentElement.querySelectorAll('.row.selected').forEach(r => {
                    if ( r !== el_item ) r.classList.remove('selected');
                });
            }
        };

        el_item.ondblclick = () => {
            // if ( el_item.classList.contains('selected') ) {
            //     window.activate_item_name_editor(el_item);
            //     return;
            // }
            if ( isFolder === "1" ) {
                this.renderDirectory(file.path);
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
                $(el_item_name_editor).val(options.name);
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
                        }
                    });
                },
            });
            items.push('-');
        }

        if ( ! anyTrashed ) {
            items.push({
                html: i18n('download'),
                onClick: function () {
                    window.zipItems(Array.from(selectedRows), _this.selectedFolderUid, true);
                },
            });
            items.push('-');
        }

        // Cut
        items.push({
            html: i18n('cut'),
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
                html: i18n('copy'),
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
                        _this.renderDirectory(_this.selectedFolderUid);
                    }
                },
            });
        }
        else {
            items.push({
                html: i18n('delete'),
                onClick: function () {
                    window.move_items(Array.from(selectedRows), window.trash_path);
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