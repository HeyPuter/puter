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

import UIAlert from './UIAlert.js';
import UIContextMenu from './UIContextMenu.js';
import path from '../lib/path.js';
import UITaskbarItem from './UITaskbarItem.js';
import UIWindowLogin from './UIWindowLogin.js';
import UIWindowPublishWebsite from './UIWindowPublishWebsite.js';
import UIWindowItemProperties from './UIWindowItemProperties.js';
import new_context_menu_item from '../helpers/new_context_menu_item.js';
import refresh_item_container from '../helpers/refresh_item_container.js';
import UIWindowSaveAccount from './UIWindowSaveAccount.js';
import UIWindowEmailConfirmationRequired from './UIWindowEmailConfirmationRequired.js';
import launch_app from "../helpers/launch_app.js"
import UIWindowShare from './UIWindowShare.js';
import item_icon from '../helpers/item_icon.js';

const el_body = document.getElementsByTagName('body')[0];

async function UIWindow(options) {
    const win_id = window.global_element_id++;
    window.last_window_zindex++;

    // options.dominant places the window in center close to top.
    options.dominant = options.dominant ?? false;

    // in case of file dialogs, the window is automatically dominant
    if(options.is_openFileDialog || options.is_saveFileDialog || options.is_directoryPicker)
        options.dominant = true;
 
    // we don't want to increment window_counter for dominant windows
    if(!options.dominant)
        window.window_counter++;

    // add this window's id to the window_stack
    window.window_stack.push(win_id);

    // =====================================
    // set options defaults
    // =====================================

    // indicates if sidebar is hidden, only applies to directory windows
    let sidebar_hidden = false;

    const default_window_top = ('calc(15% + ' + ((window.window_counter-1) % 10 * 20) + 'px)');

    // list of file types that are allowed, other types will be disabled but still shown
    options.allowed_file_types = options.allowed_file_types ?? '';
    options.app = options.app ?? '';
    options.allow_context_menu = options.allow_context_menu ?? true;
    options.allow_native_ctxmenu = options.allow_native_ctxmenu ?? false;
    options.allow_user_select = options.allow_user_select ?? false;
    options.backdrop = options.backdrop ?? false;
    options.body_css = options.body_css ?? {};
    options.border_radius = options.border_radius ?? undefined;
    options.draggable_body = options.draggable_body ?? false;
    options.element_uuid = options.element_uuid ?? window.uuidv4();
    options.center = options.center ?? false;
    options.close_on_backdrop_click = options.close_on_backdrop_click ?? true;
    options.disable_parent_window = options.disable_parent_window ?? false;
    options.has_head = options.has_head ?? true;
    options.height = options.height ?? 380;
    options.icon = options.icon ?? null;
    options.iframe_msg_uid = options.iframe_msg_uid ?? null;
    options.is_droppable = options.is_droppable ?? true;
    options.is_draggable = options.is_draggable ?? true;
    options.is_dir = options.is_dir ?? false;
    options.is_minimized = options.is_minimized ?? false;
    options.is_maximized = options.is_maximized ?? false;
    options.is_openFileDialog = options.is_openFileDialog ?? false;
    options.is_resizable = options.is_resizable ?? true;

    // if this is a fullpage window, it won't be resizable
    if(options.is_fullpage){
        options.is_maximized = false;
        options.is_resizable = false;
    }

    // In the embedded/fullpage mode every window is on top since there is no taskbar to switch between windows
    // if user has specifically asked for this window to NOT stay on top, honor it.
    if((window.is_embedded || window.is_fullpage_mode) && !options.parent_uuid && options.stay_on_top !== false)
        options.stay_on_top = true;
    // Keep the window on top of all previously opened windows
    options.stay_on_top = options.stay_on_top ?? false;

    options.is_saveFileDialog = options.is_saveFileDialog ?? false;
    options.show_minimize_button = options.show_minimize_button ?? true;
    options.on_close = options.on_close ?? undefined;
    options.parent_uuid = options.parent_uuid ?? null;
    options.selectable_body = (options.selectable_body === undefined || options.selectable_body === true) ? true : false;
    options.show_in_taskbar = options.show_in_taskbar ?? true;
    options.show_maximize_button = options.show_maximize_button ?? true;
    options.single_instance = options.single_instance ?? false;
    options.sort_by = options.sort_by ?? 'name';
    options.sort_order = options.sort_order ?? 'asc';
    options.title = options.title ?? null;
    options.top = options.top ?? default_window_top;
    options.type = options.type ?? null;
    options.update_window_url = options.update_window_url ?? false;
    options.layout = options.layout ?? 'icons';
    options.width = options.width ?? 680;
    options.window_css = options.window_css ?? {};
    options.window_class = (options.window_class !== undefined ? ' ' + options.window_class : '');

    options.is_visible = options.is_visible ?? true;

    // if only one instance is allowed, bring focus to the window that is already open
    if(options.single_instance && options.app !== ''){
        let $already_open_window =  $(`.window[data-app="${html_encode(options.app)}"]`);
        if($already_open_window.length){
            $(`.window[data-app="${html_encode(options.app)}"]`).focusWindow();
            return;
        }
    }

    // left
    if(!options.dominant && !options.center){
        options.left = options.left ?? ((window.innerWidth/2 - options.width/2) +(window.window_counter-1) % 10 * 30) + 'px';
    }else if(!options.dominant && options.center){
        options.left = options.left ?? ((window.innerWidth/2 - options.width/2)) + 'px';
    }
    else if(options.dominant){
        options.left = (window.innerWidth/2 - options.width/2) + 'px';
    }   
    else
        options.left = options.left ?? ((window.innerWidth/2 - options.width/2) + 'px');
 
    // top
    if(!options.dominant && !options.center){
        options.top = options.top ?? ((window.innerHeight/2 - options.height/2) +(window.window_counter-1) % 10 * 30) + 'px';
    }else if(!options.dominant && options.center){
        options.top = options.top ?? ((window.innerHeight/2 - options.height/2)) + 'px';
    }
    else if(options.dominant){
        options.top = (window.innerHeight * 0.15);
    }
    else if(isMobile.phone)
        options.top = 100;
    
    if(isMobile.phone && !options.center && !options.dominant){
        options.left = 0;
        options.top = window.toolbar_height + 'px';
        options.width = '100%';
        options.height = 'calc(100% - ' + window.toolbar_height + 'px)';
    }else{
        options.width += 'px'
        options.height += 'px'
    }

    // =====================================
    // cover page
    // =====================================
    if(options.cover_page){
        options.left = 0;
        options.top = 0;
        options.width = '100%';
        options.height = '100%';
    }
    // --------------------------------------------------------
    // HTML for Window
    // --------------------------------------------------------
    let h = '';

    // Window
    let zindex = options.stay_on_top ? (99999999 + window.last_window_zindex + 1 + ' !important') : window.last_window_zindex;
    let user_set_url_params = [];
    if (options.params !== undefined) {
        for (let key in options.params) {
            user_set_url_params.push(key + "=" + options.params[key]);
        }
        if(user_set_url_params.length > 0)
            user_set_url_params = '?'+ user_set_url_params.join('&');
    }
    h += `<div class="window window-active 
                        ${options.app === 'explorer' ? 'window-explorer' : ''}
                        ${options.cover_page ? 'window-cover-page' : ''}
                        ${options.uid !== undefined ? 'window-'+options.uid : ''} 
                        ${options.window_class} 
                        ${options.allow_user_select ? ' allow-user-select' : ''}
                        ${options.is_openFileDialog || options.is_saveFileDialog || options.is_directoryPicker ? 'window-filedialog' : ''}" 
                id="window-${win_id}" 
                data-allowed_file_types = "${html_encode(options.allowed_file_types)}"
                data-app="${html_encode(options.app)}" 
                data-app_pseudonym="${html_encode(options.pseudonym)}"
                data-app_uuid="${html_encode(options.app_uuid ?? '')}" 
                data-disable_parent_window = "${html_encode(options.disable_parent_window)}"
                data-name="${html_encode(options.title)}" 
                data-path ="${html_encode(options.path)}"
                data-uid ="${html_encode(options.uid)}"
                data-element_uuid="${html_encode(options.element_uuid)}"
                data-parent_uuid="${html_encode(options.parent_uuid)}"
                ${options.parent_instance_id ? `data-parent_instance_id="${options.parent_instance_id}"` : ''}
                data-id ="${win_id}"
                data-iframe_msg_uid ="${html_encode(options.iframe_msg_uid)}"
                data-is_dir ="${options.is_dir}"
                data-return_to_parent_window = "${options.return_to_parent_window}"
                data-initiating_app_uuid = "${html_encode(options.initiating_app_uuid)}"
                data-is_openFileDialog ="${options.is_openFileDialog}"
                data-is_saveFileDialog ="${options.is_saveFileDialog}"
                data-is_directoryPicker ="${options.is_directoryPicker}"
                data-is_fullpage ="${options.is_fullpage ? 1 : 0}"
                data-is_minimized ="${options.is_minimized ? 1 : 0}"
                data-is_maximized ="${options.is_maximized ? 1 : 0}"
                data-layout ="${options.layout}"
                data-stay_on_top ="${options.stay_on_top}"
                data-sort_by ="${options.sort_by ?? 'name'}"
                data-sort_order ="${options.sort_order ?? 'asc'}"
                data-multiselectable = "${options.selectable_body}"
                data-update_window_url = "${options.update_window_url && options.is_visible}"
                data-user_set_url_params = "${html_encode(user_set_url_params)}"
                data-initial_zindex = "${zindex}"
                style=" z-index: ${zindex}; 
                        ${options.width !== undefined ? 'width: ' + html_encode(options.width) +'; ':''}
                        ${options.height !== undefined ? 'height: ' + html_encode(options.height) +'; ':''}
                        ${options.border_radius !== undefined ? 'border-radius: ' + html_encode(options.border_radius) +'; ':''}
                    " 
                >`;
        // window mask
        h += `<div class="window-disable-mask">`;
            //busy indicator
            h += `<div class="busy-indicator">BUSY</div>`;
        h += `</div>`;


        // Head
        if(options.has_head){
            h += `<div class="window-head">`;
                // draggable handle which also contains icon and title
                h+=`<div class="window-head-draggable">`;
                    // icon
                    if(options.icon)
                        h += `<img class="window-head-icon" />`;
                    // title
                    h += `<span class="window-head-title" title="${html_encode(options.title)}"></span>`;
                h += `</div>`;
                // Minimize button, only if window is resizable and not embedded
                if(options.is_resizable && options.show_minimize_button && !window.is_embedded)
                    h += `<span class="window-action-btn window-minimize-btn" style="margin-left:0;"><img src="${html_encode(window.icons['minimize.svg'])}" draggable="false"></span>`;
                // Maximize button
                if(options.is_resizable && options.show_maximize_button)
                    h += `<span class="window-action-btn window-scale-btn"><img src="${html_encode(window.icons['scale.svg'])}" draggable="false"></span>`;
                // Close button
                h += `<span class="window-action-btn window-close-btn"><img src="${html_encode(window.icons['close.svg'])}" draggable="false"></span>`;
            h += `</div>`;
        }

        // Sidebar
        if(options.is_dir && !isMobile.phone){
            h += `<div class="window-sidebar disable-user-select hide-scrollbar"
                    style="${window.window_sidebar_width ? 'width: ' + html_encode(window.window_sidebar_width) + 'px !important;' : ''}"
                    draggable="false"
                >`;
                // favorites
                h += `<h2 class="window-sidebar-title disable-user-select">${i18n('favorites')}</h2>`;
                // default items if sidebar_items is not set
                if(!window.sidebar_items){
                    h += `<div draggable="false" title="${i18n('home')}" class="window-sidebar-item disable-user-select ${options.path === window.home_path ? 'window-sidebar-item-active' : ''}" data-path="${html_encode(window.home_path)}"><img draggable="false" class="window-sidebar-item-icon" src="${html_encode(window.icons['sidebar-folder-home.svg'])}">${i18n('home')}</div>`;
                    h += `<div draggable="false" title="${i18n('documents')}" class="window-sidebar-item disable-user-select ${options.path === window.docs_path ? 'window-sidebar-item-active' : ''}" data-path="${html_encode(window.docs_path)}"><img draggable="false" class="window-sidebar-item-icon" src="${html_encode(window.icons['sidebar-folder-documents.svg'])}">${i18n('documents')}</div>`;
                    h += `<div draggable="false" title="${i18n('public')}" class="window-sidebar-item disable-user-select ${options.path === window.public_path ? 'window-sidebar-item-active' : ''}" data-path="${html_encode(window.public_path)}"><img draggable="false" class="window-sidebar-item-icon" src="${html_encode(window.icons['sidebar-folder-public.svg'])}">${i18n('public')}</div>`;
                    h += `<div draggable="false" title="${i18n('pictures')}" class="window-sidebar-item disable-user-select ${options.path === window.pictures_path ? 'window-sidebar-item-active' : ''}" data-path="${html_encode(window.pictures_path)}"><img draggable="false" class="window-sidebar-item-icon" src="${html_encode(window.icons['sidebar-folder-pictures.svg'])}">${i18n('pictures')}</div>`;
                    h += `<div draggable="false" title="${i18n('desktop')}" class="window-sidebar-item disable-user-select ${options.path === window.desktop_path ? 'window-sidebar-item-active' : ''}" data-path="${html_encode(window.desktop_path)}"><img draggable="false" class="window-sidebar-item-icon" src="${html_encode(window.icons['sidebar-folder-desktop.svg'])}">${i18n('desktop')}</div>`;
                    h += `<div draggable="false" title="${i18n('videos')}" class="window-sidebar-item disable-user-select ${options.path === window.videos_path ? 'window-sidebar-item-active' : ''}" data-path="${html_encode(window.videos_path)}"><img draggable="false" class="window-sidebar-item-icon" src="${html_encode(window.icons['sidebar-folder-videos.svg'])}">${i18n('videos')}</div>`;
                }else{
                    let items = JSON.parse(window.sidebar_items);
                    for(let item of items){
                        let icon;
                        if(item.path === window.home_path)
                            icon = window.icons['sidebar-folder-home.svg'];
                        else if(item.path === window.docs_path)
                            icon = window.icons['sidebar-folder-documents.svg'];
                        else if(item.path === window.public_path)
                            icon = window.icons['sidebar-folder-public.svg'];
                        else if(item.path === window.pictures_path)
                            icon = window.icons['sidebar-folder-pictures.svg'];
                        else if(item.path === window.desktop_path)
                            icon = window.icons['sidebar-folder-desktop.svg'];
                        else if(item.path === window.videos_path)
                            icon = window.icons['sidebar-folder-videos.svg'];
                        else
                            icon = window.icons['sidebar-folder.svg'];
                        h += `<div title="${html_encode(item.label)}" class="window-sidebar-item disable-user-select ${options.path === item.path ? 'window-sidebar-item-active' : ''}" data-path="${html_encode(item.path)}"><img draggable="false" class="window-sidebar-item-icon" src="${html_encode(icon)}">${html_encode(item.name)}</div>`;
                    }
                }
            h += `</div>`;
        }

        // Menubar
        h += `<div class="window-menubar" data-window-id="${win_id}"></div>`;

        // Navbar
        if(options.is_dir){
            h += `<div class="window-navbar">`;
                h += `<div style="float:left; margin-left:5px; margin-right:5px;">`;
                    // Back
                    h += `<img draggable="false" class="window-navbar-btn window-navbar-btn-back window-navbar-btn-disabled" src="${html_encode(window.icons['arrow-left.svg'])}" title="Click to go back.">`;
                    // Forward
                    h += `<img draggable="false" class="window-navbar-btn window-navbar-btn-forward window-navbar-btn-disabled" src="${html_encode(window.icons['arrow-right.svg'])}" title="Click to go forward.">`;
                    // Up
                    h += `<img draggable="false" class="window-navbar-btn window-navbar-btn-up ${options.path === '/' ? 'window-navbar-btn-disabled' : ''}" src="${html_encode(window.icons['arrow-up.svg'])}" title="Click to go one directory up.">`;
                h += `</div>`;
                // Path
                h += `<div class="window-navbar-path">${window.navbar_path(options.path, window.user.username)}</div>`;
                // Path editor
                h += `<input class="window-navbar-path-input" data-path="${html_encode(options.path)}" value="${html_encode(options.path)}" spellcheck="false"/>`;
                // Layout settings
                h += `<img class="window-navbar-layout-settings" src="${html_encode(options.layout === 'icons' ? window.icons['layout-icons.svg'] : window.icons['layout-list.svg'])}" draggable="false">`;
            h += `</div>`;
        }

        // Body
        h += `<div 
                class="window-body${options.is_dir ? ' item-container' : ''}${options.iframe_url !== undefined || options.iframe_srcdoc !== undefined ? ' window-body-app' : ''}${options.is_saveFileDialog || options.is_openFileDialog || options.is_directoryPicker ? ' window-body-filedialog' : ''}" 
                data-allowed_file_types="${html_encode(options.allowed_file_types)}"
                data-path="${html_encode(options.path)}"
                data-multiselectable = "${options.selectable_body}"
                data-sort_by ="${options.sort_by ?? 'name'}"
                data-sort_order ="${options.sort_order ?? 'asc'}"
                data-uid ="${options.uid}"
                id="window-body-${win_id}" 
                style="${!options.has_head ? ' height: 100%;' : ''}">`;
            // iframe, for apps
            if(options.iframe_url || options.iframe_srcdoc){
                let allow_str = `camera; encrypted-media; gamepad; display-capture; geolocation; gyroscope; microphone; midi; clipboard-read; clipboard-write; fullscreen; web-share; file-system-handle; local-storage; downloads;`;
                if(window.co_isolation_enabled)
                    allow_str += ' cross-origin-isolated;';
                // <iframe>
                // Important: we don't allow allow-same-origin when iframe_srcdoc is used because this would allow the iframe to access the parent window's DOM, localStorage, etc.
                // this is a security risk and must be avoided.
                h += `<iframe tabindex="-1"
                        data-app="${html_encode(options.app)}"
                        class="window-app-iframe" 
                        frameborder="0" 
                        ${options.iframe_url ? 'src="'+ html_encode(options.iframe_url)+'"' : ''}
                        ${options.iframe_srcdoc ? 'srcdoc="'+ html_encode(options.iframe_srcdoc) +'"' : ''}
                        ${(window.co_isolation_enabled && options.iframe_credentialless !== false)
                            ? 'credentialless '
                            : ''
                        }
                        allow = "${allow_str}"
                        allowtransparency="true"
                        allowpaymentrequest="true" 
                        allowfullscreen="true"
                        webkitallowfullscreen="webkitallowfullscreen" 
                        mozallowfullscreen="mozallowfullscreen"
                        sandbox="allow-forms allow-modals allow-pointer-lock allow-popups allow-popups-to-escape-sandbox ${options.iframe_srcdoc ? '' : 'allow-same-origin'} allow-scripts allow-top-navigation-by-user-activation allow-downloads allow-presentation allow-storage-access-by-user-activation"></iframe>`;
            }
            // custom body
            else if(options.body_content !== undefined){
                h += options.body_content;
            }

            // Directory
            if(options.is_dir){
                // Detail layout header
                h += window.explore_table_headers();
                
                // Add 'This folder is empty' message by default
                h += `<div class="explorer-empty-message">This folder is empty</div>`;

                h += `<div class="explorer-error-message">${i18n('error_message_is_missing')}</div>`;

                // Loading spinner
                h += `<div class="explorer-loading-spinner">`;
                    h +=`<svg style="display:block; margin: 0 auto; " xmlns="http://www.w3.org/2000/svg" height="24" width="24" viewBox="0 0 24 24"><title>circle anim</title><g fill="#212121" class="nc-icon-wrapper"><g class="nc-loop-circle-24-icon-f"><path d="M12 24a12 12 0 1 1 12-12 12.013 12.013 0 0 1-12 12zm0-22a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2z" fill="#212121" opacity=".4"></path><path d="M24 12h-2A10.011 10.011 0 0 0 12 2V0a12.013 12.013 0 0 1 12 12z" data-color="color-2"></path></g><style>.nc-loop-circle-24-icon-f{--animation-duration:0.5s;transform-origin:12px 12px;animation:nc-loop-circle-anim var(--animation-duration) infinite linear}@keyframes nc-loop-circle-anim{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}</style></g></svg>`;
                    h += `<p class="explorer-loading-spinner-msg">${i18n('loading')}...</p>`;
                h += `</div>`;
            }

        h += `</div>`;

        // Explorer footer
        if(options.is_dir && !options.is_saveFileDialog && !options.is_openFileDialog && !options.is_directoryPicker){
            h += `<div class="explorer-footer">`
                h += `<span class="explorer-footer-item-count"></span>`;
                h += `<span class="explorer-footer-seperator">|</span>`;
                h += `<span class="explorer-footer-selected-items-count"></span>`;
            h += `</div>`;
        }

        // is_saveFileDialog
        if(options.is_saveFileDialog){
            h += `<div class="window-filedialog-prompt">`;
                h += `<div style="display:flex; flex-grow: 1;">`;
                    h += `<input type="text" style="flex-grow:1;" class="savefiledialog-filename" autocorrect="off" spellcheck="false" value="${html_encode(options.saveFileDialog_default_filename) ?? ''}">`;
                    h += `<button class="button button-small filedialog-cancel-btn">${i18n('cancel')}</button>`;
                    h += `<button class="button `;
                        if(options.saveFileDialog_default_filename === undefined || options.saveFileDialog_default_filename === '')
                            h+= `disabled `; 
                    h += `button-small button-primary savefiledialog-save-btn">${i18n('save')}</button>`;
                h += `</div>`;
            h += `</div>`;
        }

        // is_openFileDialog
        else if(options.is_openFileDialog){
            h += `<div class="window-filedialog-prompt">`;
                // 'upload here'
                h += `<div class="window-filedialog-upload-here"><svg xmlns="http://www.w3.org/2000/svg" style="width: 18px; height: 18px; margin-bottom: -4px;" width="16" height="16" fill="currentColor" class="bi bi-cloud-arrow-up" viewBox="0 0 16 16">
  <path fill-rule="evenodd" d="M7.646 5.146a.5.5 0 0 1 .708 0l2 2a.5.5 0 0 1-.708.708L8.5 6.707V10.5a.5.5 0 0 1-1 0V6.707L6.354 7.854a.5.5 0 1 1-.708-.708z"/>
  <path d="M4.406 3.342A5.53 5.53 0 0 1 8 2c2.69 0 4.923 2 5.166 4.579C14.758 6.804 16 8.137 16 9.773 16 11.569 14.502 13 12.687 13H3.781C1.708 13 0 11.366 0 9.318c0-1.763 1.266-3.223 2.942-3.593.143-.863.698-1.723 1.464-2.383m.653.757c-.757.653-1.153 1.44-1.153 2.056v.448l-.445.049C2.064 6.805 1 7.952 1 9.318 1 10.785 2.23 12 3.781 12h8.906C13.98 12 15 10.988 15 9.773c0-1.216-1.02-2.228-2.313-2.228h-.5v-.5C12.188 4.825 10.328 3 8 3a4.53 4.53 0 0 0-2.941 1.1z"/>
</svg> ${i18n('upload')}</div>`;

                h += `<div style="text-align:right; flex-grow:1;">`;
                    h += `<button class="button button-small filedialog-cancel-btn">${i18n('cancel')}</button>`;
                    h += `<button class="button disabled button-small button-primary openfiledialog-open-btn">${i18n('open')}</button>`;
                h += `</div>`;
            h += `</div>`;
        }

        // is_directoryPicker
        else if(options.is_directoryPicker){
            h += `<div class="window-filedialog-prompt">`;
                h += `<div style="text-align:right; flex-grow: 1;">`;
                    h += `<button class="button button-small filedialog-cancel-btn">${i18n('cancel')}</button>`;
                    h += `<button class="button button-small button-primary directorypicker-select-btn" style="margin-left:10px;">${i18n('select')}</button>`;
                h += `</div>`;
            h += `</div>`;
        }
    h += `</div>`;

    // backdrop
    if(options.backdrop){
        let backdrop_zindex;
        // backdrop should also cover over taskbar
        let taskbar_zindex = $('.taskbar').css('z-index');
        if(taskbar_zindex === null || taskbar_zindex === undefined)
            backdrop_zindex = zindex;
        else{
            taskbar_zindex = parseInt(taskbar_zindex);
            backdrop_zindex = taskbar_zindex > zindex ? taskbar_zindex : zindex;
        }

        // dominant backdrop will cover over toolbar as well
        if(options.backdrop_covers_toolbar)
            backdrop_zindex = 999999;
        
        h = `<div class="window-backdrop" style="z-index:${backdrop_zindex};">` + h + `</div>`;
    }

    // Append
    $(el_body).append(h);
    

    // disable_parent_window
    if(options.disable_parent_window && options.parent_uuid !== null){
        const $el_parent_window = $(`.window[data-element_uuid="${options.parent_uuid}"]`);
        const $el_parent_disable_mask = $el_parent_window.find('.window-disable-mask');
        //disable parent window
        $el_parent_window.addClass('window-disabled')
        $el_parent_disable_mask.show();
        $el_parent_disable_mask.css('z-index', parseInt($el_parent_window.css('z-index')) + 1);
        $el_parent_window.find('iframe').blur();
    }
    
    // Add Taskbar Item
    if(!options.is_openFileDialog && !options.is_saveFileDialog && !options.is_directoryPicker && options.show_in_taskbar){
        // add icon if there is no similar app already open
        if($(`.taskbar-item[data-app="${options.app}"]`).length === 0){
            UITaskbarItem({
                icon: options.icon,
                name: options.title,
                app: options.app,
                open_windows_count: 1,
                before_trash: true,
                onClick: function(){
                    let open_window_count = parseInt($(`.taskbar-item[data-app="${options.app}"]`).attr('data-open-windows'));
                    if(open_window_count === 0){
                        launch_app({
                            name: options.app,
                        }) 
                    }else{
                        return false;
                    }
                }
            });
            if(options.app)
                $(`.taskbar-item[data-app="${options.app}"] .active-taskbar-indicator`).show();
        }else{
            if(options.app){
                $(`.taskbar-item[data-app="${options.app}"]`).attr('data-open-windows', parseInt($(`.taskbar-item[data-app="${options.app}"]`).attr('data-open-windows')) + 1);
                $(`.taskbar-item[data-app="${options.app}"] .active-taskbar-indicator`).show();
            }
        }
    }
    
    // if directory, set window_nav_history and window_nav_history_current_position
    if(options.is_dir){
        window.window_nav_history[win_id] = [options.path];
        window.window_nav_history_current_position[win_id] = 0;
    }

    // get all the elements needed
    const el_window = document.querySelector(`#window-${win_id}`);
    const el_window_head = document.querySelector(`#window-${win_id} > .window-head`);
    const el_window_sidebar = document.querySelector(`#window-${win_id} > .window-sidebar`);
    const el_window_head_title = document.querySelector(`#window-${win_id} > .window-head .window-head-title`);
    const el_window_head_icon = document.querySelector(`#window-${win_id} > .window-head .window-head-icon`);
    const el_window_head_scale_btn = document.querySelector(`#window-${win_id} > .window-head > .window-scale-btn`);
    const el_window_navbar_back_btn = document.querySelector(`#window-${win_id} .window-navbar-btn-back`);
    const el_window_navbar_forward_btn = document.querySelector(`#window-${win_id} .window-navbar-btn-forward`);
    const el_window_navbar_up_btn = document.querySelector(`#window-${win_id} .window-navbar-btn-up`);
    const el_window_body = document.querySelector(`#window-${win_id} > .window-body`);
    const el_window_app_iframe = document.querySelector(`#window-${win_id} > .window-body > .window-app-iframe`);
    const el_savefiledialog_filename = document.querySelector(`#window-${win_id} .savefiledialog-filename`);
    const el_savefiledialog_save_btn = document.querySelector(`#window-${win_id} .savefiledialog-save-btn`);
    const el_filedialog_cancel_btn = document.querySelector(`#window-${win_id} .filedialog-cancel-btn`);
    const el_openfiledialog_open_btn = document.querySelector(`#window-${win_id} .openfiledialog-open-btn`);
    const el_directorypicker_select_btn = document.querySelector(`#window-${win_id} .directorypicker-select-btn`);
    const el_window_filedialog_upload_here = document.querySelector(`#window-${win_id} .window-filedialog-upload-here`);

    if(el_window_filedialog_upload_here){
        el_window_filedialog_upload_here.addEventListener('click', function(){
            window.init_upload_using_dialog(el_window_body, $(el_window).attr('data-path') + '/');
        });
    }
    // attach optional event listeners
    el_window.on_before_exit = options.on_before_exit;

    // disable menubar by default
    $(el_window).find('.window-menubar').hide();

    if(options.is_maximized){
        // save original size and position
        $(el_window).attr({
            'data-left-before-maxim': ((window.innerWidth/2 - 680/2) +(window.window_counter-1) % 10 * 30) + 'px',
            'data-top-before-maxim': default_window_top,
            'data-width-before-maxim': '680px',
            'data-height-before-maxim': '350px',
            'data-is_maximized': '1',
        });

        // shrink icon
        $(el_window).find('.window-scale-btn>img').attr('src', window.icons['scale-down-3.svg']);

        // set new size and position
        $(el_window).css({
            'top': window.toolbar_height + 'px',
            'left': '0',
            'width': '100%',
            'height': `calc(100% - ${window.taskbar_height + window.toolbar_height + 6}px)`,
            'transform': 'none',
        });
    }

    // when a window is created, focus is brought to it and 
    // therefore it is the current active element
    window.active_element =  el_window;

    // set name
    $(el_window_head_title).html(html_encode(options.title));

    // set icon
    if(options.icon)
        $(el_window_head_icon).attr('src', options.icon.image ?? options.icon);
    
    // root folder of a shared user?
    if(options.is_dir && (options.path.split('/').length - 1) === 1 && options.path !== '/'+window.user.username){
        $(el_window_head_icon).attr('src', window.icons['shared.svg']);
    }
    // focus on this window and deactivate other windows
    if ( options.is_visible ) {
        $(el_window).focusWindow();
    }

    if (window.animate_window_opening) {
        // animate window opening
        $(el_window).css({
            'opacity': '0',
            'transition': 'opacity 70ms ease-in-out',
        });

        // Use requestAnimationFrame to schedule a function to run at the next repaint of the browser window
        requestAnimationFrame(() => {
            // Change the window's opacity to 1 and scale to 1 to create an opening effect
            $(el_window).css({
                'opacity': '1',
            })

            // Set a timeout to run after the transition duration (100ms) 
            setTimeout(function () {
                // Remove the transition property, so future CSS changes won't be animated
                $(el_window).css({
                    'transition': 'none',
                })
            }, 70);
        });
    }

    // =====================================
    // Center relative to parent window
    // =====================================
    if(options.parent_center && options.parent_uuid){
        const $parent_window = $(`.window[data-element_uuid="${options.parent_uuid}"]`);
        const parent_window_width = $parent_window.width();
        const parent_window_height = $parent_window.height();
        const parent_window_left = $parent_window.offset().left;
        const parent_window_top = $parent_window.offset().top;
        const window_height = $(el_window).height();
        const window_width = $(el_window).width();
        options.left = parent_window_left + parent_window_width/2 - window_width/2;
        options.top = parent_window_top + parent_window_height/2 - window_height/2;
        $(el_window).css({
            'left': options.left + 'px',
            'top': options.top + 'px',
        });
    }

    // onAppend() - using show() is a hack to make sure window is visible AND onAppend is called when
    // window is actually appended and usable.
    // NOTE: there is another is_visible condition below
    if ( options.is_visible ) {

        if(options.fadeIn){
            $(el_window).css('opacity', 0);

            $(el_window).animate({ opacity: 1 }, options.fadeIn, function() {
                // Move the onAppend callback here to ensure it's called after fade-in
                if (options.is_visible) {
                    $(el_window).show(0, function(e) {
                        // if SaveFileDialog, bring focus to the el_savefiledialog_filename and select all
                        if (options.is_saveFileDialog) {
                            let item_name = el_savefiledialog_filename.value;
                            const extname = path.extname('/' + item_name);
                            if (extname !== '')
                                el_savefiledialog_filename.setSelectionRange(0, item_name.length - extname.length);
                            else
                                $(el_savefiledialog_filename).select();
                    
                            $(el_savefiledialog_filename).get(0).focus({preventScroll:true});
                        }
                        //set custom window css
                        $(el_window).css(options.window_css);
                        // onAppend()
                        if (options.onAppend && typeof options.onAppend === 'function') {
                            options.onAppend(el_window);
                        }
                    });
                }
            });
        }else{
            $(el_window).show(0, function(e){
                // if SaveFileDialog, bring focus to the el_savefiledialog_filename and select all
                if(options.is_saveFileDialog){
                    let item_name = el_savefiledialog_filename.value;
                    const extname = path.extname('/' + item_name);
                    if(extname !== '')
                    el_savefiledialog_filename.setSelectionRange(0, item_name.length - extname.length)
                    else
                        $(el_savefiledialog_filename).select();
            
                    $(el_savefiledialog_filename).get(0).focus({preventScroll:true});
                }
                //set custom window css
                $(el_window).css(options.window_css);
                // onAppend()
                if(options.onAppend && typeof options.onAppend === 'function'){
                    options.onAppend(el_window);
                }
            });
        }
    }

    if(options.is_saveFileDialog){
        //------------------------------------------------
        // SaveFileDialog > Save button
        //------------------------------------------------
        $(el_savefiledialog_save_btn).on('click', function(e){
            const filename = $(el_savefiledialog_filename).val();
            try{
                window.validate_fsentry_name(filename)
            }catch(err){
                UIAlert(err.message, 'error', 'OK')
                return;
            }
            const target_path = path.join($(el_window).attr('data-path'), filename);
            if(options.onSaveFileDialogSave && typeof options.onSaveFileDialogSave === 'function')
                options.onSaveFileDialogSave(target_path, el_window)
        })

        //------------------------------------------------
        // SaveFileDialog > Enter
        //------------------------------------------------
        $(el_savefiledialog_filename).on('keypress', function(event) {
            if(event.which === 13){
                $(el_savefiledialog_save_btn).trigger('click');
            }
        })

        //------------------------------------------------
        // Enable/disable Save button based on input
        //------------------------------------------------
        $(el_savefiledialog_filename).bind('keydown change input paste', function(){
            if($(this).val() !== '')
                $(el_savefiledialog_save_btn).removeClass('disabled');
            else
                $(el_savefiledialog_save_btn).addClass('disabled');
        })
        $(el_savefiledialog_filename).get(0).focus({preventScroll:true});
    }

    if(options.is_openFileDialog){
        //------------------------------------------------
        // OpenFileDialog > Open button
        //------------------------------------------------
        $(el_openfiledialog_open_btn).on('click', async function(e){
            const selected_els = $(el_window).find('.item-selected[data-is_dir="0"]');
            let selected_files;

            // No item selected
            if(selected_els.length === 0)
                return;
            // ------------------------------------------------
            // Item(s) selected
            // ------------------------------------------------
            else{
                selected_files = []
                // an array that hold the items to sign
                const items_to_sign = [];

                // prepare items to sign
                for(let i=0; i<selected_els.length; i++)
                    items_to_sign.push({uid: $(selected_els[i]).attr('data-uid'), action: 'write', path: $(selected_els[i]).attr('data-path')});

                // sign items
                selected_files = await puter.fs.sign(options.initiating_app_uuid, items_to_sign);
                selected_files = selected_files.items;
                selected_files = Array.isArray(selected_files) ? selected_files : [selected_files];

                // change path of each item to preserve privacy
                for(let i=0; i<selected_files.length; i++)
                    selected_files[i].path = privacy_aware_path(selected_files[i].path)
            }

            const ifram_msg_uid = $(el_window).attr('data-iframe_msg_uid');
            if(options.return_to_parent_window){
                window.opener.postMessage({
                    msg: "fileOpenPicked", 
                    original_msg_id: ifram_msg_uid, 
                    items: Array.isArray(selected_files) ? [...selected_files] : [selected_files],
                    // LEGACY SUPPORT, remove this in the future when Polotno uses the new SDK
                    // this is literally put in here to support Polotno's legacy code
                    ...(selected_files.length === 1 && selected_files[0])
                }, '*');

                window.close();
                window.open('','_self').close();
            }
            else if(options.parent_uuid){
                // send event to iframe
                const target_iframe = $(`.window[data-element_uuid="${options.parent_uuid}"]`).find('.window-app-iframe').get(0);
                if(target_iframe){
                    target_iframe.contentWindow.postMessage({
                        msg: "fileOpenPicked", 
                        original_msg_id: ifram_msg_uid, 
                        items: Array.isArray(selected_files) ? [...selected_files] : [selected_files],
                        // LEGACY SUPPORT, remove this in the future when Polotno uses the new SDK
                        // this is literally put in here to support Polotno's legacy code
                        ...(selected_files.length === 1 && selected_files[0])
                    }, '*');
                }
                // focus on iframe
                $(target_iframe).get(0)?.focus({preventScroll:true});

                // send file_opened event
                const file_opened_event = new CustomEvent('file_opened', {detail: Array.isArray(selected_files) ? [...selected_files] : [selected_files]});

                // dispatch event to parent window
                $(`.window[data-element_uuid="${options.parent_uuid}"]`).get(0)?.dispatchEvent(file_opened_event);

                $(el_window).close();
            }
        })
    }
    else if(options.is_directoryPicker){
        //------------------------------------------------
        // DirectoryPicker > Select button
        //------------------------------------------------
        $(el_directorypicker_select_btn).on('click', async function(e){
            const selected_els = $(el_window).find('.item-selected[data-is_dir="1"]');
            let selected_dirs;
            // ------------------------------------------------
            // No item selected, return current directory
            // ------------------------------------------------
            if(selected_els.length === 0){
                selected_dirs = await puter.fs.sign(options.initiating_app_uuid, {uid: $(el_window).attr('data-uid'), action: 'write'})
                selected_dirs = selected_dirs.items;
            }             

            // ------------------------------------------------
            // directorie(s) selected
            // ------------------------------------------------
            else{
                selected_dirs = []
                // an array that hold the items to sign
                const items_to_sign = [];

                // prepare items to sign
                for(let i=0; i<selected_els.length; i++)
                    items_to_sign.push({uid: $(selected_els[i]).attr('data-uid'), action: 'write', path: $(selected_els[i]).attr('data-path')});

                // sign items
                selected_dirs = await puter.fs.sign(options.initiating_app_uuid, items_to_sign);
                selected_dirs = selected_dirs.items;
                selected_dirs = Array.isArray(selected_dirs) ? selected_dirs : [selected_dirs];

                // change path of each item to preserve privacy
                for(let i=0; i<selected_dirs.length; i++)
                    selected_dirs[i].path = privacy_aware_path(selected_dirs[i].path)
            }

            const ifram_msg_uid = $(el_window).attr('data-iframe_msg_uid');

            if(options.return_to_parent_window){
                window.opener.postMessage({
                    msg: "directoryPicked", 
                    original_msg_id: ifram_msg_uid, 
                    items: Array.isArray(selected_dirs) ? [...selected_dirs] : [selected_dirs],
                    // LEGACY SUPPORT, remove this in the future when Polotno uses the new SDK
                    // this is literally put in here to support Polotno's legacy code
                    ...(selected_dirs.length === 1 && selected_dirs[0])
                }, '*');

                window.close();
                window.open('','_self').close();
            }
            if(options.parent_uuid){
                // Send directoryPicked event to iframe
                const target_iframe = $(`.window[data-element_uuid="${options.parent_uuid}"]`).find('.window-app-iframe').get(0);
                if(target_iframe){
                    target_iframe.contentWindow.postMessage({
                        msg: "directoryPicked", 
                        original_msg_id: ifram_msg_uid, 
                        items: Array.isArray(selected_dirs) ? [...selected_dirs] : [selected_dirs],
                    }, '*');
                }
                $(target_iframe).get(0).focus({preventScroll:true});
                $(el_window).close();
            }
        })
    }

    if(options.is_saveFileDialog || options.is_openFileDialog || options.is_directoryPicker){
        //------------------------------------------------
        // FileDialog > Cancel button
        //------------------------------------------------
        $(el_filedialog_cancel_btn).on('click', function(e){
            if(options.return_to_parent_window){
                window.close();
                window.open('','_self').close();
            }
            $(el_window).hide(0, ()=>{
                // re-anable parent window
                $(`.window[data-element_uuid="${options.parent_uuid}"]`).removeClass('window-disabled');
                $(`.window[data-element_uuid="${options.parent_uuid}"]`).find('.window-disable-mask').hide();
                $(el_window).close();
            })
        })
    }

    if(options.is_dir){
        window.navbar_path_droppable(el_window);
        window.sidebar_item_droppable(el_window);
        // --------------------------------------------------------
        // Back button
        // --------------------------------------------------------
        $(el_window_navbar_back_btn).on('click', function(e){
            // if history menu is open don't continue
            if($(el_window_navbar_back_btn).hasClass('has-open-contextmenu'))
                return;
            // if ctrl/cmd are pressed, open in new window
            if(e.ctrlKey || e.metaKey){
                const dirpath = window.window_nav_history[win_id].at(window.window_nav_history_current_position[win_id] - 1);
                UIWindow({
                    path: dirpath,
                    title: dirpath === '/' ? window.root_dirname : path.basename(dirpath),
                    icon: window.icons['folder.svg'],
                    // uid: $(el_item).attr('data-uid'),
                    is_dir: true,
                });
            }
            // ... otherwise, open in same window
            else{
                window.window_nav_history_current_position[win_id] > 0 && window.window_nav_history_current_position[win_id]--;
                const new_path = window.window_nav_history[win_id].at(window.window_nav_history_current_position[win_id]);
                // update window path
                window.update_window_path(el_window, new_path);
            }
        })
        // --------------------------------------------------------
        // Back button click-hold
        // --------------------------------------------------------
        $(el_window_navbar_back_btn).on('taphold', function() {
            let items = [];
            const pos = el_window_navbar_back_btn.getBoundingClientRect();

            for(let index = window.window_nav_history_current_position[win_id] - 1; index >= 0; index--){
                const history_item = window.window_nav_history[win_id].at(index);

                // build item for context menu
                items.push({
                    html: `<span>${history_item === window.home_path ? i18n('home') : path.basename(history_item)}</span>`,
                    val: index,
                    onClick: async function(e){
                        let history_index = e.value;
                        window.window_nav_history_current_position[win_id] = history_index;
                        const new_path = window.window_nav_history[win_id].at(window.window_nav_history_current_position[win_id]);
                        // if ctrl/cmd are pressed, open in new window
                        if(e.ctrlKey || e.metaKey && (new_path !== undefined && new_path !== null)){
                            UIWindow({
                                path: new_path,
                                title: new_path === '/' ? window.root_dirname : path.basename(new_path),
                                icon: window.icons['folder.svg'],
                                is_dir: true,
                            });
                        }
                        // update window path
                        else{
                            window.update_window_path(el_window, new_path);
                        }
                    }
                })
            }

            // Menu
            UIContextMenu({
                position: {top: pos.top + pos.height + 3, left: pos.left},
                parent_element: el_window_navbar_back_btn,
                items: items,
            })
        })
        // --------------------------------------------------------
        // Forward button
        // --------------------------------------------------------
        $(el_window_navbar_forward_btn).on('click', function(e){
            // if history menu is open don't continue
            if($(el_window_navbar_forward_btn).hasClass('has-open-contextmenu'))
                return;
            // if ctrl/cmd are pressed, open in new window
            if(e.ctrlKey || e.metaKey){
                const dirpath = window.window_nav_history[win_id].at(window.window_nav_history_current_position[win_id] + 1);
                UIWindow({
                    path: dirpath,
                    title: dirpath === '/' ? window.root_dirname : path.basename(dirpath),
                    icon: window.icons['folder.svg'],
                    // uid: $(el_item).attr('data-uid'),
                    is_dir: true,
                });
            }
            // ... otherwise, open in same window
            else{
                window.window_nav_history_current_position[win_id]++;
                // get last path in history
                const target_path = window.window_nav_history[win_id].at(window.window_nav_history_current_position[win_id]);
                // update window path
                if(target_path !== undefined){
                    window.update_window_path(el_window, target_path);
                }
            }
        })
        // --------------------------------------------------------
        // forward button click-hold
        // --------------------------------------------------------
        $(el_window_navbar_forward_btn).on('taphold', function() {
            let items = [];
            const pos = el_window_navbar_forward_btn.getBoundingClientRect();

            for(let index = window.window_nav_history_current_position[win_id] + 1; index < window.window_nav_history[win_id].length; index++){
                const history_item = window.window_nav_history[win_id].at(index);

                // build item for context menu
                items.push({
                    html: `<span>${history_item === window.home_path ? 'Home' : path.basename(history_item)}</span>`,
                    val: index,
                    onClick: async function(e){
                        let history_index = e.value;
                        window.window_nav_history_current_position[win_id] = history_index;
                        const new_path = window.window_nav_history[win_id].at(window.window_nav_history_current_position[win_id]);
                        // if ctrl/cmd are pressed, open in new window
                        if(e.ctrlKey || e.metaKey && (new_path !== undefined && new_path !== null)){
                            UIWindow({
                                path: new_path,
                                title: new_path === '/' ? window.root_dirname : path.basename(new_path),
                                icon: window.icons['folder.svg'],
                                is_dir: true,
                            });
                        }
                        // update window path
                        else{
                            window.update_window_path(el_window, new_path);
                        }
                    }
                })
            }

            // Menu
            UIContextMenu({                    
                parent_element: el_window_navbar_forward_btn,
                position: {top: pos.top + pos.height + 3, left: pos.left},
                items: items,
            })
        })

        // --------------------------------------------------------
        // Up button
        // --------------------------------------------------------
        $(el_window_navbar_up_btn).on('click', function(e){
            const target_path = path.resolve(path.join($(el_window).attr('data-path'), '..'));
            // if ctrl/cmd are pressed, open in new window
            if(e.ctrlKey || e.metaKey && (target_path !== undefined && target_path !== null)){
                UIWindow({
                    path: target_path,
                    title: target_path === '/' ? window.root_dirname : path.basename(target_path),
                    icon: window.icons['folder.svg'],
                    // uid: $(el_item).attr('data-uid'),
                    is_dir: true,
                });
            }
            // ... otherwise, open in same window
            else if(target_path !== undefined && target_path !== null){
                // update history
                window.window_nav_history[win_id] = window.window_nav_history[win_id].slice(0, window.window_nav_history_current_position[win_id]+1);
                window.window_nav_history[win_id].push(target_path);
                window.window_nav_history_current_position[win_id]++;
                // update window path
                window.update_window_path(el_window, target_path);
            }
        })

        const layouts = ['icons', 'list', 'details'];

        $(el_window).find('.window-navbar-layout-settings').on('contextmenu taphold', function() {
            let cur_layout = $(el_window).attr('data-layout');
            let items = [];
            for(let i=0; i<layouts.length; i++){
                items.push({
                    html: `<span style="text-transform: capitalize;">${layouts[i]}</span>`,
                    icon: cur_layout === layouts[i] ? '✓' : '',
                    onClick: async function(e){
                        window.update_window_layout(el_window, layouts[i]);
                        window.set_layout($(el_window).attr('data-uid'), layouts[i]);
                    }
                })
            }
            UIContextMenu({
                parent_element: this,
                items: items,
            })
        })
        $(el_window).find('.window-navbar-layout-settings').on('click', function() {
            let cur_layout = $(el_window).attr('data-layout');
            for(let i=0; i<layouts.length; i++){
                if(cur_layout === layouts[i]){
                    if(i === layouts.length - 1){
                        window.update_window_layout(el_window, layouts[0]);
                        window.set_layout($(el_window).attr('data-uid'), layouts[0]);
                    }else{
                        window.update_window_layout(el_window, layouts[i+1]);
                        window.set_layout($(el_window).attr('data-uid'), layouts[i+1]);
                    }
                    break;
                }
            }
        })
        // --------------------------------------------------------
        // directory content
        // --------------------------------------------------------
        //auth
        if(!window.is_auth() && !(await UIWindowLogin()))
            return;

        // --------------------------------------------------------
        // SIDEBAR sharing
        // --------------------------------------------------------
        if(options.is_dir && !isMobile.phone){
            puter.fs.readdir('/').then(function(shared_users){
                let ht = '';
                if(shared_users && shared_users.length - 1 > 0){
                    ht += `<h2 class="window-sidebar-title disable-user-select">Shared with me</h2>`;
                    for (let index = 0; index < shared_users.length; index++) {
                        const shared_user = shared_users[index];
                        // don't show current user's folder!
                        if(shared_user.name === window.user.username)
                            continue;
                            ht += `<div  class="window-sidebar-item not-sortable disable-user-select ${options.path === shared_user.path ? 'window-sidebar-item-active' : ''}" 
                                    data-path="${shared_user.path}"
                                    data-sharing-username="${html_encode(shared_user.name)}"
                                    title="${html_encode(shared_user.name)}"
                                    data-is_shared="1">
                                        <img class="window-sidebar-item-icon" src="${html_encode(window.icons['shared-outline.svg'])}">${shared_user.name}
                                    </div>`;
                    }
                }
                $(el_window).find('.window-sidebar').append(ht);

                $(el_window).find('.window-sidebar-item:not(.ui-droppable)').droppable({
                    accept: '.item',
                    tolerance: 'pointer',
                    drop: function( event, ui ) {
                        // check if item was actually dropped on this navbar path
                        if($(window.mouseover_window).attr('data-id') !== $(el_window).attr('data-id')){
                            return;
                        }
                        const items_to_share = []
                        
                        // first item
                        items_to_share.push({
                            uid: $(ui.draggable).attr('data-uid'),
                            path: $(ui.draggable).attr('data-path'),
                            icon: $(ui.draggable).find('.item-icon img').attr('src'),
                            name: $(ui.draggable).find('.item-name').text(),
                        }); 
                        
                        // all subsequent items
                        const cloned_items = document.getElementsByClassName('item-selected-clone');
                        for(let i =0; i<cloned_items.length; i++){
                            const source_item = document.getElementById('item-' + $(cloned_items[i]).attr('data-id'));
                            if(!source_item) continue;
                            items_to_share.push({
                                uid: $(source_item).attr('data-uid'),
                                path: $(source_item).attr('data-path'),
                                icon: $(source_item).find('.item-icon img').attr('src'),
                                name: $(source_item).find('.item-name').text(),
                            })
                        }
            
                        // if alt key is down, create shortcut items
                        if(event.altKey){
                            items_to_share.forEach((item_to_move) => {
                                window.create_shortcut(
                                    path.basename($(item_to_move).attr('data-path')), 
                                    $(item_to_move).attr('data-is_dir') === '1', 
                                    $(this).attr('data-path'), 
                                    null, 
                                    $(item_to_move).attr('data-shortcut_to') === '' ? $(item_to_move).attr('data-uid') : $(item_to_move).attr('data-shortcut_to'),
                                    $(item_to_move).attr('data-shortcut_to_path') === '' ? $(item_to_move).attr('data-path') : $(item_to_move).attr('data-shortcut_to_path'),
                                );
                            });
                        }
                        // move items
                        else{
                            UIWindowShare(items_to_share, $(this).attr('data-sharing-username'));
                        }
            
                        $('.item-container').droppable('enable')
                        $(this).removeClass('window-sidebar-item-drag-active');
            
                        return false;
                    },
                    over: function(event, ui){
                        // check if item was actually hovered over this window
                        if($(window.mouseover_window).attr('data-id') !== $(el_window).attr('data-id'))
                            return;
            
                        // Don't do anything if the dragged item is NOT a UIItem
                        if(!$(ui.draggable).hasClass('item'))
                            return;
                        
                        // highlight this item
                        $(this).addClass('window-sidebar-item-drag-active');
                        $('.ui-draggable-dragging').css('opacity', 0.2)
                        $('.item-selected-clone').css('opacity', 0.2)
            
                        // disable all window bodies 
                        $('.item-container').droppable( 'disable' )
                    },
                    out: function(event, ui){
                        // Don't do anything if the dragged element is NOT a UIItem
                        if(!$(ui.draggable).hasClass('item'))
                            return;
                        
                        // unselect item if item is dragged out
                        $(this).removeClass('window-sidebar-item-drag-active');
                        $('.ui-draggable-dragging').css('opacity', 'initial')
                        $('.item-selected-clone').css('opacity', 'initial')
            
                        $('.item-container').droppable( 'enable' )    
                    }
                });
            }).catch(function(err){
                console.error(err);
            })
        }

        // get directory content
        refresh_item_container(el_window_body, options);
    }

    // set iframe url
    if (options.iframe_url){
        $(el_window_app_iframe).attr('src', options.iframe_url)
        //bring focus to iframe
        el_window_app_iframe.contentWindow.focus();
    }
    // set the position of window
    if(!options.is_maximized){
        $(el_window).css('top', options.top)
        $(el_window).css('left', options.left)
    }
    if ( options.is_visible ) {
        $(el_window).css('display', 'block');
    }

    // mousedown on the window body will unselect selected items if neither ctrl nor command are pressed
    $(el_window_body).on('mousedown', function(e){
        if($(e.target).hasClass('window-body') && !e.ctrlKey && !e.metaKey){
            $(el_window_body).find('.item-selected').removeClass('item-selected');
            window.update_explorer_footer_selected_items_count(el_window);
            // if this is openFileDialog, disable the Open button
            if(options.is_openFileDialog)
                $(el_openfiledialog_open_btn).addClass('disabled')
        }
    })

    // on_close event
    $(el_window).on('remove', function(e){
        // if on_close callback is set, call it
        options.on_close?.();
    })

    // --------------------------------------------------------
    // Backdrop click
    // --------------------------------------------------------
    if(options.backdrop && options.close_on_backdrop_click){
        $(el_window).closest('.window-backdrop').on('mousedown', function(e){
            if($(e.target).hasClass('window-backdrop')){
                $(el_window).close();
            }
        })
    }
    // --------------------------------------------------------
    // Selectable
    // only for Desktop screens
    // --------------------------------------------------------
    if(options.is_dir && options.selectable_body && !isMobile.phone && !isMobile.tablet){
        let selected_ctrl_items = [];
        // init viselect
        const selection = new SelectionArea({
            selectionContainerClass: '.selection-area-container',
            container: `#window-body-${win_id}`,
            selectables: [`#window-body-${win_id} .item`],
            startareas: [`#window-body-${win_id}`],
            boundaries: [`#window-body-${win_id}`],
            behaviour: {
                overlap: 'drop',
                intersect: 'touch',
                startThreshold: 10,
                scrolling: {
                    speedDivider: 10,
                    manualSpeed: 750,
                    startScrollMargins: {x: 0, y: 0}
                }
            },
            features: {
                touch: true,
                range: true,
                singleTap: {
                    allow: true,
                    intersect: 'native'
                }
            }
        });
        
        selection.on('beforestart', ({store, event}) => {
            selected_ctrl_items = [];
            return $(event.target).is(`#window-body-${win_id}`)
        })
        .on('beforedrag', evt => {
        })
        .on('start', ({store, event}) => {
            if (!event.ctrlKey && !event.metaKey) {
        
                for (const el of store.stored) {
                    el.classList.remove('item-selected');
                }
        
                selection.clearSelection();
            }
        })
        .on('move', ({store: {changed: {added, removed}}, event}) => {
            for (const el of added) {
                // if ctrl or meta key is pressed and the item is already selected, then unselect it
                if((event.ctrlKey || event.metaKey) && $(el).hasClass('item-selected')){
                    el.classList.remove('item-selected');
                    selected_ctrl_items.push(el);
                }
                // otherwise select it
                else{
                    el.classList.add('item-selected');
                    // the latest selected item is the active element
                    window.active_element = el;
                }
            }
        
            for (const el of removed) {
                el.classList.remove('item-selected');
                // in case this item was selected by ctrl+click before, then reselect it again
                if(selected_ctrl_items.includes(el))
                    $(el).addClass('item-selected');
            }

            window.update_explorer_footer_selected_items_count(el_window);

            // If this is openFileDialog, enable/disable the Open button accordingly
            if(options.is_openFileDialog && $(el_window).find('.item-selected').length)
                $(el_openfiledialog_open_btn).removeClass('disabled')
            else
                $(el_openfiledialog_open_btn).addClass('disabled')
        })
        .on('stop', ({store, event}) => {
            // If this is openFileDialog, enable/disable the Open button accordingly
            if(options.is_openFileDialog && $(el_window).find('.item-selected').length)
                $(el_openfiledialog_open_btn).removeClass('disabled')
            else
                $(el_openfiledialog_open_btn).addClass('disabled')
        });   
    }

    // --------------------------------------------------------
    // Droppable
    // --------------------------------------------------------
    $(el_window_body).droppable({
        accept: '.item',
        greedy: true,
        tolerance: "pointer",
        drop: async function( e, ui ) {
            // check if item was actually dropped on this window
            if($(window.mouseover_window).attr('data-id') !== $(el_window).attr('data-id'))
                return;

            // can't drop anything here but a UIItem
            if(!$(ui.draggable).hasClass('item'))
                return;

            // --------------------------------------------------
            // In case this was dropped on an App window
            // --------------------------------------------------
            if(el_window_app_iframe !== null){
                const items_to_move = []

                // first item
                items_to_move.push(ui.draggable); 

                // all subsequent items
                const cloned_items = document.getElementsByClassName('item-selected-clone');
                for(let i =0; i<cloned_items.length; i++){
                    const source_item = document.getElementById('item-' + $(cloned_items[i]).attr('data-id'));
                    if(source_item !== null)
                        items_to_move.push(source_item);
                }

                // sign all items
                const items_to_sign = []

                // prepare items to sign
                for(let i=0; i<items_to_move.length; i++)
                    items_to_sign.push({uid: $(items_to_move[i]).attr('data-uid'), action: 'write', path: $(items_to_move[i]).attr('data-path')});

                // sign items
                let signatures = await puter.fs.sign(options.app_uuid, items_to_sign);
                signatures = signatures.items;
                signatures = Array.isArray(signatures) ? signatures : [signatures];

                // prepare items
                let items = [];
                for (let index = 0; index < signatures.length; index++) {
                    const item = signatures[index];
                    items.push({
                        name: item.fsentry_name,
                        readURL: item.read_url,
                        writeURL: item.write_url,
                        metadataURL: item.metadata_url,
                        isDirectory: item.fsentry_is_dir,
                        path: privacy_aware_path(item.path),
                        uid: item.uid,
                    })
                }
                
                // send to app iframe
                el_window_app_iframe.contentWindow.postMessage({
                    msg: "itemsOpened", 
                    original_msg_id: $(el_window).attr('data-iframe_msg_uid'), 
                    items: items,
                }, '*');

                // if item is dragged over an app iframe, highlight the iframe
                var rect = el_window_app_iframe.getBoundingClientRect();

                // if mouse is inside iframe, send drag message to iframe
                el_window_app_iframe.contentWindow.postMessage({msg: "drop", x: (window.mouseX - rect.left), y: (window.mouseY - rect.top), items: items}, '*');

                // bring focus to this window
                $(el_window).focusWindow();
            }

            // if this window is not a directory, cancel drop.
            // why not simply only launch droppable on directories? this is because 
            // if a window is not droppable and an item is dropped on it, the app will think
            // it was dropped on desktop.
            if(!options.is_dir){
                return false;
            }
            // If dropped on the same window, do not proceed
            if($(ui.draggable).closest('.item-container').attr('data-path') === $(window.mouseover_window).attr('data-path') && !e.ctrlKey){
                return;
            }
            // If ctrl is pressed and source is Trashed, cancel whole operation
            if(e.ctrlKey && path.dirname($(ui.draggable).attr('data-path')) === window.trash_path)
                return;

            // Unselect already selected items
            $(el_window_body).find('.item-selected').removeClass('item-selected')

            const items_to_move = []

            // first item
            items_to_move.push(ui.draggable); 

            // all subsequent items
            const cloned_items = document.getElementsByClassName('item-selected-clone');
            for(let i =0; i<cloned_items.length; i++){
                const source_item = document.getElementById('item-' + $(cloned_items[i]).attr('data-id'));
                if(source_item !== null){
                    items_to_move.push(source_item);
                }
            }

            // --------------------------------------------------------
            // if this is the home directory of another user, show the sharing dialog
            // --------------------------------------------------------
            let cur_path = $(el_window).attr('data-path');
            if(window.countSubstr(cur_path, '/') === 1 && cur_path !== '/'+window.user.username){
                let username = cur_path.split('/')[1];

                const items_to_share = []
                        
                // first item
                items_to_share.push({
                    uid: $(ui.draggable).attr('data-uid'),
                    path: $(ui.draggable).attr('data-path'),
                    icon: $(ui.draggable).find('.item-icon img').attr('src'),
                    name: $(ui.draggable).find('.item-name').text(),
                }); 
                
                // all subsequent items
                const cloned_items = document.getElementsByClassName('item-selected-clone');
                for(let i =0; i<cloned_items.length; i++){
                    const source_item = document.getElementById('item-' + $(cloned_items[i]).attr('data-id'));
                    if(!source_item) continue;
                    items_to_share.push({
                        uid: $(source_item).attr('data-uid'),
                        path: $(source_item).attr('data-path'),
                        icon: $(source_item).find('.item-icon img').attr('src'),
                        name: $(source_item).find('.item-name').text(),
                    })
                }
    
                UIWindowShare(items_to_share, username);
                return;
            }

            // If ctrl key is down, copy items. Except if target is Trash
            if(e.ctrlKey && $(window.mouseover_window).attr('data-path') !== window.trash_path){
                // Copy items
                window.copy_items(items_to_move, $(window.mouseover_window).attr('data-path'))
            }

            // if alt key is down, create shortcut items
            else if(e.altKey){
                items_to_move.forEach((item_to_move) => {
                    window.create_shortcut(
                        path.basename($(item_to_move).attr('data-path')), 
                        $(item_to_move).attr('data-is_dir') === '1', 
                        $(window.mouseover_window).attr('data-path'),
                        null, 
                        $(item_to_move).attr('data-shortcut_to') === '' ? $(item_to_move).attr('data-uid') : $(item_to_move).attr('data-shortcut_to'),
                        $(item_to_move).attr('data-shortcut_to_path') === '' ? $(item_to_move).attr('data-path') : $(item_to_move).attr('data-shortcut_to_path'),
                    );
                });
            }
            // otherwise, move items
            else{
                window.move_items(items_to_move, $(window.mouseover_window).attr('data-path'));
            }
        },
        over: function(event, ui){
            // Don't do anything if the dragged item is NOT a UIItem
            if(!$(ui.draggable).hasClass('item'))
                return;
        },
        out: function(event, ui){
            // Don't do anything if the dragged item is NOT a UIItem
            if(!$(ui.draggable).hasClass('item'))
                return;
        }
    });

    // --------------------------------------------------------
    // Double Click on Head
    // double click on a window head will maximize or shrink window
    // only maximize/shrink if window is marked `is_resizable`
    // --------------------------------------------------------
    if(options.is_resizable){
        $(el_window_head).dblclick(function () {
            window.scale_window(el_window);
        })
    }

    $(el_window_head).mousedown(function () {
        if(window_is_snapped){
            $( el_window ).draggable( "option", "cursorAt", { left: width_before_snap/2 } );
        }
    })

    // --------------------------------------------------------
    // Click On The `Scale` Button 
    // (the little rectangle in the window head)
    // --------------------------------------------------------
    if(options.is_resizable){
        $(el_window_head_scale_btn).click(function () {
            window.scale_window(el_window);
        })
    }

    // --------------------------------------------------------
    // Dragster
    // If a local item is dragged over this window, bring it to front
    // --------------------------------------------------------
    let drag_enter_timeout;
    $(el_window).dragster({
        enter: function (dragsterEvent, event) {
            // make sure to cancel any previous timeouts otherwise the window will be brought to front multiple times
            clearTimeout(drag_enter_timeout);
            // If items are dragged over this window long enough, bring it to front
            drag_enter_timeout = setTimeout(function(){
                // focus window
                $(el_window).focusWindow();
            }, 1400);
        },
        leave: function (dragsterEvent, event) {
            // cancel the timeout for 'bringing window to front'
            clearTimeout(drag_enter_timeout);
        },
        drop: function (dragsterEvent, event) {
            // cancel the timeout for 'bringing window to front'
            clearTimeout(drag_enter_timeout);
        },
        over: function (dragsterEvent, event) {
            // cancel the timeout for 'bringing window to front'
            clearTimeout(drag_enter_timeout);
        }
    });

    // --------------------------------------------------------
    // Dragster
    // Allow dragging of local files onto this window, if it's is_dir
    // --------------------------------------------------------
    $(el_window_body).dragster({
        enter: function (dragsterEvent, event) {
            if(options.is_dir){
                // remove any context menu that might be open
                $('.context-menu').remove();
            
                // highlight this item container
                $(el_window).find('.item-container').addClass('item-container-active');
            }
        },
        leave: function (dragsterEvent, event) {
            if(options.is_dir){
                $(el_window).find('.item-container').removeClass('item-container-active');
            }
        },
        drop: function (dragsterEvent, event) {
            const e = event.originalEvent;
            if(options.is_dir){
                // if files were dropped...
                if(e.dataTransfer?.items?.length>0){
                    window.upload_items(e.dataTransfer.items, $(el_window).attr('data-path'))
                }
                // de-highlight all windows
                $('.item-container').removeClass('item-container-active');
            }
            e.stopPropagation();
            e.preventDefault();
            return false;
        }
    });
    
    // --------------------------------------------------------
    // Close button
    // --------------------------------------------------------
    $(`#window-${win_id} > .window-head > .window-close-btn`).click(function () {
        $(el_window).close({
            shrink_to_target: options.on_close_shrink_to_target
        });
    })

    // --------------------------------------------------------
    // Minimize button
    // --------------------------------------------------------
    $(`#window-${win_id} > .window-head > .window-minimize-btn`).click(function () {
        $(el_window).hideWindow();
    })

    // --------------------------------------------------------
    // Draggable
    // --------------------------------------------------------
    let width_before_snap = 0;
    let height_before_snap = 0;
    let window_is_snapped = false;
    let snap_placeholder_active = false;
    let snap_trigger_timeout;

    if(options.is_draggable){
        let window_snap_placeholder = $(
            `<div class="window-snap-placeholder animate__animated animate__zoomIn animate__faster">
                <div class="window-snap-placeholder-inner"></div>
             </div>`
        );

        $(el_window).draggable({
            start: function(e, ui){
                window.a_window_is_being_dragged = true;
                // if window is snapped, unsnap it and reset its position to where it was before snapping
                if(options.is_resizable && window_is_snapped){
                    window_is_snapped = false;
                    $(el_window).css({
                        'width': width_before_snap,
                        'height': height_before_snap + 'px',
                    });

                    // if at any point the window's width is "too small", hide the sidebar
                    if($(el_window).width() < window.window_width_threshold_for_sidebar){
                        if(width_before_snap >= window.window_width_threshold_for_sidebar && !sidebar_hidden){
                            $(el_window_sidebar).hide();
                        }
                        sidebar_hidden = true;
                    }
                    // if at any point the window's width is "big enough", show the sidebar
                    else if($(el_window).width() >= window.window_width_threshold_for_sidebar){
                        if(sidebar_hidden){
                            $(el_window_sidebar).show();
                        }
                        sidebar_hidden = false;
                    }
                }

                $(el_window).addClass('window-dragging');
                
                // rm window from original_window_position
                window.original_window_position[$(el_window).attr('id')] = undefined;

                // since jquery draggable sets the z-index automatically we need this to 
                // bring windows to the front when they are clicked.
                window.last_window_zindex = parseInt($(el_window).css('z-index'));

                //transform causes draggable to start inaccurately
                $(el_window).css('transform', 'none');
            },
            drag: function ( e, ui ) {
                $(el_window_app_iframe).css('pointer-events', 'none');
                $('.window').css('pointer-events', 'none');
                // jqueryui changes the z-index automatically, if the stay_on_top flag is set
                // make sure window stays on top
                $(`.window[data-stay_on_top="true"]`).css('z-index', 999999999)

                if($(el_window).attr('data-is_maximized') === '1'){
                    $(el_window).attr('data-is_maximized', '0');
                    // maximize icon
                    $(el_window_head_scale_btn).find('img').attr('src', window.icons['scale.svg']);
                }
                // --------------------------------------------------------
                // Snap to screen edges
                // --------------------------------------------------------
                if(options.is_resizable){
                    clearTimeout(snap_trigger_timeout);
                    // if window is not snapped, check if it should be snapped
                    snap_trigger_timeout = setTimeout(function(){
                        // if cursor is not in a snap zone, don't snap
                        if(!window.current_active_snap_zone){
                            return;
                        }
                        // if dragging has stopped by now, don't snap
                        if(!$(el_window).hasClass('window-dragging')){
                            return;
                        }

                        // W
                        if(!window_is_snapped && window.current_active_snap_zone === 'w'){
                            window_snap_placeholder.css({
                                'display': 'block',
                                'width': '50%',
                                'height': window.desktop_height,
                                'top': window.toolbar_height,
                                'left': 0,
                                'z-index': window.last_window_zindex - 1,
                            })
                        }
                        // NW
                        else if(!window_is_snapped && window.current_active_snap_zone === 'nw'){
                            window_snap_placeholder.css({
                                'display': 'block',
                                'width': '50%',
                                'height': window.desktop_height/2,
                                'top': window.toolbar_height,
                                'left': 0,
                                'z-index': window.last_window_zindex - 1,
                            })
                        }
                        // NE
                        else if(!window_is_snapped && window.current_active_snap_zone ==='ne'){
                            window_snap_placeholder.css({
                                'display': 'block',
                                'width': '50%',
                                'height': window.desktop_height/2,
                                'top': window.toolbar_height,
                                'left': window.desktop_width/2,
                                'z-index': window.last_window_zindex - 1,
                            })
                        }
                        // E
                        else if(!window_is_snapped && window.current_active_snap_zone ==='e'){
                            window_snap_placeholder.css({
                                'display': 'block',
                                'width': '50%',
                                'height': window.desktop_height,
                                'top': window.toolbar_height,
                                'left': 'initial',
                                'right': 0,
                                'z-index': window.last_window_zindex - 1,
                            })
                        }
                        // N
                        else if(!window_is_snapped && window.current_active_snap_zone ==='n'){
                            window_snap_placeholder.css({
                                'display': 'block',
                                'width': window.desktop_width,
                                'height': window.desktop_height,
                                'top': window.toolbar_height,
                                'left': 0,
                                'z-index': window.last_window_zindex - 1,
                            })
                        }
                        // SW
                        else if(!window_is_snapped && window.current_active_snap_zone ==='sw'){
                            window_snap_placeholder.css({
                                'display': 'block',
                                'top': window.toolbar_height + window.desktop_height/2,
                                'left': 0,
                                'width': '50%',
                                'height': window.desktop_height/2,
                                'z-index': window.last_window_zindex - 1,
                            })
                        }
                        // SE
                        else if(!window_is_snapped && window.current_active_snap_zone ==='se'){
                            window_snap_placeholder.css({
                                'display': 'block',
                                'top': window.toolbar_height + window.desktop_height/2,
                                'left': window.desktop_width/2,
                                'width': '50%',
                                'height': window.desktop_height/2,
                                'z-index': window.last_window_zindex - 1,
                            })
                        }

                        // If snap placeholder is not active, append it and make it active
                        if(!window_is_snapped && !snap_placeholder_active){
                            snap_placeholder_active = true;
                            $(el_body).append(window_snap_placeholder);
                        }

                        // save window size before snap
                        width_before_snap = $(el_window).width();
                        height_before_snap = $(el_window).height();
                    }, 500);

                    // if mouse is not in a snap zone, hide snap placeholder
                    if(snap_placeholder_active && !window.current_active_snap_zone){
                        snap_placeholder_active = false;
                        window_snap_placeholder.fadeOut(80);
                    }
                }
            },
            stop: function () {
                window.a_window_is_being_dragged = false;
                let window_will_snap = false;
                $( el_window ).draggable( "option", "cursorAt", false );

                $(el_window).removeClass('window-dragging');
                $(el_window).attr({
                    'data-orig-top': $(el_window).position().top, 
                    'data-orig-left': $(el_window).position().left, 
                })
    
                $(el_window_app_iframe).css('pointer-events', 'all');
                $('.window').css('pointer-events', 'initial');

                // jqueryui changes the z-index automatically, if the stay_on_top flag is set
                // make sure window stays on top with the initial zindex though
                $(`.window[data-stay_on_top="true"]`).each(function(){
                    $(this).css('z-index', $(this).attr('data-initial_zindex'))
                })

                if(options.is_resizable && snap_placeholder_active && !window_is_snapped){
                    window_will_snap = true;
                    $(window_snap_placeholder).css('padding', 0);

                    setTimeout(function(){
                        // snap to w
                        if(window.current_active_snap_zone === 'w'){
                            $(el_window).css({
                                'top': window.toolbar_height,
                                'left': 0,
                                'width': '50%',
                                'height': window.desktop_height - 6,
                            })
                        }
                        // snap to nw
                        else if(window.current_active_snap_zone === 'nw'){
                            $(el_window).css({
                                'top': window.toolbar_height,
                                'left': 0,
                                'width': '50%',
                                'height': window.desktop_height/2,
                            })
                        }
                        // snap to ne
                        else if(window.current_active_snap_zone === 'ne'){
                            $(el_window).css({
                                'top': window.toolbar_height,
                                'left': '50%',
                                'width': '50%',
                                'height': window.desktop_height/2,
                            })
                        }
                        // snap to sw
                        else if(window.current_active_snap_zone === 'sw'){
                            $(el_window).css({
                                'top': window.toolbar_height + window.desktop_height/2,
                                'left': 0,
                                'width': '50%',
                                'height': window.desktop_height/2,
                            })
                        }
                        // snap to se
                        else if(window.current_active_snap_zone === 'se'){
                            $(el_window).css({
                                'top': window.toolbar_height + window.desktop_height/2,
                                'left': window.desktop_width/2,
                                'width': '50%',
                                'height': window.desktop_height/2,
                            })
                        }
                        // snap to e
                        else if(window.current_active_snap_zone === 'e'){
                            $(el_window).css({
                                'top': window.toolbar_height,
                                'left': '50%',
                                'width': '50%',
                                'height': window.desktop_height - 6,
                            })
                        }
                        // snap to n
                        else if(window.current_active_snap_zone === 'n'){
                            window.scale_window(el_window);
                        }
                        // snap placeholder is no longer active
                        snap_placeholder_active = false;
                        // hide snap placeholder
                        window_snap_placeholder.css('display', 'none');
                        window_snap_placeholder.css('padding', '10px');
                        // mark window as snapped
                        window_is_snapped = true;

                        // if at any point the window's width is "too small", hide the sidebar
                        if($(el_window).width() < window.window_width_threshold_for_sidebar){
                            if(width_before_snap >= window.window_width_threshold_for_sidebar && !sidebar_hidden){
                                $(el_window_sidebar).hide();
                            }
                            sidebar_hidden = true;
                        }
                        // if at any point the window's width is "big enough", show the sidebar
                        else if($(el_window).width() >= window.window_width_threshold_for_sidebar){
                            if(sidebar_hidden){
                                $(el_window_sidebar).show();
                            }
                            sidebar_hidden = false;
                        }
                    }, 100);
                }

                // if window is dropped below the taskbar, move it up
                // the lst '- 30' is to account for the window head
                if($(el_window).position().top > window.innerHeight - window.taskbar_height - 30 && !window_will_snap){
                    $(el_window).animate({
                        top: window.innerHeight - window.taskbar_height - 60,
                    }, 100);
                }
                // if window is dropped too far to the right, move it left
                if($(el_window).position().left > window.innerWidth - 50 && !window_will_snap){
                    $(el_window).animate({
                        left: window.innerWidth - 50,
                    }, 100);
                }
                // if window is dropped too far to the left, move it right
                if(($(el_window).position().left + $(el_window).width() - 150 )< 0 && !window_will_snap){
                    $(el_window).animate({
                        left: -1 * ($(el_window).width() - 150),
                    }, 100);
                }
            },
            handle: `.window-head-draggable` + (options.draggable_body ? `, .window-body` : ``),
            stack: `.window`,
            scroll: false,
            containment: '.window-container',
        });
    }

    // --------------------------------------------------------
    // Resizable
    // --------------------------------------------------------
    if(options.is_resizable){
        if($(el_window).width() < window.window_width_threshold_for_sidebar){
            $(el_window_sidebar).hide();
            sidebar_hidden = true;
        }

        $(el_window).resizable({
            handles: "n, ne, nw, e, s, se, sw, w",
            minWidth: 200,
            minHeight: 200,
            start: function(){
                window.a_window_is_resizing = true;
                $(el_window_app_iframe).css('pointer-events', 'none');
                $('.window').css('pointer-events', 'none');
            },
            resize: function (e, ui) {
                // if at any point the window's width is "too small", hide the sidebar
                if(ui.size.width < window.window_width_threshold_for_sidebar){
                    if(ui.originalSize.width >= window.window_width_threshold_for_sidebar && !sidebar_hidden){
                        $(el_window_sidebar).hide();
                    }
                    sidebar_hidden = true;
                }
                // if at any point the window's width is "big enough", show the sidebar
                else if(ui.size.width >= window.window_width_threshold_for_sidebar){
                    if(sidebar_hidden){
                        $(el_window_sidebar).show();
                    }
                    sidebar_hidden = false;
                }

                // when resizing the top of the window, make sure the window head is not hidden behind the toolbar
                if($(el_window).position().top < window.toolbar_height){
                    var difference = window.toolbar_height - $(el_window).position().top;
                    $(el_window).css({
                        'top': window.toolbar_height,
                        'height': ui.size.height - difference  // Reduce the height by the difference
                    });
                    // don't resize
                    return false;
                }
            },
            stop: function () {
                window.a_window_is_resizing = false;
                $(el_window_app_iframe).css('pointer-events', 'all');
                $('.window').css('pointer-events', 'initial');
                $(el_window_sidebar).resizable("option", "maxWidth", el_window.getBoundingClientRect().width/2);
                $(el_window).attr({
                    'data-orig-width': $(el_window).width(), 
                    'data-orig-height': $(el_window).height(), 
                })
                // maximize icon
                $(el_window_head_scale_btn).find('img').attr('src', window.icons['scale.svg']);
                $(el_window).attr('data-is_maximized', '0');
            },
            containment: 'parent',
        })
    }

    // --------------------------------------------------------
    // Sidebar Resizable
    // --------------------------------------------------------
    let side = $(el_window).find('.window-sidebar')
    side.resizable({
        handles: "e,w",
        minWidth: 100,
        maxWidth: el_window.getBoundingClientRect().width/2,
        start: function(){
            $(el_window_app_iframe).css('pointer-events', 'none');
            $('.window').css('pointer-events', 'none');
            window.a_window_sidebar_is_resizing = true;
        },
        stop: function () {
            $(el_window_app_iframe).css('pointer-events', 'all');
            $('.window').css('pointer-events', 'initial');
            const new_width = $(el_window_sidebar).width();
            // save new width in the cloud, to user's settings
            puter.kv.set({key: "window_sidebar_width", value: new_width});
            // save new width locally, to window object
            window.window_sidebar_width = new_width;
            window.a_window_sidebar_is_resizing = false;
        }
    })

    // --------------------------------------------------------
    // Alt/Option + Shift + click on window head will open a prompt to enter iframe url
    // --------------------------------------------------------
    $(el_window_head).on('click', function(e){
        if(e.altKey && e.shiftKey && el_window_app_iframe !== null){
            let url = prompt("Enter URL", options.iframe_url);
            if(url){
                $(el_window_app_iframe).attr('src', url);
            }
        }
    })
    // --------------------------------------------------------
    // Head Context Menu
    // --------------------------------------------------------
    $(el_window_head).bind("contextmenu taphold", function (event) {
        // dimiss taphold on regular devices
        if(event.type==='taphold' && !isMobile.phone && !isMobile.tablet)
            return;

        const $target = $(event.target);

        // Cases in which native ctx menu should be preserved
        if(options.allow_native_ctxmenu || $target.hasClass('allow-native-ctxmenu') || $target.is('input') || $target.is('textarea'))
            return true;
        
        // custom ctxmenu for all other elements
        event.preventDefault();

        // If window has no head, don't show ctxmenu
        if(!options.has_head)
            return;
        
        let menu_items = [];
        // -------------------------------------------
        // Maximize/Minimize
        // -------------------------------------------
        if(options.is_resizable){
            menu_items.push({
                html: $(el_window).attr('data-is_maximized') === '0' ? 'Maximize' : 'Restore',
                onClick: function(){
                    // maximize window
                    window.scale_window(el_window);
                }
            });
            menu_items.push({
                html: 'Minimize',
                onClick: function(){
                    $(el_window).hideWindow();
                }
            });
            // -
            menu_items.push('-')
        }
        //-------------------------------------------
        // Reload App
        //-------------------------------------------
        if(el_window_app_iframe !== null){
            menu_items.push({
                html: 'Reload App',
                onClick: function(){
                    $(el_window_app_iframe).attr('src', $(el_window_app_iframe).attr('src'));
                }
            });
            // -
            menu_items.push('-')
        }
        // -------------------------------------------
        // Close
        // -------------------------------------------
        menu_items.push({
            html: 'Close',
            onClick: function(){
                $(el_window).close();
            }
        });

        UIContextMenu({
            parent_element: el_window_head,
            items: menu_items,
            parent_id: win_id,
        })                
    })

    // --------------------------------------------------------
    // Body Context Menu
    // --------------------------------------------------------
    $(el_window_body).bind("contextmenu taphold", function (event) {
        // dimiss taphold on regular devices
        if(event.type==='taphold' && !isMobile.phone && !isMobile.tablet)
            return;

        const $target = $(event.target);

        // Cases in which native ctx menu should be preserved
        if(options.allow_native_ctxmenu || $target.hasClass('allow-native-ctxmenu') || $target.is('input') || $target.is('textarea'))
            return true

        // custom ctxmenu for all other elements
        event.preventDefault();
        if(options.allow_context_menu && event.target === el_window_body){
            // Regular directories
            if($(el_window).attr('data-path') !== window.trash_path){
                UIContextMenu({
                    parent_element: el_window_body,
                    items: [
                        // -------------------------------------------
                        // Sort by
                        // -------------------------------------------
                        {
                            html: i18n('sort_by'),
                            items: [
                                {
                                    html: i18n('name'),
                                    icon: $(el_window).attr('data-sort_by') === 'name' ? '✓' : '',
                                    onClick: async function(){
                                        window.sort_items(el_window_body, 'name', $(el_window).attr('data-sort_order'));
                                        window.set_sort_by($(el_window).attr('data-uid'), 'name', $(el_window).attr('data-sort_order'))
                                    }
                                },
                                {
                                    html: i18n('date_modified'),
                                    icon: $(el_window).attr('data-sort_by') === 'modified' ? '✓' : '',
                                    onClick: async function(){
                                        window.sort_items(el_window_body, 'modified', $(el_window).attr('data-sort_order'));
                                        window.set_sort_by($(el_window).attr('data-uid'), 'modified', $(el_window).attr('data-sort_order'))
                                    }
                                },
                                {
                                    html: i18n('type'),
                                    icon: $(el_window).attr('data-sort_by') === 'type' ? '✓' : '',
                                    onClick: async function(){
                                        window.sort_items(el_window_body, 'type', $(el_window).attr('data-sort_order'));
                                        window.set_sort_by($(el_window).attr('data-uid'), 'type', $(el_window).attr('data-sort_order'))
                                    }
                                },
                                {
                                    html: i18n('size'),
                                    icon: $(el_window).attr('data-sort_by') === 'size' ? '✓' : '',
                                    onClick: async function(){
                                        window.sort_items(el_window_body, 'size', $(el_window).attr('data-sort_order'));
                                        window.set_sort_by($(el_window).attr('data-uid'), 'size', $(el_window).attr('data-sort_order'))
                                    }
                                },
                                // -------------------------------------------
                                // -
                                // -------------------------------------------
                                '-',
                                {
                                    html: i18n('ascending'),
                                    icon: $(el_window).attr('data-sort_order') === 'asc' ? '✓' : '',
                                    onClick: async function(){
                                        const sort_by = $(el_window).attr('data-sort_by')
                                        window.sort_items(el_window_body, sort_by, 'asc');
                                        window.set_sort_by($(el_window).attr('data-uid'), sort_by, 'asc')
                                    }
                                },
                                {
                                    html: i18n('descending'),
                                    icon: $(el_window).attr('data-sort_order') === 'desc' ? '✓' : '',
                                    onClick: async function(){
                                        const sort_by = $(el_window).attr('data-sort_by')
                                        window.sort_items(el_window_body, sort_by, 'desc');
                                        window.set_sort_by($(el_window).attr('data-uid'), sort_by, 'desc')
                                    }
                                },

                            ]
                        },
                        // -------------------------------------------
                        // Refresh
                        // -------------------------------------------
                        {
                            html: i18n('refresh'),
                            onClick: function(){
                                refresh_item_container(el_window_body, options);
                            }
                        },
                        // -------------------------------------------
                        // Show/Hide hidden files
                        // -------------------------------------------
                        {
                            html: i18n('show_hidden'),
                            icon: window.user_preferences.show_hidden_files ? '✓' : '',
                            onClick: function(){
                                window.mutate_user_preferences({
                                    show_hidden_files : !window.user_preferences.show_hidden_files,
                                });
                                window.show_or_hide_files(document.querySelectorAll('.item-container'));
                            }
                        },
                        // -------------------------------------------
                        // -
                        // -------------------------------------------
                        '-',
                        // -------------------------------------------
                        // New
                        // -------------------------------------------
                        new_context_menu_item($(el_window).attr('data-path'), el_window_body),
                        // -------------------------------------------
                        // -
                        // -------------------------------------------
                        '-',
                        // -------------------------------------------
                        // Paste
                        // -------------------------------------------
                        {
                            html: i18n('paste'),
                            disabled: (window.clipboard.length === 0 || $(el_window).attr('data-path') === '/') ? true : false,
                            onClick: function(){
                                if(window.clipboard_op === 'copy')
                                    window.copy_clipboard_items($(el_window).attr('data-path'), el_window_body);
                                else if(window.clipboard_op === 'move')
                                    window.move_clipboard_items(el_window_body)
                            }
                        },
                        // -------------------------------------------
                        // Undo
                        // -------------------------------------------
                        {
                            html: i18n('undo'),
                            disabled: window.actions_history.length > 0 ? false : true,
                            onClick: function(){
                                window.undo_last_action();
                            }
                        },
                        // -------------------------------------------
                        // Upload Here
                        // -------------------------------------------
                        {
                            html: i18n('upload_here'),
                            disabled: $(el_window).attr('data-path') === '/' ? true : false,
                            onClick: function(){
                                window.init_upload_using_dialog(el_window_body, $(el_window).attr('data-path') + '/');
                            }
                        },
                        // -------------------------------------------
                        // -
                        // -------------------------------------------
                        '-',
                        // -------------------------------------------
                        // Publish As Website
                        // -------------------------------------------
                        {
                            html: i18n('publish_as_website'),
                            disabled: !options.is_dir,
                            onClick: async function () {
                                if (window.require_email_verification_to_publish_website) {
                                    if (window.user.is_temp &&
                                        !await UIWindowSaveAccount({
                                            send_confirmation_code: true,
                                            message: i18n('save_account_to_publish'),
                                            window_options: {
                                                backdrop: true,
                                                close_on_backdrop_click: false,
                                            }
                                        }))
                                        return;
                                    else if (!window.user.email_confirmed && !await UIWindowEmailConfirmationRequired())
                                        return;
                                }
                                UIWindowPublishWebsite($(el_window).attr('data-uid'), $(el_window).attr('data-name'), $(el_window).attr('data-path'));
                            }
                        },
                        // -------------------------------------------
                        // Deploy as App
                        // -------------------------------------------
                        {
                            html: i18n('deploy_as_app'),
                            disabled: !options.is_dir,
                            onClick: async function () {
                                launch_app({
                                    name: 'dev-center',
                                    file_path: $(el_window).attr('data-path'),
                                    file_uid: $(el_window).attr('data-uid'),
                                    params: {
                                        source_path: $(el_window).attr('data-path'),
                                    }
                                })
                            }
                        },
                        // -------------------------------------------
                        // -
                        // -------------------------------------------
                        '-',                        
                        // -------------------------------------------
                        // Properties
                        // -------------------------------------------
                        {
                            html: i18n('properties'),
                            onClick: function(){
                                let window_height = 500;
                                let window_width = 450;

                                let left = window.mouseX;
                                left -= 200;
                                left = left > (window.innerWidth - window_width)? (window.innerWidth - window_width) : left;

                                let top = window.mouseY;
                                top = top > (window.innerHeight - (window_height + window.taskbar_height + window.toolbar_height))? (window.innerHeight - (window_height + window.taskbar_height + window.toolbar_height)) : top;

                                UIWindowItemProperties(options.title, options.path, options.uid, left, top, window_width, window_height);
                            }
                        },
                    ]
                });
            }
            // Trash conext menu
            else{
                UIContextMenu({
                    parent_element: el_window_body,
                    items: [
                        // -------------------------------------------
                        // Empty Trash
                        // -------------------------------------------
                        {
                            html: i18n('empty_trash'),
                            disabled: false,
                            onClick: async function(){
                                // TODO: Merge this with window.empty_trash()
                                const alert_resp = await UIAlert({
                                    message: i18n('empty_trash_confirmation'),
                                    buttons:[
                                        {
                                            label: i18n('yes'),
                                            value: 'yes',
                                            type: 'primary',
                                        },
                                        {
                                            label: i18n('no'),
                                            value: 'no',
                                        },
                                    ]
                                })
                                if(alert_resp === 'no')
                                    return;
                                
                                // todo this has to be case-insensitive but the `i` selector doesn't work on ^=
                                $(`.item[data-path^="${html_encode(window.trash_path)}/"]`).each(function(){
                                    window.delete_item(this);
                                })
                                // update other clients
                                if(window.socket){
                                    window.socket.emit('trash.is_empty', {is_empty: true});
                                }
                                // use the 'empty trash' icon
                                $(`.item[data-path="${html_encode(window.trash_path)}" i], .item[data-shortcut_to_path="${html_encode(window.trash_path)}" i]`).find('.item-icon > img').attr('src', window.icons['trash.svg']);
                            }
                        },
                    ]
                });
            }
        }
    }); 
    // --------------------------------------------------------
    // Head Context Menu
    // --------------------------------------------------------
    if(options.has_head){
        $(el_window_head).bind("contextmenu taphold", function (event) {
            event.preventDefault();
            return false;
        })
    }

    // --------------------------------------------------------
    // Droppable sidebar items
    // --------------------------------------------------------
    $(el_window).find('.window-sidebar-item').each(function (index){
        // todo only continue if this item is a dir
        const el_item = this;
        $(el_item).dragster({
            enter: function (dragsterEvent, event) {
                $(el_item).addClass('item-selected');
            },
            leave: function (dragsterEvent, event) {
                $(el_item).removeClass('item-selected');
            },
            drop: function (dragsterEvent, event) {
                const e = event.originalEvent;        
                $(el_item).removeClass('item-selected');
                // if files were dropped...
                if(e.dataTransfer?.items?.length > 0){
                    window.upload_items(e.dataTransfer.items, $(el_item).attr('data-path'))
                }

                e.stopPropagation();
                e.preventDefault();
                return false;
            }
        });
    })

    //--------------------------------------------------
    // Sidebar sortable
    //--------------------------------------------------
    if(options.is_dir && !isMobile.phone){
        const $sidebar = $(el_window).find('.window-sidebar');

        $sidebar.sortable({
            items: '.window-sidebar-item:not(.window-sidebar-title, .not-sortable)',  // More specific selector
            connectWith: '.window-sidebar',
            cursor: 'move',
            axis: 'y',
            distance: 5,
            containment: 'parent',
            placeholder: 'window-sidebar-item-placeholder',
            tolerance: 'pointer',
            helper: 'clone',
            opacity: 0.8,
    
            start: function(event, ui) {
                // Add dragging class
                ui.item.addClass('window-sidebar-item-dragging');
                
                // Create placeholder styling
                ui.placeholder.css({
                    'height': ui.item.height(),
                    'visibility': 'visible',
                });
            },
    
            sort: function(event, ui) {
                // Ensure the helper follows the cursor properly
                ui.helper.css('pointer-events', 'none');
            },
    
            stop: function(event, ui) {
                // Remove dragging class
                ui.item.removeClass('window-sidebar-item-dragging');
    
                // Get the new order
                const newOrder = $sidebar.find('.window-sidebar-item').map(function() {
                    return {
                        path: $(this).attr('data-path'),
                        name: $(this).text().trim()
                    };
                }).get();
    
                // Save the new order
                saveSidebarOrder(newOrder);
            }
        }).disableSelection();  // Prevent text selection while dragging
    
        // Make the sortable operation more responsive
        $sidebar.on('mousedown', '.window-sidebar-item', function(e) {
            if (!$(this).hasClass('window-sidebar-title')) {
                $(this).addClass('grabbing');
            }
        });
    
        $sidebar.on('mouseup mouseleave', '.window-sidebar-item', function() {
            $(this).removeClass('grabbing');
        });
    }

    //set styles
    $(el_window_body).css(options.body_css);

    // is fullpage?
    if(options.is_fullpage){
        $(el_window).hide()
        setTimeout(function(){
            window.enter_fullpage_mode(el_window);
            $(el_window).show()
        }, 50);
    }

    return el_window;
}

