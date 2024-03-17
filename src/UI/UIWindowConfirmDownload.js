/**
 * Copyright (C) 2024 Puter Technologies Inc.
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

import UIWindow from './UIWindow.js'

// todo do this using uid rather than item_path, since item_path is way mroe expensive on the DB
async function UIWindowConfirmDownload(options){
    return new Promise(async (resolve) => {
        let h = '';
        h += `<div>`;
            // Confirm download
            h +=`<div style="margin-bottom:20px; float:left; padding-top:3px; font-size:15px; overflow: hidden; width: calc(100% - 40px); text-overflow: ellipsis; white-space: nowrap;">`;
                // Message
                h += `<p style="font-weight:bold;">Do you want to download this file?</p>`;
                h += `<div style="overflow:hidden; float:left; width: 100px; height: 100px; display:flex; display: flex; justify-content: center; align-items: center;">`;
                    h += `<img style="float:left; margin-right: 7px; width: 60px; height: 60px; filter: drop-shadow(0px 0px 1px rgba(102, 102, 102, 1));" src="${html_encode((await item_icon({is_dir: options.is_dir === '1' || options.is_dir === 'true', type: options.type, name: options.name})).image)}" />`;
                h += `</div>`;
                // Item information
                h += `<div  style="overflow:hidden;">`;
                    // Name
                    h += `<p style="text-overflow: ellipsis; overflow: hidden;"><span class="dl-conf-item-attr">${i18n('name')}:</span> ${options.name ?? options.url}</p>`;
                    // Type
                    h += `<p style="text-overflow: ellipsis; overflow: hidden;"><span class="dl-conf-item-attr">${i18n('type')}:</span> ${options.is_dir === '1' || options.is_dir === 'true' ? 'Folder' : options.type  ?? 'Unknown File Type'}</p>`;
                    // Source
                    h += `<p style="text-overflow: ellipsis; overflow: hidden;"><span class="dl-conf-item-attr">${i18n('from')}:</span> ${options.source}</p>`;
                h += `</div>`;
            h += `</div>`;
            // Download
            h += `<button style="float:right; margin-top: 15px; margin-right: -2px; margin-left:10px;" class="button button-small button-primary btn-download-confirm">${i18n('download')}</button>`;
            // Cancel
            h += `<button style="float:right; margin-top: 15px;" class="button button-small btn-download-cancel">${i18n('cancel')}</button>`;
        h +=`</div>`;

        const el_window = await UIWindow({
            title: `Upload`,
            icon: window.icons[`app-icon-uploader.svg`],
            uid: null,
            is_dir: false,
            body_content: h,
            has_head: false,
            selectable_body: false,
            draggable_body: true,
            allow_context_menu: false,
            is_resizable: false,
            is_droppable: false,
            init_center: true,
            allow_native_ctxmenu: false,
            allow_user_select: false,
            window_class: 'window-upload-progress',
            width: 450,
            dominant: true,
            window_css:{
                height: 'initial',
            },
            body_css: {
                padding: '22px',
                width: 'initial',
                'background-color': 'rgba(231, 238, 245, .95)',
                'backdrop-filter': 'blur(3px)',
            }    
        });

        $(el_window).find('.btn-download-confirm').on('click submit', function(e){
            $(el_window).close();
            resolve(true);
        })

        $(el_window).find('.btn-download-cancel').on('click submit', function(e){
            $(el_window).close();
            resolve(false);
        })
    })
}

export default UIWindowConfirmDownload