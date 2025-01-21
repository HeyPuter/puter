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

async function UIWindowRequestPermission(options){
    options = options ?? {};
    options.reload_on_success = options.reload_on_success ?? false;
    return new Promise(async (resolve) => {
        let drivers = [
            {
                name: 'puter-chat-completion',
                human_name: 'AI Chat Completion',
                description: 'This app wants to generate text using AI. This may incur costs on your behalf.',
            },
            {
                name: 'puter-image-generation',
                human_name: 'AI Image Generation',
                description: 'This app wants to generate images using AI. This may incur costs on your behalf.',
            },
            {
                name: 'puter-kvstore',
                human_name: 'Puter Storage',
                description: 'This app wants to securely store data in your Puter account. This app will not be able to access your personal data or data stored by other apps.',
            }

        ]

        let parts = options.permission.split(":");
        let driver_name = parts[1];
        let action_name = parts[2];
        
        function findDriverByName(driverName) {
            return drivers.find(driver => driver.name === driverName);
        }
        
        let driver = findDriverByName(driver_name);

        if(driver === undefined){
            resolve(false);
            return;
        }

        let h = ``;
        h += `<div>`;
            h += `<div style="padding: 20px; width: 100%; box-sizing: border-box;">`;
                // title
                h += `<h1 class="perm-title">"<span style="word-break: break-word;">${html_encode(options.app_uid ?? options.origin)}</span>" would Like to use ${html_encode(driver.human_name)}</h1>`;
                // todo show the real description of action
                h += `<p class="perm-description">${html_encode(driver.description)}</p>`;
                // Allow/Don't Allow
                h += `<button type="button" class="app-auth-allow button button-primary button-block" style="margin-top: 10px;">${i18n('allow')}</button>`;
                h += `<button type="button" class="app-auth-dont-allow button button-default button-block" style="margin-top: 10px;">${i18n('dont_allow')}</button>`;
            h += `</div>`;
        h += `</div>`;
        
        const el_window = await UIWindow({
            title: null,
            app: 'request-authorization',
            single_instance: true,
            icon: null,
            uid: null,
            is_dir: false,
            body_content: h,
            has_head: true,
            selectable_body: false,
            draggable_body: true,
            allow_context_menu: false,
            is_draggable: true,
            is_droppable: false,
            is_resizable: false,
            stay_on_top: false,
            allow_native_ctxmenu: true,
            allow_user_select: true,
            ...options.window_options,
            width: 350,
            dominant: true,
            on_close: ()=>{
                resolve(false)
            },
            onAppend: function(this_window){
            },
            window_class: 'window-login',
            window_css:{
                height: 'initial',
            },
            body_css: {
                width: 'initial',
                padding: '0',
                'background-color': 'rgba(231, 238, 245, .95)',
                'backdrop-filter': 'blur(3px)',
            }
        })

        $(el_window).find('.app-auth-allow').on('click', async function(e){
            $(this).addClass('disabled');

            try{
                const res = await fetch( window.api_origin + "/auth/grant-user-app", {
                    "headers": {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + window.auth_token,
                    },
                    "body": JSON.stringify({
                        app_uid: options.app_uid,
                        origin: options.origin,
                        permission: options.permission 
                    }),
                    "method": "POST",
                });
            }catch(err){
                console.error(err);
                resolve(err);
            }

            resolve(true);
        })  

        $(el_window).find('.app-auth-dont-allow').on('click', function(e){
            $(this).addClass('disabled');
            $(el_window).close();
            resolve(false);
        })
    }) 
}

export default UIWindowRequestPermission