function delete_window_element (el_window){
    // if this is the active element, set it to null
    if(window.active_element === el_window){
        window.active_element = null;
    }
    // remove DOM element
    $(el_window).remove(); 
    // if no other windows open, reset window_counter
    // resetting window counter is important so that next window opens at the center of the screen
    if($('.window').length === 0)
        window.window_counter = 0;
}

$(document).on('click', '.window-sidebar-item', async function(e){
    const el_window = $(this).closest('.window');
    const parent_win_id = $(el_window).attr('data-id');
    const item_path =  $(this).attr('data-path');

    // ctrl/cmd + click will open in new window
    if(e.metaKey || e.ctrlKey){
        UIWindow({
            path: item_path,
            title: path.basename(item_path),
            icon: await item_icon({is_dir: true, path: item_path}),
            // todo
            // uid: $(el_item).attr('data-uid'),
            is_dir: true,
            // todo
            // sort_by: $(el_item).attr('data-sort_by'),
            app: 'explorer',
            // top: options.maximized ? 0 : undefined,
            // left: options.maximized ? 0 : undefined,
            // height: options.maximized ? `calc(100% - ${window.taskbar_height + 1}px)` : undefined,
            // width: options.maximized ? `100%` : undefined,
        });
    }
    // update window path only if it's a new path AND no ctrl/cmd key pressed
    else if(item_path !== $(el_window).attr('data-path')){
        window.window_nav_history[parent_win_id] = window.window_nav_history[parent_win_id].slice(0, window.window_nav_history_current_position[parent_win_id] + 1);
        window.window_nav_history[parent_win_id].push(item_path);
        window.window_nav_history_current_position[parent_win_id]++;

        window.update_window_path(el_window, item_path);
    }
})

