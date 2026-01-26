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
import launch_app from '../../helpers/launch_app.js';
import UIAlert from '../UIAlert.js';
import UIContextMenu from '../UIContextMenu.js';
import path from '../../lib/path.js';

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
                    <h2>Folders</h2>
                    <ul>
                        <li data-folder="Desktop">${icons.folder} <span>Desktop</span></li>
                        <li data-folder="Documents">${icons.folder} <span>Documents</span></li>
                        <li data-folder="Pictures">${icons.folder} <span>Pictures</span></li>
                        <li data-folder="Videos">${icons.folder} <span>Videos</span></li>
                        <li data-folder="Trash">${icons.folder} <span>Trash</span></li>
                    </ul>
                </div>
                <div class="directory-contents">
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
        const _this = this;
        const directoryContents = await window.puter.fs.readdir({ uid });
        if ( ! directoryContents ) {
            return;
        }

        // Clear the container
        $('.files-tab .files').html('');

        // Add header row
        $('.files-tab .files').html(`<div class="row header">
            <div class="icon"></div>
                <div class="name">File name</div>
                <div class="size">Size</div>
                <div class="date">Modified</div>
                <div class="more"></div>
            </div>`);

        // If directory has no files, tell about it
        if ( directoryContents.length === 0 ) {
            $('.files-tab .files').append(`<div class="row">
                <div class="icon"></div>
                <div class="name">No files in this directory.</div>
                <div class="size"></div>
                <div class="date"></div>
                <div class="more"></div>
            `);
            return;
        }

        // Sort contents folders first, then render each row
        directoryContents.sort((a, b) => b.is_dir - a.is_dir).forEach(file => {
            console.log(file);
            this.renderItem(file);
        });
    },

    renderItem (file) {
        const _this = this;
        const icon = file.is_dir ? icons.folder : (file.thumbnail ? `<img src="${file.thumbnail}" alt="${file.name}" />` : icons.document);
        const row = document.createElement("div");
        row.setAttribute('class', `row ${file.is_dir ? 'folder' : 'file'}`);
        row.setAttribute("data-id", file.id);
        row.setAttribute("data-name", file.name);
        row.setAttribute("data-uid", file.uid);
        row.setAttribute("data-is_dir", file.is_dir);
        row.setAttribute("data-is_trash", 0);
        row.setAttribute("data-has_website", 0);
        row.setAttribute("data-website_url", "");
        row.setAttribute("data-immutable", file.immutable);
        row.setAttribute("data-is_shortcut", file.is_shortcut);
        row.setAttribute("data-shortcut_to", "");
        row.setAttribute("data-shortcut_to_path", "");
        row.setAttribute("data-sortable", "true");
        row.setAttribute("data-metadata", "{}");
        row.setAttribute("data-sort_by", "");
        row.setAttribute("data-size", file.size);
        row.setAttribute("data-type", "");
        row.setAttribute("data-modified", file.modified);
        row.setAttribute("data-associated_app_name", "");
        row.setAttribute("data-path", file.path);
        row.innerHTML = `
            <div class="icon">${icon}</div>
            <div class="name">${file.name}</div>
            ${file.is_dir ? '<div class="size"></div>' : `<div class="size">${this.formatFileSize(file.size)}</div>`}
            <div class="date">${window.timeago.format(file.modified * 1000)}</div>
            <div class="more">${icons.more}</div>
        `;
        $('.files-tab .files').append(row);

        // Create event listeners
        row.onclick = (e) => {
            if ( e.target.classList.contains('more') ) {
                _this.handleMoreClick(row, file);
            }
            if ( row.classList.contains('selected') ) {
                return;
            }
            if ( row.parentElement.querySelector('.header') === this ) {
                return; // Do not select header row
            }
            row.parentElement.querySelectorAll('.row').forEach(r => {
                r.classList.remove('selected');
            });
            row.classList.add('selected');
        };
        row.ondblclick = () => {
            const isFolder = row.getAttribute('data-is_dir');
            if ( isFolder === "true" ) {
                _this.renderDirectory(row.getAttribute('data-path'), row.getAttribute('data-uid'));
            } else {
                open_item({ item: row });
            }
            row.classList.remove('selected');
        };
    },

    formatFileSize (bytes) {
        if ( bytes === 0 ) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100 } ${ sizes[i]}`;
    },

    async handleMoreClick (rowElement, file) {
        const items = await this.generateItems(rowElement, file);

        UIContextMenu({
            items: items,
        });
    },

    async generateItems (el_item, options) {
        const _this = this;
        let menu_items = [];

        const fileUid = el_item.getAttribute("data-uid");
        const is_trash = $(el_item).attr('data-path') === window.trash_path || $(el_item).attr('data-shortcut_to_path') === window.trash_path;
        const is_trashed = ($(el_item).attr('data-path') || '').startsWith(`${window.trash_path }/`);

        // Open
        menu_items.push({
            html: i18n('open'),
            action: () => {
                open_item({ item: el_item });
            },
        });

        // Open With
        if ( !is_trashed && !is_trash && (options.associated_app_name === null || options.associated_app_name === undefined) ) {
            let items = [];
            if ( !options.suggested_apps || options.suggested_apps.length === 0 ) {
                // try to find suitable apps
                const suitable_apps = await window.suggest_apps_for_fsentry({
                    uid: options.uid,
                    path: options.path,
                });
                if ( suitable_apps && suitable_apps.length > 0 ) {
                    options.suggested_apps = suitable_apps;
                }
            }

            if ( options.suggested_apps && options.suggested_apps.length > 0 ) {
                console.log('found suggested apps', options.suggested_apps);
                for ( let index = 0; index < options.suggested_apps.length; index++ ) {
                    const suggested_app = options.suggested_apps[index];
                    if ( ! suggested_app ) {
                        console.warn('suggested_app is null', options.suggested_apps, index);
                        continue;
                    }
                    console.log('suggested app', suggested_app);
                    items.push({
                        html: suggested_app.title,
                        icon: `<img src="${html_encode(suggested_app.icon ?? window.icons['app.svg'])}" style="width:16px; height: 16px; margin-bottom: -4px;">`,
                        onClick: async function () {
                            var extension = path.extname($(el_item).attr('data-path')).toLowerCase();
                            if (
                                window.user_preferences[`default_apps${extension}`] !== suggested_app.name
                                &&
                                (
                                    (!window.user_preferences[`default_apps${extension}`] && index > 0)
                                    ||
                                    (window.user_preferences[`default_apps${extension}`])
                                )
                            ) {
                                const alert_resp = await UIAlert({
                                    message: `${i18n('change_always_open_with')} ${ html_encode(suggested_app.title) }?`,
                                    body_icon: suggested_app.icon,
                                    buttons: [
                                        {
                                            label: i18n('yes'),
                                            type: 'primary',
                                            value: 'yes',
                                        },
                                        {
                                            label: i18n('no'),
                                        },
                                    ],
                                });
                                if ( (alert_resp) === 'yes' ) {
                                    window.user_preferences[`default_apps${ extension}`] = suggested_app.name;
                                    window.mutate_user_preferences(window.user_preferences);
                                }
                            }
                            launch_app({
                                name: suggested_app.name,
                                file_path: $(el_item).attr('data-path'),
                                window_title: $(el_item).attr('data-name'),
                                file_uid: $(el_item).attr('data-uid'),
                            });
                        },
                    });
                }
            } else {
                items.push({
                    html: i18n('no_suitable_apps_found'),
                    disabled: true,
                });
            }
            // add all suitable apps
            menu_items.push({
                html: i18n('open_with'),
                items: items,
            });
        }

        menu_items.push('-');

        // Share with
        menu_items.push({
            html: i18n('Share With…'),
            action: () => {

            },
        });

        // Open in AI
        menu_items.push({
            html: i18n('open_in_ai'),
            action: () => {

            },
        });

        // Download
        menu_items.push({
            html: i18n('download'),
            action: () => {

            },
        });

        // Zip
        menu_items.push({
            html: i18n('zip'),
            action: () => {

            },
        });

        // Tar
        menu_items.push({
            html: i18n('tar'),
            action: () => {

            },
        });

        menu_items.push('-');

        // Cut
        menu_items.push({
            html: i18n('cut'),
            action: () => {

            },
        });

        // Copy
        menu_items.push({
            html: i18n('copy'),
            action: () => {

            },
        });

        menu_items.push('-');

        // Create Shortcut
        menu_items.push({
            html: i18n('create_shortcut'),
            action: () => {

            },
        });

        menu_items.push('-');

        // Delete
        menu_items.push({
            html: i18n('delete'),
            action: async () => {
                await window.move_items([el_item], window.trash_path);
                setTimeout(() => {
                    _this.renderDirectory(this.selectedFolderUid);
                }, 0);
            },
        });

        // Rename
        menu_items.push({
            html: i18n('rename'),
            action: () => {

            },
        });

        menu_items.push('-');

        // Properties
        menu_items.push({
            html: i18n('properties'),
            action: () => {

            },
        });

        return menu_items;
    },

};

export default TabFiles;