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

async function UIWindowSelfhostedWaitlist(options){
    options = options ?? {};
    options.reload_on_success = options.reload_on_success ?? false;

    return new Promise(async (resolve) => {
        getItem({
            key: "joined_selfhosted_waitlist",
            success: async function(resp){
                if(resp.value){
                    $(el_window).find('.join-waitlist-btn').hide();
                    $(el_window).find('.waitlist-success-msg').show();
                }else{
                    $(el_window).find('.join-waitlist-btn').show();
                    $(el_window).find('.waitlist-success-msg').hide();
                }
            }
        })

        let h = ``;
        h += `<div>`;
            h += `<div style="padding: 20px; width: 100%; box-sizing: border-box;">`;
                // title
                h += `<svg style="width: 70px; height: 70px; margin: 0 auto; display: block;" id="Icons" height="512" viewBox="0 0 60 60" width="512" xmlns="http://www.w3.org/2000/svg"><path d="m45 19v29a3 3 0 0 1 -3 3h-34a3 3 0 0 1 -3-3v-29l20-15z" fill="#cce2ed"/><path d="m10 13.32v-8.66a1.656 1.656 0 0 1 1.66-1.66h2.68a1.656 1.656 0 0 1 1.66 1.66v4.34z" fill="#30649d"/><path d="m2.2 20.607a.861.861 0 0 0 1.226.23l21.083-15.179a.831.831 0 0 1 .982 0l21.08 15.179a.861.861 0 0 0 1.226-.23l1.056-1.574a.877.877 0 0 0 -.206-1.19l-23.156-16.683a.834.834 0 0 0 -.982 0l-23.156 16.683a.877.877 0 0 0 -.206 1.19z" fill="#3b7ac8"/><path d="m59 40v5a3 3 0 0 1 -3 3v1h-32v-1a3 3 0 0 1 -3-3v-5a3 3 0 0 1 3-3v-1h32v1a3 3 0 0 1 3 3z" fill="#30649d"/><rect fill="#3b7ac8" height="11" rx="3" width="38" x="21" y="26"/><rect fill="#3b7ac8" height="11" rx="3" width="38" x="21" y="48"/><path d="m26 55a1 1 0 0 1 -1-1v-1a1 1 0 0 1 2 0v1a1 1 0 0 1 -1 1z" fill="#76e4c1"/><path d="m30 55a1 1 0 0 1 -1-1v-1a1 1 0 0 1 2 0v1a1 1 0 0 1 -1 1z" fill="#76e4c1"/><g fill="#30649d"><path d="m47 55a1 1 0 0 1 -1-1v-1a1 1 0 0 1 2 0v1a1 1 0 0 1 -1 1z"/><path d="m43 55a1 1 0 0 1 -1-1v-1a1 1 0 0 1 2 0v1a1 1 0 0 1 -1 1z"/><path d="m51 55a1 1 0 0 1 -1-1v-1a1 1 0 0 1 2 0v1a1 1 0 0 1 -1 1z"/><path d="m55 55a1 1 0 0 1 -1-1v-1a1 1 0 0 1 2 0v1a1 1 0 0 1 -1 1z"/></g><path d="m26 44a1 1 0 0 1 -1-1v-1a1 1 0 0 1 2 0v1a1 1 0 0 1 -1 1z" fill="#76e4c1"/><path d="m30 44a1 1 0 0 1 -1-1v-1a1 1 0 0 1 2 0v1a1 1 0 0 1 -1 1z" fill="#76e4c1"/><path d="m47 44a1 1 0 0 1 -1-1v-1a1 1 0 0 1 2 0v1a1 1 0 0 1 -1 1z" fill="#23527c"/><path d="m43 44a1 1 0 0 1 -1-1v-1a1 1 0 0 1 2 0v1a1 1 0 0 1 -1 1z" fill="#23527c"/><path d="m51 44a1 1 0 0 1 -1-1v-1a1 1 0 0 1 2 0v1a1 1 0 0 1 -1 1z" fill="#23527c"/><path d="m55 44a1 1 0 0 1 -1-1v-1a1 1 0 0 1 2 0v1a1 1 0 0 1 -1 1z" fill="#23527c"/><path d="m26 33a1 1 0 0 1 -1-1v-1a1 1 0 0 1 2 0v1a1 1 0 0 1 -1 1z" fill="#76e4c1"/><path d="m30 33a1 1 0 0 1 -1-1v-1a1 1 0 0 1 2 0v1a1 1 0 0 1 -1 1z" fill="#76e4c1"/><path d="m47 33a1 1 0 0 1 -1-1v-1a1 1 0 0 1 2 0v1a1 1 0 0 1 -1 1z" fill="#30649d"/><path d="m43 33a1 1 0 0 1 -1-1v-1a1 1 0 0 1 2 0v1a1 1 0 0 1 -1 1z" fill="#30649d"/><path d="m51 33a1 1 0 0 1 -1-1v-1a1 1 0 0 1 2 0v1a1 1 0 0 1 -1 1z" fill="#30649d"/><path d="m55 33a1 1 0 0 1 -1-1v-1a1 1 0 0 1 2 0v1a1 1 0 0 1 -1 1z" fill="#30649d"/></svg>`;
                h += `<h1 class="login-form-title" style="margin-bottom: 0; margin-top: 15px; font-size: 18px;">Self-Hosted Puter is Coming soon!</h1>`;
                h += `<p style=" text-align:center; font-size: 15px; -webkit-font-smoothing: antialiased;padding: 0 10px; color: #2d3847; margin-top:0; margin-bottom: 0;">Join the waitlist for the launch of Self-Hosted Puter!</p>`;
                // error msg
                h += `<div class="login-error-msg"></div>`;
                // success
                h += `<div class="waitlist-success-msg form-success-msg" style="background-color: #cafbe4; margin-top:10px; margin-bottom: 0;">You've been added to the waitlist and will receive a notification when it's your turn.</div>`;
                // waitlist
                h += `<button type="button" class="join-waitlist-btn button button-primary button-block" style="margin-top: 10px; display:none;">Join Waitlist!</button>`;
            h += `</div>`;
        h += `</div>`;
        
        const el_window = await UIWindow({
            title: null,
            app: 'waitlist',
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
                height: 245,
                'background-color': 'rgba(231, 238, 245, .95)',
                'backdrop-filter': 'blur(3px)',
            }    
        })

        $(el_window).find('.join-waitlist-btn').on('click', function(e){
            $(this).addClass('disabled');
            setItem({
                key: "joined_selfhosted_waitlist",
                value: true,
                success: async function(){
                    $(el_window).find('.join-waitlist-btn').hide();
                    $(el_window).find('.waitlist-success-msg').show();
                }
            })
        })  

    }) 
}

export default UIWindowSelfhostedWaitlist