$(document).on('contextmenu', '.window-sidebar', function(e){
    e.preventDefault();
    e.stopPropagation();
    return false;  
})

$(document).on('contextmenu taphold', '.window-sidebar-item', function(event){
    // dismiss taphold on regular devices
    if(event.type==='taphold' && !isMobile.phone && !isMobile.tablet)
        return;

    event.preventDefault();
    event.stopPropagation();
    // todo
    // $(this).addClass('window-sidebar-item-highlighted');
    const item = this;
    UIContextMenu({
        parent_element: $(this),
        items: [
            //--------------------------------------------------
            // Open
            //--------------------------------------------------
            {
                html: "Open",
                onClick: function(){
                    $(item).trigger('click');
                }
            },
            //--------------------------------------------------
            // Open in New Window
            //--------------------------------------------------
            {
                html: "Open in New Window",
                onClick: async function(){
                    let item_path = $(item).attr('data-path');

                    UIWindow({
                        path: item_path,
                        title: path.basename(item_path),
                        icon: await item_icon({is_dir: true, path: item_path}),
                        // todo
                        // uid: $(el_item).attr('data-uid'),
                        is_dir: true,
                        // todo
                        // sort_by: $(el_item).attr('data-sort_by'),
                        app: 'explorer',
                        // top: options.maximized ? 0 : undefined,
                        // left: options.maximized ? 0 : undefined,
                        // height: options.maximized ? `calc(100% - ${window.taskbar_height + 1}px)` : undefined,
                        // width: options.maximized ? `100%` : undefined,
                    });            
                }
            }
        ]
    });
    return false;
})

