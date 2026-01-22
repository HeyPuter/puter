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

const folderIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
const documentIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';

const TabFiles = {
    id: 'files',
    label: 'Files',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',

    html () {
        let h = `
            <div class="dashboard-tab-content files-tab">
                <div class="directories">
                    <h2>Folders</h2>
                    <ul>
                        <li data-folder="Desktop">${folderIcon} <span>Desktop</span></li>
                        <li data-folder="Documents">${folderIcon} <span>Documents</span></li>
                        <li data-folder="Pictures">${folderIcon} <span>Pictures</span></li>
                        <li data-folder="Videos">${folderIcon} <span>Videos</span></li>
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
        // Files tab initialization logic can go here
        $el_window.find('[data-folder]').each(function () {
            this.onclick = () => {
                const folderName = this.getAttribute('data-folder');
                _this.renderDirectory($el_window, folderName);
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

    async renderDirectory ($el_window, folderName) {
        const directories = Object.keys(window.user.directories);
        const path = directories.find(f => f.endsWith(folderName));
        const directoryContents = await window.puter.fs.readdir({ uid: window.user.directories[path] });

        $('.files-tab .files').html('');

        $('.files-tab .files').html(`<div class="row header">
            <div class="icon"></div>
                <div class="name">File name</div>
                <div class="size">Size</div>
        </div>`);

        if ( directoryContents.length === 0 ) {
            $('.files-tab .files').append('<div class="row"><div class="icon"></div><div class="name">No files in this directory.</div><div class="size"></div>');
            return;
        }

        directoryContents.forEach(file => {
            let icon = '';
            if ( file.is_dir ) {
                icon = folderIcon;
            } else if ( file.thumbnail ) {
                icon = `<img src="${file.thumbnail}" alt="${file.name}" />`;
            } else {
                icon = documentIcon;
            }

            const formatFileSize = (bytes) => {
                if ( bytes === 0 ) return '0 B';
                const k = 1024;
                const sizes = ['B', 'KB', 'MB', 'GB'];
                const i = Math.floor(Math.log(bytes) / Math.log(k));
                return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100 } ${ sizes[i]}`;
            };

            const row = `<div class="row">
                <div class="icon">${icon}</div>
                <div class="name">${file.name}</div>
                ${file.is_dir ? '' : `<div class="size">${formatFileSize(file.size)}</div>`}
            </div>`;
            $('.files-tab .files').append(row);
        });

        $('.files-tab .files .row').each(function () {
            this.onclick = () => {
                if ( this.parentElement.querySelector('.header') === this ) {
                    return; // Do not select header row
                }
                this.parentElement.querySelectorAll('.row').forEach(row => {
                    row.classList.remove('selected');
                });
                this.classList.add('selected');
            };
        });
    },

};

export default TabFiles;