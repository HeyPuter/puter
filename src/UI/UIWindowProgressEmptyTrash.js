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
async function UIWindowProgressEmptyTrash(options){
    let h = '';
    h += `<div data-newfolder-operation-id="${options.operation_id}">`;
        h += `<div>`;
            // spinner
            h +=`<svg style="float:left; margin-right: 7px;" xmlns="http://www.w3.org/2000/svg" height="24" width="24" viewBox="0 0 24 24"><title>circle anim</title><g fill="#212121" class="nc-icon-wrapper"><g class="nc-loop-circle-24-icon-f"><path d="M12 24a12 12 0 1 1 12-12 12.013 12.013 0 0 1-12 12zm0-22a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2z" fill="#212121" opacity=".4"></path><path d="M24 12h-2A10.011 10.011 0 0 0 12 2V0a12.013 12.013 0 0 1 12 12z" data-color="color-2"></path></g><style>.nc-loop-circle-24-icon-f{--animation-duration:0.5s;transform-origin:12px 12px;animation:nc-loop-circle-anim var(--animation-duration) infinite linear}@keyframes nc-loop-circle-anim{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}</style></g></svg>`;
            // message
            h +=`<div style="margin-bottom:20px; float:left; padding-top:3px; font-size:15px; overflow: hidden; width: calc(100% - 40px); text-overflow: ellipsis; white-space: nowrap;">`;
                // text
                h += `<span class="newfolder-progress-msg">${i18n('emptying_trash')}</span>`;
            h += `</div>`;
        h +=`</div>`;
    h += `</div>`;

    const el_window = await UIWindow({
        title: i18n('emptying_trash'),
        icon: window.icons[`app-icon-newfolder.svg`],
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
        window_class: 'window-newfolder-progress',
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

    $(el_window).find('.newfolder-cancel-btn').on('click', function(e){
        operation_cancelled[options.operation_id] = true;
        $(el_window).close();
    })

    return el_window;
}

export default UIWindowProgressEmptyTrash