$(document).on('dblclick', '.window .ui-resizable-handle', function(e){
    let el_window = $(this).closest('.window');
    // bottom
    if($(this).hasClass('ui-resizable-s')){
        let height = window.innerHeight - $(el_window).position().top - window.taskbar_height - 6;
        $(el_window).height(height);
    }

    // top
    else if($(this).hasClass('ui-resizable-n')){
        let height = $(el_window).height() +  $(el_window).position().top - window.toolbar_height;
        $(el_window).css({
            height: height,
            top: window.toolbar_height, 
        });
    }
    // right
    else if($(this).hasClass('ui-resizable-e')){
        let width = window.innerWidth - $(el_window).position().left;
        $(el_window).css({
            width: width,
        });
    }
    // left
    else if($(this).hasClass('ui-resizable-w')){
        let width = $(el_window).width() +  $(el_window).position().left;
        $(el_window).css({
            width: width,
            left: 0 
        });
    }
    // bottom left
    else if($(this).hasClass('ui-resizable-sw')){
        let width = $(el_window).width() +  $(el_window).position().left;
        let height = window.innerHeight - $(el_window).position().top - window.taskbar_height - 6;
        $(el_window).css({
            width: width,
            height: height,
            left: 0 
        });
    }
    // bottom right
    else if($(this).hasClass('ui-resizable-se')){
        let width = window.innerWidth - $(el_window).position().left;
        let height = window.innerHeight - $(el_window).position().top - window.taskbar_height - 6;
        $(el_window).css({
            width: width,
            height: height,
        });
    }
    // top right
    else if($(this).hasClass('ui-resizable-ne')){
        let width = window.innerWidth - $(el_window).position().left;
        let height = $(el_window).height() +  $(el_window).position().top - window.toolbar_height;
        $(el_window).css({
            width: width,
            height: height,
            top: window.toolbar_height,
        });
    }
    // top left
    else if($(this).hasClass('ui-resizable-nw')){
        let width = $(el_window).width() +  $(el_window).position().left;
        let height = $(el_window).height() +  $(el_window).position().top - window.toolbar_height;
        $(el_window).css({
            width: width,
            height: height,
            top: window.toolbar_height,
            left:0,
        });
    }

})

