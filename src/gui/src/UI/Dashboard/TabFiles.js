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
import generate_file_context_menu from '../../helpers/generate_file_context_menu.js';
import truncate_filename from '../../helpers/truncate_filename.js';

const icons = {
    document: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`,
    files: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    folder: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`,
    more: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>`,
};

const TabFiles = {
    id: 'files',
    label: 'Files',
    icon: icons.files,

    html () {
        let h = `
            <div class="dashboard-tab-content files-tab">
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
                    <div class="path"></div>
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
        // Create click handler for each folder item
        $el_window.find('[data-folder]').each(function () {
            this.onclick = () => {
                const folderName = this.getAttribute('data-folder');
                const directories = Object.keys(window.user.directories);
                const path = directories.find(f => f.endsWith(folderName));
                _this.renderDirectory(window.user.directories[path]);
                _this.selectedFolderUid = window.user.directories[path];
                _this.selectFolder(this);
            };
        });
    },

    selectFolder ($folderElement) {
        $folderElement.parentElement.querySelectorAll('li').forEach(li => {
            li.classList.remove('active');
        });
        $folderElement.classList.add('active');
    },

    async renderDirectory (uid) {
        this.selectedFolderUid = uid;
        const _this = this;
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

        $('.path').html(this.renderPath(path || uid, window.user.username));
        $('.path .dirname').each(function () {
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
        const icon = file.is_dir ? icons.folder : (file.thumbnail ? `<img src="${file.thumbnail}" alt="${file.name}" />` : icons.document);
        const row = document.createElement("div");
        row.setAttribute('class', `row ${file.is_dir ? 'folder' : 'file'}`);
        row.setAttribute("data-id", file.id);
        row.setAttribute("data-name", file.name);
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
        row.setAttribute("data-metadata", "{}");
        row.setAttribute("data-sort_by", "");
        row.setAttribute("data-size", file.size);
        row.setAttribute("data-type", "");
        row.setAttribute("data-modified", file.modified);
        row.setAttribute("data-associated_app_name", "");
        row.setAttribute("data-path", file.path);
        row.innerHTML = `
            <div class="item-icon">${icon}</div>
            <pre class="item-name">${file.name}</pre>
            <textarea class="item-name-editor hide-scrollbar" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" data-gramm_editor="false">${file.name}</textarea>
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

        el_item.onclick = (e) => {
            if ( e.target.classList.contains('item-more') ) {
                this.handleMoreClick(el_item, file);
            }
            // Header row cannot be selected
            if ( el_item.parentElement.querySelector('.header') === this ) {
                return;
            }
            el_item.parentElement.querySelectorAll('.row').forEach(r => {
                r.classList.remove('selected');
            });
            el_item.classList.add('selected');
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
    },

    formatFileSize (bytes) {
        if ( bytes === 0 ) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100 } ${ sizes[i]}`;
    },

    async handleMoreClick (rowElement, file) {
        const items = await this.generateContextMenuItems(rowElement, file);
        UIContextMenu({
            items: items,
        });
    },

    async generateContextMenuItems (el_item, options) {
        const _this = this;

        const is_trash = $(el_item).attr('data-path') === window.trash_path || $(el_item).attr('data-shortcut_to_path') === window.trash_path;
        const is_trashed = ($(el_item).attr('data-path') || '').startsWith(`${window.trash_path }/`);

        // Use the shared helper to generate menu items
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

    renderPath (abs_path) {
        const { html_encode } = window;
        // remove trailing slash
        if ( abs_path.endsWith('/') && abs_path !== '/' )
        {
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