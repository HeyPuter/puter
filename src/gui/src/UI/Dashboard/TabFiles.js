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
            const icon = file.is_dir ? icons.folder : (file.thumbnail ? `<img src="${file.thumbnail}" alt="${file.name}" />` : icons.document);
            const rowAttributes = `data-id="${file.id}" data-name="${file.name}" data-metadata="{}" data-uid="${file.uid}" data-is_dir="${file.is_dir}" data-is_trash="0" data-has_website="0" data-website_url="" data-immutable="${file.immutable}" data-is_shortcut="${file.is_shortcut}" data-shortcut_to="" data-shortcut_to_path="" data-sortable="true" data-sort_by="" data-size="${file.size}" data-type="" data-modified="${file.modified}" data-associated_app_name="" data-path="${file.path}"`;
            const row = `
                <div class="row ${file.is_dir ? 'folder' : 'file'}" ${rowAttributes}>
                    <div class="icon">${icon}</div>
                    <div class="name">${file.name}</div>
                    ${file.is_dir ? '<div class="size"></div>' : `<div class="size">${this.formatFileSize(file.size)}</div>`}
                    <div class="date">${window.timeago.format(file.modified * 1000)}</div>
                    <div class="more">${icons.more}</div>
                </div>
            `;
            $('.files-tab .files').append(row);
        });

        // Create click handlers
        $('.files-tab .files .row').each(function () {
            const _row = this;
            this.onclick = (e) => {
                if ( e.target.classList.contains('more') ) {
                    _this.handleMoreClick(this);
                }
                if ( this.classList.contains('selected') ) {
                    return;
                }
                if ( this.parentElement.querySelector('.header') === this ) {
                    return; // Do not select header row
                }
                this.parentElement.querySelectorAll('.row').forEach(row => {
                    row.classList.remove('selected');
                });
                this.classList.add('selected');
            };
            this.ondblclick = () => {
                const isFolder = _row.getAttribute('data-is_dir');
                if ( isFolder === "true" ) {
                    console.log('open folder');
                    _this.renderDirectory(_row.getAttribute('data-path'), _row.getAttribute('data-uid'));
                } else {
                    console.log('open file');
                    open_item({ item: _row });
                }
                this.classList.remove('selected');
            };
        });
    },

    formatFileSize (bytes) {
        if ( bytes === 0 ) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100 } ${ sizes[i]}`;
    },

    handleMoreClick (rowElement) {
        const _this = this;
        UIContextMenu({
            items: [
                {
                    html: i18n('open'),
                    action: () => {
                        open_item({ item: rowElement });
                    },
                },
                {
                    html: i18n('open_with'),
                    action: () => {

                    },
                },
                '-',
                {
                    html: i18n('Share With…'),
                    action: () => {

                    },
                },
                {
                    html: i18n('open_in_ai'),
                    action: () => {

                    },
                },
                {
                    html: i18n('download'),
                    action: () => {

                    },
                },
                {
                    html: i18n('zip'),
                    action: () => {

                    },
                },
                {
                    html: i18n('tar'),
                    action: () => {

                    },
                },
                '-',
                {
                    html: i18n('cut'),
                    action: () => {

                    },
                },
                {
                    html: i18n('copy'),
                    action: () => {

                    },
                },
                '-',
                {
                    html: i18n('create_shortcut'),
                    action: () => {

                    },
                },
                {
                    html: i18n('delete'),
                    action: async () => {
                        console.log(_this.selectedFolderUid);
                        await window.move_items([rowElement], window.trash_path);
                        setTimeout(() => {
                            _this.renderDirectory(this.selectedFolderUid);
                        }, 0);
                    },
                },
                {
                    html: i18n('rename'),
                    action: () => {

                    },
                },
                '-',
                {
                    html: i18n('properties'),
                    action: () => {

                    },
                },
            ],
        });
    },

};

export default TabFiles;