$(document).on('click', '.window-navbar-path', function(e){
    if(!$(e.target).hasClass('window-navbar-path'))
        return;

    $(e.target).hide();
    $(e.target).siblings('.window-navbar-path-input').show().select();
})
$(document).on('blur', '.window-navbar-path-input', function(e){
    $(e.target).hide();
    $(e.target).siblings('.window-navbar-path').show().select();
})

$(document).on('keyup', '.window-navbar-path-input', function(e){
    if (e.key === 'Enter' || e.keyCode === 13) {
        window.update_window_path($(e.target).closest('.window'), $(e.target).val());
        $(e.target).hide();
        $(e.target).siblings('.window-navbar-path').show().select();    
    }
})


$(document).on('click', '.window-navbar-path-dirname', function(e){
    const $el_parent_window = $(this).closest('.window');
    const parent_win_id = $($el_parent_window).attr('data-id');

    // open in new window
    if(e.metaKey || e.ctrlKey){
        const dirpath = $(this).attr('data-path');
        UIWindow({
            path: dirpath,
            title: dirpath === '/' ? window.root_dirname : path.basename(dirpath),
            icon: window.icons['folder.svg'],
            // uid: $(el_item).attr('data-uid'),
            is_dir: true,
            app: 'explorer',
        });
    }
    // only change dir if target is not the same as current path
    else if($el_parent_window.attr('data-path') !== $(this).attr('data-path')){
        window.window_nav_history[parent_win_id] = window.window_nav_history[parent_win_id].slice(0, window.window_nav_history_current_position[parent_win_id]+1);
        window.window_nav_history[parent_win_id].push($(this).attr('data-path'));
        window.window_nav_history_current_position[parent_win_id] = window.window_nav_history[parent_win_id].length - 1;
        window.update_window_path($el_parent_window, $(this).attr('data-path'));
    }
})

