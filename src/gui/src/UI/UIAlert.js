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

import UIWindow from './UIWindow.js'

function UIAlert(options){
    // set sensible defaults
    if(arguments.length > 0){
        // if first argument is a string, then assume it is the message
        if(window.isString(arguments[0])){
            options = {};
            options.message = arguments[0];
        }
        // if second argument is an array, then assume it is the buttons
        if(arguments[1] && Array.isArray(arguments[1])){
            options.buttons = arguments[1];
        }
    }

    return new Promise(async (resolve) => {
        // provide an 'OK' button if no buttons are provided
        if(!options.buttons || options.buttons.length === 0){
            options.buttons = [
                {label: i18n('ok'), value: true, type: 'primary'}
            ]
        }

        // set body icon
        options.body_icon = options.body_icon ?? window.icons['warning-sign.svg'];
        if(options.type === 'success')
            options.body_icon = window.icons['c-check.svg'];

        let santized_message = html_encode(options.message);

        // replace sanitized <strong> with <strong>
        santized_message = santized_message.replace(/&lt;strong&gt;/g, '<strong>');
        santized_message = santized_message.replace(/&lt;\/strong&gt;/g, '</strong>');

        // replace sanitized <p> with <p>
        santized_message = santized_message.replace(/&lt;p&gt;/g, '<p>');
        santized_message = santized_message.replace(/&lt;\/p&gt;/g, '</p>');

        let h = '';
        // icon
        h += `<img class="window-alert-icon" src="${html_encode(options.body_icon)}">`;
        // message
        h += `<div class="window-alert-message">${santized_message}</div>`;
        // buttons
        if(options.buttons && options.buttons.length > 0){
            h += `<div style="overflow:hidden; margin-top:20px;">`;
            for(let y=0; y<options.buttons.length; y++){
                h += `<button class="button button-block button-${html_encode(options.buttons[y].type)} alert-resp-button" 
                                data-label="${html_encode(options.buttons[y].label)}"
                                data-value="${html_encode(options.buttons[y].value ?? options.buttons[y].label)}"
                                ${options.buttons[y].type === 'primary' ? 'autofocus' : ''}
                                >${html_encode(options.buttons[y].label)}</button>`;
            }
            h += `</div>`;
        }

        const el_window = await UIWindow({
            title: null,
            icon: null,
            uid: null,
            is_dir: false,
            message: options.message,
            body_icon: options.body_icon,
            backdrop: options.backdrop ?? false,
            is_resizable: false,
            is_droppable: false,
            has_head: false,
            stay_on_top: options.stay_on_top ?? false,
            selectable_body: false,
            draggable_body: options.draggable_body ?? true,
            allow_context_menu: false,
            show_in_taskbar: false,
            window_class: 'window-alert',
            dominant: true,
            body_content: h,
            width: 350,
            parent_uuid: options.parent_uuid,
            ...options.window_options,
            window_css:{
                height: 'initial',
            },
            body_css: {
                width: 'initial',
                padding: '20px',
                'background-color': 'rgba(231, 238, 245, .95)',
                'backdrop-filter': 'blur(3px)',
            }
        });
        // focus to primary btn
        $(el_window).find('.button-primary').focus();

        // --------------------------------------------------------
        // Button pressed
        // --------------------------------------------------------
        $(el_window).find('.alert-resp-button').on('click',  async function(event){
            event.preventDefault(); 
            event.stopPropagation();
            resolve($(this).attr('data-value'));
            $(el_window).close();
            return false;
        })
    })
}

def(UIAlert, 'ui.window.UIAlert');

export default UIAlert;
