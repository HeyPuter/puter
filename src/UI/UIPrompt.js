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

function UIPrompt(options){
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
                {label: i18n('cancel'), value: false, type: 'default'},
                {label: i18n('ok'), value: true, type: 'primary'},
            ]
        }

        let h = '';
        // message
        h += `<div class="window-prompt-message">${options.message}</div>`;
        // prompt
        h += `<div class="window-alert-prompt" style="margin-top: 20px;">`;
            h += `<input type="text" class="prompt-input" placeholder="${options.placeholder ?? ''}" value="${options.value ?? ''}">`;
        h += `</div>`;
        // buttons
        if(options.buttons && options.buttons.length > 0){
            h += `<div style="overflow:hidden; margin-top:20px; float:right;">`;
                h += `<button class="button button-default prompt-resp-button prompt-resp-btn-cancel" data-label="${i18n('cancel')}" style="padding: 0 20px;">${i18n('cancel')}</button>`;
                h += `<button class="button button-primary prompt-resp-button prompt-resp-btn-ok" data-label="${i18n('ok')}" data-value="true" autofocus>${i18n('ok')}</button>`;
            h += `</div>`;
        }

        const el_window = await UIWindow({
            title: null,
            icon: null,
            uid: null,
            is_dir: false,
            message: options.message,
            backdrop: options.backdrop ?? false,
            is_resizable: false,
            is_droppable: false,
            has_head: false,
            stay_on_top: options.stay_on_top ?? false,
            selectable_body: false,
            draggable_body: true,
            allow_context_menu: false,
            show_in_taskbar: false,
            window_class: 'window-alert',
            dominant: true,
            body_content: h,
            width: 450,
            parent_uuid: options.parent_uuid,
            onAppend: function(this_window){
                setTimeout(function(){
                    $(this_window).find('.prompt-input').get(0).focus({preventScroll:true});
                }, 30);
            },
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
        $(el_window).find('.prompt-resp-button').on('click',  async function(event){
            event.preventDefault(); 
            event.stopPropagation();
            if($(this).attr('data-value') === 'true'){
                resolve($(el_window).find('.prompt-input').val());
            }else{
                resolve(false);
            }
            $(el_window).close();
            return false;
        })

        $(el_window).find('.prompt-input').on('keyup', async function(e){
            if(e.keyCode === 13){
                $(el_window).find('.prompt-resp-btn-ok').click();
            }
        })
    })
}

export default UIPrompt;