$(document).on('contextmenu taphold', '.window-navbar', function(event){
    // don't disable system ctxmenu on the address bar input
    if($(event.target).hasClass('window-navbar-path-input'))
        return;

    // dismiss taphold on regular devices
    if(event.type==='taphold' && !isMobile.phone && !isMobile.tablet)
        return;

    event.preventDefault();
    event.stopPropagation();
    return false;
})

$(document).on('contextmenu taphold', '.window-navbar-path-dirname', function(event){
    // dismiss taphold on regular devices
    if(event.type==='taphold' && !isMobile.phone && !isMobile.tablet)
        return;

    event.preventDefault();
    const menu_items = [];
    const el = this;
    // -------------------------------------------
    // Open
    // -------------------------------------------
    menu_items.push({
        html: 'Open',
        onClick: ()=>{
            $(this).trigger('click');
        }
    });
    // -------------------------------------------
    // Open in New Window
    // (only if the item is on a window)
    // -------------------------------------------
    menu_items.push({
        html: 'Open in New Window',
        onClick: function(){
            UIWindow({
                path: $(el).attr('data-path'),
                title:  $(el).attr('data-path') === '/' ? window.root_dirname : path.basename($(el).attr('data-path')),
                icon: window.icons['folder.svg'],
                uid: $(el).attr('data-uid'),
                is_dir: true,
                app: 'explorer',
            });
        }
    });
    // -------------------------------------------
    // -
    // -------------------------------------------
    menu_items.push('-'),
    // -------------------------------------------
    // Paste
    // -------------------------------------------
    menu_items.push({
        html: "Paste",
        disabled: window.clipboard.length > 0 ? false : true,
        onClick: function(){
            if(window.clipboard_op === 'copy')
                window.copy_clipboard_items($(el).attr('data-path'), null);
            else if(window.clipboard_op === 'move')
                window.move_clipboard_items(null, $(el).attr('data-path'))
        }
    })

    UIContextMenu({
        parent_element: $(this),
        items: menu_items
    });
})

// if the click is on the mask, bring focus to the active child window
$(document).on('click', '.window-disable-mask', async function(e){
    e.stopPropagation();
    e.preventDefault();
    return false;
})

// --------------------------------------------------------
// Navbar Dir Droppable
// --------------------------------------------------------
window.navbar_path_droppable = (el_window)=>{
    $(el_window).find('.window-navbar-path-dirname').droppable({
        accept: '.item',
        tolerance: 'pointer',
        drop: function( event, ui ) {
            // check if item was actually dropped on this navbar path
            if($(window.mouseover_window).attr('data-id') !== $(el_window).attr('data-id')){
                return;
            }
            const items_to_move = []
            
            // first item
            items_to_move.push(ui.draggable); 
            
            // all subsequent items
            const cloned_items = document.getElementsByClassName('item-selected-clone');
            for(let i =0; i<cloned_items.length; i++){
                const source_item = document.getElementById('item-' + $(cloned_items[i]).attr('data-id'));
                if(source_item !== null)
                    items_to_move.push(source_item);
            }

            // if alt key is down, create shortcut items
            if(event.altKey){
                items_to_move.forEach((item_to_move) => {
                    window.create_shortcut(
                        path.basename($(item_to_move).attr('data-path')), 
                        $(item_to_move).attr('data-is_dir') === '1', 
                        $(this).attr('data-path'), 
                        null, 
                        $(item_to_move).attr('data-shortcut_to') === '' ? $(item_to_move).attr('data-uid') : $(item_to_move).attr('data-shortcut_to'),
                        $(item_to_move).attr('data-shortcut_to_path') === '' ? $(item_to_move).attr('data-path') : $(item_to_move).attr('data-shortcut_to_path'),
                    );
                });
            }
            // move items
            else{
                window.move_items(items_to_move, $(this).attr('data-path'));
            }

            $('.item-container').droppable('enable')
            $(this).removeClass('window-navbar-path-dirname-active');

            return false;
        },
        over: function(event, ui){
            // check if item was actually hovered over this window
            if($(window.mouseover_window).attr('data-id') !== $(el_window).attr('data-id'))
                return;

            // Don't do anything if the dragged item is NOT a UIItem
            if(!$(ui.draggable).hasClass('item'))
                return;
            
            // highlight this dirname
            $(this).addClass('window-navbar-path-dirname-active');
            $('.ui-draggable-dragging').css('opacity', 0.2)
            $('.item-selected-clone').css('opacity', 0.2)

            // disable all window bodies 
            $('.item-container').droppable( 'disable' )
        },
        out: function(event, ui){
            // Don't do anything if the dragged element is NOT a UIItem
            if(!$(ui.draggable).hasClass('item'))
                return;
            
            // unselect directory if item is dragged out
            $(this).removeClass('window-navbar-path-dirname-active');
            $('.ui-draggable-dragging').css('opacity', 'initial')
            $('.item-selected-clone').css('opacity', 'initial')

            $('.item-container').droppable( 'enable' )    
        }
    });
}

/**
 * Constructs a XSS-safe string that represents a navigation bar path.
 * The result is a string with HTML span elements for each directory in the path, each accompanied by a separator icon.
 * Each span element has a `data-path` attribute holding the encoded path to that directory, and contains the encoded directory name as text.
 * The root directory name is a constant defined in globals.js, represented as 'root_dirname'.
 *
 * @param {string} abs_path - The absolute path to be displayed in the navigation bar. It should be a string with directories separated by slashes ('/').
 * 
 * @returns {string} A string of HTML spans and separators, each span representing a directory in the navigation bar.
 *
 */
window.navbar_path = (abs_path)=>{
    // remove trailing slash
    if(abs_path.endsWith('/') && abs_path !== '/')
        abs_path = abs_path.slice(0, -1);

    const dirs = (abs_path === '/' ? [''] : abs_path.split('/'));
    const dirpaths = (abs_path === '/' ? ['/'] : [])
    const path_seperator_html = `<img class="path-seperator" draggable="false" src="${html_encode(window.icons['triangle-right.svg'])}">`;
    if(dirs.length > 1){
        for(let i=0; i<dirs.length; i++){
            dirpaths[i] = '';
            for(let j=1; j<=i; j++){
                dirpaths[i] += '/'+dirs[j];
            }
        }
    }
    let str = `${path_seperator_html}<span class="window-navbar-path-dirname" data-path="${html_encode('/')}">${html_encode(window.root_dirname)}</span>`;
    for(let k=1; k<dirs.length; k++){
        str += `${path_seperator_html}<span class="window-navbar-path-dirname" data-path="${html_encode(dirpaths[k])}">${dirs[k] === 'Trash' ? i18n('trash') : html_encode(dirs[k])}</span>`;
    }
    return str;
}

window.update_window_path = async function(el_window, target_path){
    const win_id = $(el_window).attr('data-id');
    const el_window_navbar_forward_btn = $(el_window).find('.window-navbar-btn-forward');
    const el_window_navbar_back_btn = $(el_window).find('.window-navbar-btn-back');
    const el_window_navbar_up_btn = $(el_window).find('.window-navbar-btn-up');
    const el_window_body = $(el_window).find('.window-body');
    const el_window_item_container = $(el_window).find('.item-container');
    const el_window_navbar_path_input = $(el_window).find('.window-navbar-path-input');
    const is_dir = ($(el_window).attr('data-is_dir') === '1' || $(el_window).attr('data-is_dir') === 'true');
    const old_path = $(el_window).attr('data-path');

    // update sidebar items' active status
    $(el_window).find(`.window-sidebar-item`).removeClass('window-sidebar-item-active');
    $(el_window).find(`.window-sidebar-item[data-path="${html_encode(target_path)}"]`).addClass('window-sidebar-item-active');

    // clean
    $(el_window).find('.explore-table-headers-th > .header-sort-icon').html('');

    if(is_dir){
        // if nav history for this window is empty, disable forward btn
        if(window.window_nav_history[win_id] && window.window_nav_history[win_id].length - 1 === window.window_nav_history_current_position[win_id])
            $(el_window_navbar_forward_btn).addClass('window-navbar-btn-disabled');
        // ... else, enable forawrd btn
        else
            $(el_window_navbar_forward_btn).removeClass('window-navbar-btn-disabled');

        // disable back button if path is root
        if(window.window_nav_history_current_position[win_id] === 0)
            $(el_window_navbar_back_btn).addClass('window-navbar-btn-disabled');
        // ... enable back btn in all other cases
        else
            $(el_window_navbar_back_btn).removeClass('window-navbar-btn-disabled');

        // disabled Up button if this is root
        if(target_path === '/')
            $(el_window_navbar_up_btn).addClass('window-navbar-btn-disabled');
        // ... enable back btn in all other cases
        else
            $(el_window_navbar_up_btn).removeClass('window-navbar-btn-disabled');

        $(el_window_item_container).attr('data-path', target_path);
        $(el_window).find('.window-navbar-path').html(window.navbar_path(target_path, window.user.username));
        
        // empty body to be filled with the results of /readdir
        $(el_window_body).find('.item').removeItems()

        // add the 'Detail View' table header
        if($(el_window).find('.explore-table-headers').length === 0)
            $(el_window_body).prepend(window.explore_table_headers());
        
        // 'Detail View' table header is hidden by default
        $(el_window).find('.explore-table-headers').hide();

        // system directories with custom icons and predefined names
        if(target_path === window.desktop_path){
            $(el_window).find('.window-head-icon').attr('src', window.icons['folder-desktop.svg']);
            $(el_window).find('.window-head-title').text('Desktop')
        }else if (target_path === window.home_path){
            $(el_window).find('.window-head-icon').attr('src', window.icons['folder-home.svg']);
            $(el_window).find('.window-head-title').text(i18n('home'))
        }else if (target_path === window.docs_path){
            $(el_window).find('.window-head-icon').attr('src', window.icons['folder-documents.svg']);
            $(el_window).find('.window-head-title').text(i18n('documents'))
        }else if (target_path === window.public_path){
            $(el_window).find('.window-head-icon').attr('src', window.icons['folder-public.svg']);
            $(el_window).find('.window-head-title').text('Public')
        }else if (target_path === window.videos_path){
            $(el_window).find('.window-head-icon').attr('src', window.icons['folder-videos.svg']);
            $(el_window).find('.window-head-title').text('Videos')
        }else if (target_path === window.pictures_path){
            $(el_window).find('.window-head-icon').attr('src', window.icons['folder-pictures.svg']);
            $(el_window).find('.window-head-title').text('Pictures')
        }// root folder of a shared user?
        else if((target_path.split('/').length - 1) === 1 && target_path !== '/'+window.user.username)
            $(el_window).find('.window-head-icon').attr('src', window.icons['shared.svg']);
        else
            $(el_window).find('.window-head-icon').attr('src', window.icons['folder.svg']);
    }

    $(el_window).attr('data-path', html_encode(target_path));
    $(el_window).attr('data-name', html_encode(path.basename(target_path)));

    // /stat
    if(target_path !== '/'){
        try{
            puter.fs.stat(target_path, function(fsentry){
                $(el_window).removeClass('window-' + $(el_window).attr('data-uid'));
                $(el_window).addClass('window-' + fsentry.id);
                $(el_window).attr('data-uid', fsentry.id);
                $(el_window).attr('data-sort_by', fsentry.sort_by ?? 'name');
                $(el_window).attr('data-sort_order', fsentry.sort_order ?? 'asc');
                $(el_window).attr('data-layout', fsentry.layout ?? 'icons');
                $(el_window_item_container).attr('data-uid', fsentry.id);
                // title
                if (target_path === window.home_path)
                    $(el_window).find('.window-head-title').text(i18n('home'))
                else
                    $(el_window).find('.window-head-title').text(fsentry.name);
                // data-name
                $(el_window).attr('data-name', html_encode(fsentry.name));
                // data-path
                $(el_window).attr('data-path', html_encode(target_path));
                $(el_window_navbar_path_input).val(target_path);
                $(el_window_navbar_path_input).attr('data-path', target_path);
                // update layout
                window.update_window_layout(el_window, fsentry.layout);
                // update explore header if in details view
                if(fsentry.layout === 'details'){
                    window.update_details_layout_sort_visuals(el_window, fsentry.sort_by, fsentry.sort_order);
                }
            });
        }catch(err){
            UIAlert(err.responseText)

            // todo optim: this is dumb because updating the window should only happen if this /readdir request is successful,
            // in that case there is no need for using update_window_path on error!!
            window.update_window_path(el_window, old_path);
        }
    }
    // path is '/' (global root)
    else{
        $(el_window).removeClass('window-' + $(el_window).attr('data-uid'));
        $(el_window).addClass('window-null');
        $(el_window).attr('data-uid', 'null');
        $(el_window).attr('data-name', '');
        $(el_window).find('.window-head-title').text(window.root_dirname);
    }

    if(is_dir){
        refresh_item_container(el_window_body);
        window.navbar_path_droppable(el_window)
    }

    window.update_explorer_footer_selected_items_count(el_window);
}

// --------------------------------------------------------
// Sidebar Item Droppable
// --------------------------------------------------------
window.sidebar_item_droppable = (el_window)=>{
    $(el_window).find('.window-sidebar-item').droppable({
        accept: '.item',
        tolerance: 'pointer',
        drop: function( event, ui ) {
            // check if item was actually dropped on this navbar path
            if($(window.mouseover_window).attr('data-id') !== $(el_window).attr('data-id')){
                return;
            }
            const items_to_move = []
            
            // first item
            items_to_move.push(ui.draggable); 
            
            // all subsequent items
            const cloned_items = document.getElementsByClassName('item-selected-clone');
            for(let i =0; i<cloned_items.length; i++){
                const source_item = document.getElementById('item-' + $(cloned_items[i]).attr('data-id'));
                if(source_item !== null)
                    items_to_move.push(source_item);
            }

            // if alt key is down, create shortcut items
            if(event.altKey){
                items_to_move.forEach((item_to_move) => {
                    window.create_shortcut(
                        path.basename($(item_to_move).attr('data-path')), 
                        $(item_to_move).attr('data-is_dir') === '1', 
                        $(this).attr('data-path'), 
                        null, 
                        $(item_to_move).attr('data-shortcut_to') === '' ? $(item_to_move).attr('data-uid') : $(item_to_move).attr('data-shortcut_to'),
                        $(item_to_move).attr('data-shortcut_to_path') === '' ? $(item_to_move).attr('data-path') : $(item_to_move).attr('data-shortcut_to_path'),
                    );
                });
            }
            // move items
            else{
                window.move_items(items_to_move, $(this).attr('data-path'));
            }

            $('.item-container').droppable('enable')
            $(this).removeClass('window-sidebar-item-drag-active');

            return false;
        },
        over: function(event, ui){
            // check if item was actually hovered over this window
            if($(window.mouseover_window).attr('data-id') !== $(el_window).attr('data-id'))
                return;

            // Don't do anything if the dragged item is NOT a UIItem
            if(!$(ui.draggable).hasClass('item'))
                return;
            
            // highlight this item
            $(this).addClass('window-sidebar-item-drag-active');
            $('.ui-draggable-dragging').css('opacity', 0.2)
            $('.item-selected-clone').css('opacity', 0.2)

            // disable all window bodies 
            $('.item-container').droppable( 'disable' )
        },
        out: function(event, ui){
            // Don't do anything if the dragged element is NOT a UIItem
            if(!$(ui.draggable).hasClass('item'))
                return;
            
            // unselect item if item is dragged out
            $(this).removeClass('window-sidebar-item-drag-active');
            $('.ui-draggable-dragging').css('opacity', 'initial')
            $('.item-selected-clone').css('opacity', 'initial')

            $('.item-container').droppable( 'enable' )    
        }
    });
}

// closes a window
$.fn.close = async function(options) {
    options = options || {};
    $(this).each(async function() {
        const el_iframe = $(this).find('.window-app-iframe');
        const app_uses_sdk = el_iframe.length > 0 && el_iframe.attr('data-appUsesSDK') === 'true';

        if(app_uses_sdk){
            // get appInstanceID
            const appInstanceID = el_iframe.closest('.window').attr('data-element_uuid');
            // tell child app that this window is about to close, get its response
            if(!options.bypass_iframe_messaging){
                const resp = await window.sendWindowWillCloseMsg(el_iframe.get(0));
                if(!resp.msg){
                    return false;
                }
            }
            // remove the menubar from the window.menubars array
            if(appInstanceID){
                delete window.menubars[appInstanceID];
                window.app_instance_ids.delete(appInstanceID);
            }
        }

        if ( this.on_before_exit ) {
            if ( ! await this.on_before_exit() ) return false;
        }

        // Process window close if this is a window
        if($(this).hasClass('window')){
            const win_id = parseInt($(this).attr('data-id'));
            let window_uuid = $(this).attr('data-element_uuid');
            // remove all instances of win_id from window.window_stack
            _.pullAll(window.window_stack, [win_id]);
            // taskbar update
            let open_window_count = parseInt($(`.taskbar-item[data-app="${$(this).attr('data-app')}"]`).attr('data-open-windows'));
            // update open window count of corresponding taskbar item
            if(open_window_count > 0){
                $(`.taskbar-item[data-app="${$(this).attr('data-app')}"]`).attr('data-open-windows', open_window_count - 1);
            }
            // decide whether to remove taskbar item
            if(open_window_count === 1){
                $(`.taskbar-item[data-app="${$(this).attr('data-app')}"] .active-taskbar-indicator`).hide();
                window.remove_taskbar_item($(`.taskbar-item[data-app="${$(this).attr('data-app')}"][data-keep-in-taskbar="false"]`));
            }
            // if no more windows of this app are open, remove taskbar item
            if(open_window_count - 1 === 0)
                $(`.taskbar-item[data-app="${$(this).attr('data-app')}"] .active-taskbar-indicator`).hide();
            // if a fullpage window is closed, show desktop and taskbar
            if($(this).attr('data-is_fullpage') === '1'){
                window.exit_fullpage_mode();
            }

            // FileDialog closed
            if($(this).hasClass('window-filedialog') || $(this).attr('data-disable_parent_window') === 'true'){
                // re-enable this FileDialog's parent window
                $(`.window[data-element_uuid="${$(this).attr('data-parent_uuid')}"]`).addClass('window-active');
                $(`.window[data-element_uuid="${$(this).attr('data-parent_uuid')}"]`).removeClass('window-disabled');
                $(`.window[data-element_uuid="${$(this).attr('data-parent_uuid')}"]`).find('.window-disable-mask').hide();
                // bring focus back to app iframe, if needed
                $(`.window[data-element_uuid="${$(this).attr('data-parent_uuid')}"]`).focusWindow();
            }
            // Other types of windows closed
            else{
                // close any open FileDialogs belonging to this window
                $(`.window-filedialog[data-parent_uuid="${window_uuid}"]`).close();
                // bring focus to the last window in the window-stack (only if not minimized)
                if(!_.isEmpty(window.window_stack)){
                    const $last_window_in_stack = $(`.window[data-id="${window.window_stack[window.window_stack.length - 1]}"]`);
                    // check if previous window is not minimized
                    if($last_window_in_stack !== null && $last_window_in_stack.attr('data-is_minimized') !== '1' && $last_window_in_stack.attr('data-is_minimized') !== 'true'){
                        $(`.window[data-id="${window.window_stack[window.window_stack.length - 1]}"]`).focusWindow();
                    }
                    // otherwise, change URL/Title to desktop
                    else{
                        window.history.replaceState(null, document.title, '/');
                        document.title = 'Puter';
                    }
                    // if it's explore 
                    if($last_window_in_stack.attr('data-app') && $last_window_in_stack.attr('data-app').toLowerCase() === 'explorer'){
                        window.history.replaceState(null, document.title, '/');
                        document.title = 'Puter';
                    }
                }
                // otherwise, change URL/Title to desktop
                else{
                    window.history.replaceState(null, document.title, '/');
                    document.title = 'Puter';
                }
            }
            // close child windows
            $(`.window[data-parent_uuid="${window_uuid}"]`).close();

            // notify other apps that we're closing
            window.report_app_closed(window_uuid, options.status_code ?? 0);

            // remove backdrop
            $(this).closest('.window-backdrop').remove();

            // remove global menubars
            $(`.window-menubar-global[data-window-id="${win_id}"]`).remove();

            // remove DOM element
            if(options?.shrink_to_target){
                // get target location
                const target_pos = $(options.shrink_to_target).position();
                const target_size = $(options.shrink_to_target).get(0).getBoundingClientRect();

                // animate window to target location
                $(this).animate({
                    width: `1`,
                    height: `1`,
                    top: target_pos.top + target_size.height / 2,
                    left: target_pos.left + target_size.width / 2,
                }, 300, () => {
                    // remove DOM element
                    delete_window_element(this);
                });
            }
            else if(window.animate_window_closing){
                // start shrink animation
                $(this).css({
                    'transition': 'transform 400ms',
                    'transform': 'scale(0)',
                });
                // remove DOM element after fadeout animation
                $(this).fadeOut(80, function(){
                    delete_window_element(this);
                })
            }else{
                delete_window_element(this);
            }
        }
        // focus back to desktop?
        if(_.isEmpty(window.window_stack)){
            // The following is to make sure the iphone keyboard is dismissed when the last window is closed
            if(isMobile.phone || isMobile.tablet){
                document.activeElement.blur();
                $("input").blur();
            }
            // focus back to desktop
            $('.desktop').find('.item-blurred').removeClass('item-blurred');
            window.active_item_container = $('.desktop.item-container').get(0);
        }
    })

    return this;
};

window.scale_window = (el_window)=>{
    //maximize
    if ($(el_window).attr('data-is_maximized') !== '1') {
        // save original size and position
        let el_window_rect = el_window.getBoundingClientRect();
        $(el_window).attr({
            'data-left-before-maxim': el_window_rect.left + 'px',
            'data-top-before-maxim': el_window_rect.top + 'px',
            'data-width-before-maxim': $(el_window).css('width'),
            'data-height-before-maxim': $(el_window).css('height'),
            'data-is_maximized': '1',
        });

        // shrink icon
        $(el_window).find('.window-scale-btn>img').attr('src', window.icons['scale-down-3.svg']);

        // calculate height
        let height;
        if(window.is_fullpage_mode){
            height = `calc(100% - ${ window.toolbar_height}px)`;
        }else{
            height = `calc(100% - ${window.taskbar_height + window.toolbar_height + 6}px)`;
        }

        // set new size and position
        $(el_window).css({
            'top': window.toolbar_height+'px',
            'left': '0',
            'width': '100%',
            'height': height,
            'transform': 'none',
        });

        // hide toolbar
        window.hide_toolbar();
    }
    //shrink
    else {
        // set size and position to original before maximization
        $(el_window).css({
            'top': $(el_window).attr('data-top-before-maxim'),
            'left': $(el_window).attr('data-left-before-maxim'),
            'width': $(el_window).attr('data-width-before-maxim'),
            'height': $(el_window).attr('data-height-before-maxim'),
            'transform': 'none',
        });
    
        // maximize icon
        $(el_window).find('.window-scale-btn>img').attr('src', window.icons['scale.svg']);

        $(el_window).attr({
            'data-is_maximized': 0,
        });
    }

    // record window size and position before scaling
    $(el_window).attr({
        'data-orig-width': $(el_window).width(), 
        'data-orig-height': $(el_window).height(), 
        'data-orig-top': $(el_window).position().top, 
        'data-orig-left': $(el_window).position().left, 
        'data-is_minimized': false, 
    })
}

window.update_explorer_footer_item_count = function(el_window){
    //update dir count in explorer footer
    let item_count = $(el_window).find('.item').length;
    $(el_window).find('.explorer-footer .explorer-footer-item-count').html(item_count + ` ${i18n('item')}` + (item_count == 0 || item_count > 1 ? `${i18n('plural_suffix')}` : ''));
}

window.update_explorer_footer_selected_items_count = function(el_window){
    //update dir count in explorer footer
    let item_count = $(el_window).find('.item-selected').length;
    if(item_count > 0){
        $(el_window).find('.explorer-footer-seperator, .explorer-footer-selected-items-count').show();
        $(el_window).find('.explorer-footer .explorer-footer-selected-items-count').html(item_count + ` ${i18n('item')}` + (item_count == 0 || item_count > 1 ? `${i18n('plural_suffix')}` : '') + ` ${i18n('selected')}`);
    }else{
        $(el_window).find('.explorer-footer-seperator, .explorer-footer-selected-items-count').hide();
    }
}

window.set_sort_by = function(item_uid, sort_by, sort_order){
    if(sort_order !== 'asc' && sort_order !== 'desc')
        sort_order = 'asc';

    $.ajax({
        url: window.api_origin + "/set_sort_by",
        type: 'POST',
        data: JSON.stringify({ 
            sort_by: sort_by,
            item_uid: item_uid,
            sort_order: sort_order,
        }),
        async: true,
        contentType: "application/json",
        headers: {
            "Authorization": "Bearer "+window.auth_token
        },
        statusCode: {
            401: function () {
                window.logout();
            },
        },        
        success: function (){ 
        }  
    })
    // update the sort_by & sort_order attr of every matching element
    $(`[data-uid="${item_uid}"]`).attr({
        'data-sort_by': sort_by,
        'data-sort_order': sort_order,
    });
}

window.explore_table_headers = function(){
    let h = ``;
    h += `<div class="explore-table-headers">`;
        h += `<div class="explore-table-headers-th explore-table-headers-th--name">${i18n('name')}<span class="header-sort-icon"></span></div>`;
        h += `<div class="explore-table-headers-th explore-table-headers-th--modified">${i18n('modified')}<span class="header-sort-icon"></span></div>`;
        h += `<div class="explore-table-headers-th explore-table-headers-th--size">${i18n('size')}<span class="header-sort-icon"></span></div>`;
        h += `<div class="explore-table-headers-th explore-table-headers-th--type">${i18n('type')}<span class="header-sort-icon"></span></div>`;
    h += `</div>`;
    return h;
}

window.update_window_layout = function(el_window, layout){
    layout = layout ?? 'icons';

    if(layout === 'icons'){
        $(el_window).find('.explore-table-headers').hide();
        $(el_window).find('.item-container').removeClass('item-container-list');
        $(el_window).find('.item-container').removeClass('item-container-details');
        $(el_window).find('.window-navbar-layout-settings').attr('src', window.icons['layout-icons.svg']);
        $(el_window).attr('data-layout', layout)
    }
    else if(layout === 'list'){
        $(el_window).find('.explore-table-headers').hide();
        $(el_window).find('.item-container').removeClass('item-container-details');
        $(el_window).find('.item-container').addClass('item-container-list');
        $(el_window).find('.window-navbar-layout-settings').attr('src', window.icons['layout-list.svg'])
        $(el_window).attr('data-layout', layout)
    }
    else if(layout === 'details'){
        $(el_window).find('.explore-table-headers').show();
        $(el_window).find('.item-container').removeClass('item-container-list');
        $(el_window).find('.item-container').addClass('item-container-details');
        $(el_window).find('.window-navbar-layout-settings').attr('src', window.icons['layout-details.svg'])
        $(el_window).attr('data-layout', layout)
    }
}

$.fn.showWindow = async function(options) {
    $(this).each(async function() {
        if($(this).hasClass('window')){
            // show window
            const el_window = this;
            $(el_window).css({
                'transition': `top 0.2s, left 0.2s, bottom 0.2s, right 0.2s, width 0.2s, height 0.2s`,
                top: $(el_window).attr('data-orig-top') + 'px',
                left: $(el_window).attr('data-orig-left') + 'px',
                width: $(el_window).attr('data-orig-width') + 'px',
                height: $(el_window).attr('data-orig-height') + 'px',
            });
            $(el_window).css('z-index', ++window.last_window_zindex);

            $(el_window).attr({
                'data-is_minimized': true, 
            })

            setTimeout(() => {
                $(this).focusWindow();
            }, 80);

            // remove `transitions` a good while after setting css to make sure 
            // it doesn't interfere with an ongoing animation
            setTimeout(() => {
                $(el_window).css('transition', 'none');
            }, 250);
        }
    })
    return this;
};

window.toggle_empty_folder_message = function(el_item_container){
    // if the item container is the desktop, don't show/hide the empty message
    if($(el_item_container).hasClass('desktop'))
        return;

    // if the item container is empty, show the empty message
    if($(el_item_container).has('.item').length === 0){
        $(el_item_container).find('.explorer-empty-message').show();
    }
    // if the item container is not empty, hide the empty message
    else{
        $(el_item_container).find('.explorer-empty-message').hide();
    }
}

$.fn.focusWindow = function(event) {
    if(this.hasClass('window')){
        const $app_iframe = $(this).find('.window-app-iframe');
        const win_id = $(this).attr('data-id');

        // remove active class from all windows, except for this window
        $('.window').not(this).removeClass('window-active');
        // add active class to this window
        $(this).addClass('window-active');
        // disable pointer events on all windows' iframes, except for this window's iframe
        $('.window-app-iframe').not($app_iframe).css('pointer-events', 'none');
        // bring this window to front, only if it's not stay_on_top
        if($(this).attr('data-stay_on_top') !== 'true'){
            $(this).css('z-index', ++window.last_window_zindex);
        }
        // if this window has a parent, bring them to the front too
        if($(this).attr('data-parent_uuid') !== 'null'){
            $(`.window[data-element_uuid="${$(this).attr('data-parent_uuid')}"]`).css('z-index', window.last_window_zindex);
        }
        // if this window has child windows, bring them to the front too
        if($(this).attr('data-element_uuid') !== 'null'){
            $(`.window[data-parent_uuid="${$(this).attr('data-element_uuid')}"]`).css('z-index', ++window.last_window_zindex);
        }

        // hide other global menubars
        $('.window-menubar-global').not(`.window-menubar-global[data-window-id="${win_id}"]`).hide();
        // show this window's global menubar
        $(`.window-menubar-global[data-window-id="${win_id}"]`).show();

        // if a menubar or any of its items are clicked, don't focus the iframe. This is important to preserve the focus on the menubar
        // and to enable keyboard navigation through the menubar items
        if($(event?.target).hasClass('window-menubar') || $(event?.target).closest('.window-menubar').length > 0){
            $($app_iframe).css('pointer-events', 'none');
            $app_iframe.get(0)?.blur();
            $app_iframe.get(0)?.contentWindow?.blur();
        }
        // if this has an iframe
        else if(!$(this).hasClass('window-disabled') && $app_iframe.length > 0){
            $($app_iframe).css('pointer-events', 'all');
            $app_iframe.get(0)?.focus({preventScroll:true});
            $app_iframe.get(0)?.contentWindow?.focus({preventScroll:true});
            // todo check if iframe is using SDK before sending messages
            $app_iframe.get(0).contentWindow.postMessage({msg: "focus"}, '*');
            var rect = $app_iframe.get(0).getBoundingClientRect();
            // send click event to iframe, if this focus event was triggered by a click or similar mouse event
            if(
                event !== undefined && 
                (event.type === 'click' || event.type === 'dblclick' || event.type === 'contextmenu' || event.type === 'mousedown' || event.type === 'mouseup' || event.type === 'mousemove')
            ){
                $app_iframe.get(0).contentWindow.postMessage({msg: "click", x: (window.mouseX - rect.left), y: (window.mouseY - rect.top)}, '*');
            }
        }
        // set active_item_container
        window.active_item_container = $(this).find('.item-container').get(0);
        // grey out all selected items on other windows/desktop
        $('.item-container').not(window.active_item_container).find('.item-selected').addClass('item-blurred');
        // update window-stack
        window.window_stack.push(parseInt($(this).attr('data-id')));
        // remove blurred class from items on this window
        $(window.active_item_container).find('.item-blurred').removeClass('item-blurred');
        //change window URL
        const update_window_url = $(this).attr('data-update_window_url');
        const url_app_name = $(this).attr('data-app_pseudonym') || $(this).attr('data-app');
        if(update_window_url === 'true' || update_window_url === null){
            window.history.replaceState({window_id: $(this).attr('data-id')}, '', '/app/'+url_app_name+$(this).attr('data-user_set_url_params'));
            document.title = $(this).attr('data-name');
        }
        $(`.taskbar .taskbar-item[data-app="${$(this).attr('data-app')}"]`).addClass('taskbar-item-active');        
    }else{
        $('.window').find('.item-selected').addClass('item-blurred');
        $('.desktop').find('.item-blurred').removeClass('item-blurred');
    }

    return this;
}

// hides a window
$.fn.hideWindow = async function(options) {
    $(this).each(async function() {
        if($(this).hasClass('window')){
            // get taskbar item location
            let taskbar_item_pos = $(`.taskbar .taskbar-item[data-app="${$(this).attr('data-app')}"]`).position();

            // taskbar position is center of window minus half of taskbar item width
            taskbar_item_pos.left = taskbar_item_pos.left + ($( window ).width()/ 2) - ($(`.taskbar`).width() / 2);

            $(this).attr({
                'data-orig-width': $(this).width(), 
                'data-orig-height': $(this).height(), 
                'data-orig-top': $(this).position().top, 
                'data-orig-left': $(this).position().left, 
                'data-is_minimized': true, 
            })

            $(this).css({
                ...(!isMobile.phone ? { 
                    'transition': `top 0.2s, left 0.2s, bottom 0.2s, right 0.2s, width 0.2s, height 0.2s`,
                } : {}),
                width: `0`,
                height: `0`,
                top: 'calc(100% - 60px)',
                left: taskbar_item_pos.left + 14.5,
            });

            // remove transitions a good while after setting css to make sure 
            // it doesn't interfere with an ongoing animation
            setTimeout(() => {
                $(this).css({
                    'transition': 'none', 
                    'transform': 'none'
                });
            }, 250);

            // update title and window URL
            window.history.replaceState(null, document.title, '/');
            document.title = 'Puter';
        }
    })
    return this;
};

$(document).on('click', '.explore-table-headers-th', function(e){
    let sort_by = 'name';
    let sort_icon = `<img src="${window.icons['up-arrow.svg']}">`;

    // current sort order
    let sort_order = $(e.target).closest('.window').attr('data-sort_order') ?? 'asc';
    
    // flip sort order
    if(sort_order === 'asc'){
        sort_order = 'desc';
        sort_icon = `<img src="${window.icons['down-arrow.svg']}">`;
    }else if(sort_order === 'desc'){
        sort_icon = `<img src="${window.icons['up-arrow.svg']}">`;
        sort_order = 'asc';
    }

    // remove active class from all headers
    $(e.target).closest('.window').find('.explore-table-headers-th').removeClass('explore-table-headers-th-active');
    // remove icons from all headers
    $(e.target).closest('.window').find('.header-sort-icon').html('');

    // add active class to this header
    $(e.target).addClass('explore-table-headers-th-active');

    // set sort icon
    $(e.target).closest('.window').find('.explore-table-headers-th-active > .header-sort-icon').html(sort_icon);

    // set sort_by
    if($(e.target).hasClass('explore-table-headers-th--name')){
        sort_by = 'name';
    }else if($(e.target).hasClass('explore-table-headers-th--modified')){
        sort_by = 'modified';
    }else if($(e.target).hasClass('explore-table-headers-th--size')){
        sort_by = 'size';
    }else if($(e.target).hasClass('explore-table-headers-th--type')){
        sort_by = 'type';
    }

    // sort
    window.sort_items($(e.target).closest('.window-body'), sort_by, sort_order);
    window.set_sort_by($(e.target).closest('.window').attr('data-uid'), sort_by, sort_order)
})

window.set_layout = function(item_uid, layout){
    $.ajax({
        url: window.api_origin + "/set_layout",
        type: 'POST',
        data: JSON.stringify({ 
            item_uid: item_uid,
            layout: layout,
        }),
        async: true,
        contentType: "application/json",
        headers: {
            "Authorization": "Bearer "+window.auth_token
        },
        statusCode: {
            401: function () {
                window.logout();
            },
        },        
        success: function (){ 
            if(layout === 'details'){
                let el_window = $(`.window[data-uid="${item_uid}"]`);
                if(el_window.length > 0){
                    let sort_by = el_window.attr('data-sort_by');
                    let sort_order = el_window.attr('data-sort_order');
                    window.update_details_layout_sort_visuals(el_window, sort_by, sort_order);
                }
            }    
        }
    })
}

window.update_details_layout_sort_visuals = function(el_window, sort_by, sort_order){
    let sort_icon = '';
    $(el_window).find('.explore-table-headers-th > .header-sort-icon').html('');

    if(!sort_order || sort_order === 'asc')
        sort_icon = `<img src="${window.icons['up-arrow.svg']}">`;
    else if(sort_order === 'desc')
        sort_icon = `<img src="${window.icons['down-arrow.svg']}">`;

    if(!sort_by || sort_by === 'name'){
        $(el_window).find('.explore-table-headers-th').removeClass('explore-table-headers-th-active');
        $(el_window).find('.explore-table-headers-th--name').addClass('explore-table-headers-th-active');
        $(el_window).find('.explore-table-headers-th--name > .header-sort-icon').html(sort_icon);
    }else if(sort_by === 'size'){
        $(el_window).find('.explore-table-headers-th').removeClass('explore-table-headers-th-active');
        $(el_window).find('.explore-table-headers-th--size').addClass('explore-table-headers-th-active');
        $(el_window).find('.explore-table-headers-th--size > .header-sort-icon').html(sort_icon);
    }else if(sort_by === 'modified'){
        $(el_window).find('.explore-table-headers-th').removeClass('explore-table-headers-th-active');
        $(el_window).find('.explore-table-headers-th--modified').addClass('explore-table-headers-th-active');
        $(el_window).find('.explore-table-headers-th--modified > .header-sort-icon').html(sort_icon);
    }else if(sort_by === 'type'){
        $(el_window).find('.explore-table-headers-th').removeClass('explore-table-headers-th-active');
        $(el_window).find('.explore-table-headers-th--type').addClass('explore-table-headers-th-active');
        $(el_window).find('.explore-table-headers-th--type > .header-sort-icon').html(sort_icon);
    }
}

// This is a hack to fix the issue where the window scrolls to the bottom when an app scrolls.
// this is due to an issue with iframes being able to hijack the scroll event for the parent object.
// w3c is working on a fix for this, but it's not ready yet.
// more info here: https://github.com/w3c/webappsec-permissions-policy/issues/171
document.addEventListener('scroll', function (event) {
    if($(event.target).hasClass('window-app') || $(event.target).hasClass('window-app-iframe') || $(event.target?.activeElement).hasClass('window-app-iframe')){
        setTimeout(function(){ 
            // scroll window back to top
            $('.window-app').scrollTop(0);
            // some times it's document that scrolls, so we need to check that too
            $(document).scrollTop(0);
        }, 1);
    }
}, true);

// Function to save sidebar order to user preferences
async function saveSidebarOrder(order) {
    try {
        await puter.kv.set({
            key: "sidebar_items",
            value: JSON.stringify(order)
        });

        // Save to window object for quick access
        window.sidebar_items = JSON.stringify(order);
    } catch(err) {
        console.error('Error saving sidebar order:', err);
    }
}

export default UIWindow;
