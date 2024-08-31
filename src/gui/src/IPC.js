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

import UIAlert from './UI/UIAlert.js';
import UIWindow from './UI/UIWindow.js';
import UIWindowSignup from './UI/UIWindowSignup.js';
import UIWindowRequestPermission from './UI/UIWindowRequestPermission.js';
import UIItem from './UI/UIItem.js'
import UIWindowFontPicker from './UI/UIWindowFontPicker.js';
import UIWindowColorPicker from './UI/UIWindowColorPicker.js';
import UIPrompt from './UI/UIPrompt.js';
import download from './helpers/download.js';
import path from "./lib/path.js";
import UIContextMenu from './UI/UIContextMenu.js';
import update_mouse_position from './helpers/update_mouse_position.js';
import item_icon from './helpers/item_icon.js';

window.ipc_handlers = {};
/**
 * In Puter, apps are loaded in iframes and communicate with the graphical user interface (GUI), and each other, using the postMessage API.
 * The following sets up an Inter-Process Messaging System between apps and the GUI that enables communication
 * for various tasks such as displaying alerts, prompts, managing windows, handling file operations, and more.
 * 
 * The system listens for 'message' events on the window object, handling different types of messages from the app (which is loaded in an iframe),
 * such as ALERT, createWindow, showOpenFilePicker, ... 
 * Each message handler performs specific actions, including creating UI windows, handling file saves and reads, and responding to user interactions.
 * 
 * Precautions are taken to ensure proper usage of appInstanceIDs and other sensitive information.
 */
window.addEventListener('message', async (event) => {
    const app_env = event.data?.env ?? 'app';
    
    // Only process messages from apps
    if(app_env !== 'app')
        return;

    // --------------------------------------------------------
    // A response to a GUI message received from the app.
    // --------------------------------------------------------
    if (typeof event.data.original_msg_id !== "undefined" && typeof window.appCallbackFunctions[event.data.original_msg_id] !== "undefined") {
        // Execute callback
        window.appCallbackFunctions[event.data.original_msg_id](event.data);
        // Remove this callback function since it won't be needed again
        delete window.appCallbackFunctions[event.data.original_msg_id];

        // Done
        return;
    }

    // --------------------------------------------------------
    // Message from apps
    // --------------------------------------------------------

    // `data` and `msg` are required
    if(!event.data || !event.data.msg){
        return;
    }

    // `appInstanceID` is required
    if(!event.data.appInstanceID){
        console.error(`appInstanceID is needed`);
        return;
    }else if(!window.app_instance_ids.has(event.data.appInstanceID)){
        console.error(`appInstanceID is invalid`);
        return;
    }

    const $el_parent_window = $(window.window_for_app_instance(event.data.appInstanceID));
    const parent_window_id = $el_parent_window.attr('data-id');
    const $el_parent_disable_mask = $el_parent_window.find('.window-disable-mask');
    const target_iframe = window.iframe_for_app_instance(event.data.appInstanceID);
    const msg_id = event.data.uuid;
    const app_name = $(target_iframe).attr('data-app');
    const app_uuid = $el_parent_window.attr('data-app_uuid');
    
    // New IPC handlers should be registered here.
    // Do this by calling `register_ipc_handler` of IPCService.
    if ( window.ipc_handlers.hasOwnProperty(event.data.msg) ) {
        // The IPC context contains information about the call
        const ipc_context = {
            appInstanceId: event.data.appInstanceID,
        };
        
        // Registered IPC handlers are an object with a `handle()`
        // method. We call it "spec" here, meaning specification.
        const spec = window.ipc_handlers[event.data.msg];
        await spec.handler(event.data, { msg_id, ipc_context });
        
        // Early-return to avoid redundant invokation of any
        // legacy IPC handler.
        return;
    }

    // todo validate all event.data stuff coming from the client (e.g. event.data.message, .msg, ...)
    //-------------------------------------------------
    // READY
    //-------------------------------------------------
    if(event.data.msg === 'READY'){
        $(target_iframe).attr('data-appUsesSDK', 'true');

        // If we were waiting to launch this as a child app, report to the parent that it succeeded.
        window.report_app_launched(event.data.appInstanceID, { uses_sdk: true });

        // Send any saved broadcasts to the new app
        globalThis.services.get('broadcast').sendSavedBroadcastsTo(event.data.appInstanceID);

        // If `window-active` is set (meanign the window is focused), focus the window one more time
        // this is to ensure that the iframe is `definitely` focused and can receive keyboard events (e.g. keydown)
        if($el_parent_window.hasClass('window-active')){
            $el_parent_window.focusWindow();
        }

    }
    //-------------------------------------------------
    // windowFocused
    //-------------------------------------------------
    else if(event.data.msg === 'windowFocused'){
        // TODO: Respond to this
    }
    //--------------------------------------------------------
    // ALERT
    //--------------------------------------------------------
    else if(event.data.msg === 'ALERT' && event.data.message !== undefined){
        const alert_resp = await UIAlert({
            message: html_encode(event.data.message),
            buttons: event.data.buttons,
            type: event.data.options?.type,
            window_options: {
                parent_uuid: event.data.appInstanceID,
                disable_parent_window: true,
            }
        })

        target_iframe.contentWindow.postMessage({
            original_msg_id: msg_id,
            msg: 'alertResponded',
            response: alert_resp,
        }, '*');
    }
    //--------------------------------------------------------
    // PROMPT
    //--------------------------------------------------------
    else if(event.data.msg === 'PROMPT' && event.data.message !== undefined){
        const prompt_resp = await UIPrompt({
            message: html_encode(event.data.message),
            placeholder: html_encode(event.data.placeholder),
            window_options: {
                parent_uuid: event.data.appInstanceID,
                disable_parent_window: true,
            }
        })

        target_iframe.contentWindow.postMessage({
            original_msg_id: msg_id,
            msg: 'promptResponded',
            response: prompt_resp,
        }, '*');
    }
    //--------------------------------------------------------
    // env
    //--------------------------------------------------------
    else if(event.data.msg === 'env'){
        target_iframe.contentWindow.postMessage({
            original_msg_id: msg_id,
        }, '*');
    }
    //--------------------------------------------------------
    // createWindow
    //--------------------------------------------------------
    else if(event.data.msg === 'createWindow'){
        // todo: validate as many of these as possible
        if(event.data.options){
            const win = await UIWindow({
                title: event.data.options.title,
                disable_parent_window: event.data.options.disable_parent_window,
                width: event.data.options.width,
                height: event.data.options.height,
                is_resizable: event.data.options.is_resizable,
                has_head: event.data.options.has_head,
                center: event.data.options.center,
                show_in_taskbar: event.data.options.show_in_taskbar,                    
                iframe_srcdoc: event.data.options.content,
                parent_uuid: event.data.appInstanceID,
            })

            // create safe window object
            const safe_win = {
                id: $(win).attr('data-element_uuid'),
            }

            // send confirmation to requester window
            target_iframe.contentWindow.postMessage({
                original_msg_id: msg_id,
                window: safe_win,
            }, '*');
        }
    }
    //--------------------------------------------------------
    // setItem
    //--------------------------------------------------------
    else if(event.data.msg === 'setItem' && event.data.key && event.data.value){
        puter.kv.set({
            key: event.data.key,
            value: event.data.value,
            app_uid: app_uuid,
        }).then(() => {
            // send confirmation to requester window
            target_iframe.contentWindow.postMessage({
                original_msg_id: msg_id,
            }, '*');
        })
    }
    //--------------------------------------------------------
    // getItem
    //--------------------------------------------------------
    else if(event.data.msg === 'getItem' && event.data.key){
        puter.kv.get({
            key: event.data.key,
            app_uid: app_uuid,
        }).then((result) => {
            // send confirmation to requester window
            target_iframe.contentWindow.postMessage({
                original_msg_id: msg_id,
                msg: 'getItemSucceeded',
                value: result ?? null,
            }, '*');
        })
    }
    //--------------------------------------------------------
    // removeItem
    //--------------------------------------------------------
    else if(event.data.msg === 'removeItem' && event.data.key){
        puter.kv.del({
            key: event.data.key,
            app_uid: app_uuid,
        }).then(() => {
            // send confirmation to requester window
            target_iframe.contentWindow.postMessage({
                original_msg_id: msg_id,
            }, '*');
        })
    }
    //--------------------------------------------------------
    // showOpenFilePicker
    //--------------------------------------------------------
    else if(event.data.msg === 'showOpenFilePicker'){
        // Auth
        if(!window.is_auth() && !(await UIWindowSignup({referrer: app_name})))
            return;

        // Disable parent window
        $el_parent_window.addClass('window-disabled')
        $el_parent_disable_mask.show();
        $el_parent_disable_mask.css('z-index', parseInt($el_parent_window.css('z-index')) + 1);
        $(target_iframe).blur();

        // Allowed_file_types
        let allowed_file_types = "";
        if(event.data.options && event.data.options.accept)
            allowed_file_types = event.data.options.accept;

        // selectable_body
        let is_selectable_body = false;
        if(event.data.options && event.data.options.multiple && event.data.options.multiple === true)
            is_selectable_body = true;

        // Open dialog
        UIWindow({
            allowed_file_types: allowed_file_types,
            path: '/' + window.user.username + '/Desktop',
            // this is the uuid of the window to which this dialog will return
            parent_uuid: event.data.appInstanceID,
            show_maximize_button: false,
            show_minimize_button: false,
            title: 'Open',
            is_dir: true,
            is_openFileDialog: true,
            selectable_body: is_selectable_body,
            iframe_msg_uid: msg_id,
            initiating_app_uuid: app_uuid,
            center: true,
        });
    }
    //--------------------------------------------------------
    // showDirectoryPicker
    //--------------------------------------------------------
    else if(event.data.msg === 'showDirectoryPicker'){
        // Auth
        if(!window.is_auth() && !(await UIWindowSignup({referrer: app_name})))
            return;

        // Disable parent window
        $el_parent_window.addClass('window-disabled')
        $el_parent_disable_mask.show();
        $el_parent_disable_mask.css('z-index', parseInt($el_parent_window.css('z-index')) + 1);
        $(target_iframe).blur();

        // allowed_file_types
        let allowed_file_types = "";
        if(event.data.options && event.data.options.accept)
            allowed_file_types = event.data.options.accept;

        // selectable_body
        let is_selectable_body = false;
        if(event.data.options && event.data.options.multiple && event.data.options.multiple === true)
            is_selectable_body = true;

        // open dialog
        UIWindow({
            path: '/' + window.user.username + '/Desktop',
            // this is the uuid of the window to which this dialog will return
            parent_uuid: event.data.appInstanceID,
            show_maximize_button: false,
            show_minimize_button: false,
            title: 'Open',
            is_dir: true,
            is_directoryPicker: true,
            selectable_body: is_selectable_body,
            iframe_msg_uid: msg_id,
            center: true,
            initiating_app_uuid: app_uuid,
        });
    }
    //--------------------------------------------------------
    // setWindowTitle
    //--------------------------------------------------------
    else if(event.data.msg === 'setWindowTitle' && event.data.new_title !== undefined){
        let el_window;
        // specific window
        if( event.data.window_id )
            el_window = $(`.window[data-element_uuid="${html_encode(event.data.window_id)}"]`)
        // app window
        else
            el_window = window.window_for_app_instance(event.data.appInstanceID);

        // window not found
        if(!el_window || el_window.length === 0)
            return;

        // set window title
        $(el_window).find(`.window-head-title`).html(html_encode(event.data.new_title));
        // send confirmation to requester window
        target_iframe.contentWindow.postMessage({
            original_msg_id: msg_id, 
        }, '*');
    }
    //--------------------------------------------------------
    // mouseMoved
    //--------------------------------------------------------
    else if(event.data.msg === 'mouseMoved'){
        // Auth
        if(!window.is_auth() && !(await UIWindowSignup({referrer: app_name})))
            return;

        // get x and y and sanitize
        let x = parseInt(event.data.x);
        let y = parseInt(event.data.y);

        // get parent window
        const el_window = window.window_for_app_instance(event.data.appInstanceID);

        // get window position
        const window_position = $(el_window).position();

        // does this window have a menubar?
        const $menubar = $(el_window).find('.window-menubar');
        if($menubar.length > 0){
            y += $menubar.height();
        }

        // does this window have a head?
        const $head = $(el_window).find('.window-head');
        if($head.length > 0 && $head.css('display') !== 'none'){
            y += $head.height();
        }

        // update mouse position
        update_mouse_position(x + window_position.left, y + window_position.top);
    }

    //--------------------------------------------------------
    // contextMenu
    //--------------------------------------------------------
    else if(event.data.msg === 'contextMenu'){
        // Auth
        if(!window.is_auth() && !(await UIWindowSignup({referrer: app_name})))
            return;

        const hydrator = puter.util.rpc.getHydrator({
            target: target_iframe.contentWindow,
        });
        let value = hydrator.hydrate(event.data.value);

        // get parent window
        const el_window = window.window_for_app_instance(event.data.appInstanceID);

        let items = value.items ?? [];
        const sanitize_items = items => {
            return items.map(item => {
                // make sure item.icon and item.icon_active are valid base64 strings
                if (item.icon && !item.icon.startsWith('data:image')) {
                    item.icon = undefined;
                }
                if (item.icon_active && !item.icon_active.startsWith('data:image')) {
                    item.icon_active = undefined;
                }
                // Check if the item is just '-'
                if (item === '-') {
                    return '-';
                }
                // Otherwise, proceed as before
                return {
                    html: html_encode(item.label),
                    icon: item.icon ? `<img style="width: 15px; height: 15px; position: absolute; top: 4px; left: 6px;" src="${html_encode(item.icon)}" />` : undefined,
                    icon_active: item.icon_active ? `<img style="width: 15px; height: 15px; position: absolute; top: 4px; left: 6px;" src="${html_encode(item.icon_active)}" />` : undefined,
                    disabled: item.disabled,
                    onClick: () => {
                        if (item.action !== undefined) {
                            item.action();
                        }
                        // focus the window
                        $(el_window).focusWindow();
                    },
                    items: item.items ? sanitize_items(item.items) : undefined
                };
            });
        };

        items = sanitize_items(items);

        // Open context menu
        UIContextMenu({
            items: items,
        });

        $(target_iframe).get(0).focus({preventScroll:true});
    }
    // --------------------------------------------------------
    // disableMenuItem
    // --------------------------------------------------------
    else if(event.data.msg === 'disableMenuItem'){
        set_menu_item_prop(window.menubars[event.data.appInstanceID], event.data.value.id, 'disabled', true);
    }
    // --------------------------------------------------------
    // enableMenuItem
    // --------------------------------------------------------
    else if(event.data.msg === 'enableMenuItem'){
        set_menu_item_prop(window.menubars[event.data.appInstanceID], event.data.value.id, 'disabled', false);
    }
    //--------------------------------------------------------
    // setMenuItemIcon
    //--------------------------------------------------------
    else if(event.data.msg === 'setMenuItemIcon'){
        set_menu_item_prop(window.menubars[event.data.appInstanceID], event.data.value.id, 'icon', event.data.value.icon);
    }
    //--------------------------------------------------------
    // setMenuItemIconActive
    //--------------------------------------------------------
    else if(event.data.msg === 'setMenuItemIconActive'){
        set_menu_item_prop(window.menubars[event.data.appInstanceID], event.data.value.id, 'icon_active', event.data.value.icon_active);
    }
    //--------------------------------------------------------
    // setMenuItemChecked
    //--------------------------------------------------------
    else if(event.data.msg === 'setMenuItemChecked'){
        set_menu_item_prop(window.menubars[event.data.appInstanceID], event.data.value.id, 'checked', event.data.value.checked);
    }
    //--------------------------------------------------------
    // setMenubar
    //--------------------------------------------------------
    else if(event.data.msg === 'setMenubar') {
        const el_window = window.window_for_app_instance(event.data.appInstanceID);

        const hydrator = puter.util.rpc.getHydrator({
            target: target_iframe.contentWindow,
        });
        const value = hydrator.hydrate(event.data.value);

        // Show menubar
        let $menubar;
        if(window.menubar_style === 'window')
            $menubar = $(el_window).find('.window-menubar')
        else{
            $menubar = $('.window-menubar-global[data-window-id="'+$(el_window).attr('data-id')+'"]');
            // hide all other menubars
            $('.window-menubar-global').hide();
        }
        
        $menubar.css('display', 'flex');

        // disable system context menu
        $menubar.on('contextmenu', (e) => {
            e.preventDefault();
        });

        // empty menubar
        $menubar.empty();

        if(!window.menubars[event.data.appInstanceID])
            window.menubars[event.data.appInstanceID] = value.items;

        // disable system context menu
        $menubar.on('contextmenu', (e) => {
            e.preventDefault();
        });

        const sanitize_items = items => {
            return items.map(item => {
                // Check if the item is just '-'
                if (item === '-') {
                    return '-';
                }
                // Otherwise, proceed as before
                return {
                    html: html_encode(item.label),
                    disabled: item.disabled,
                    checked: item.checked,
                    icon: item.icon ? `<img style="width: 15px; height: 15px; position: absolute; top: 4px; left: 6px;" src="${html_encode(item.icon)}" />` : undefined,
                    icon_active: item.icon_active ? `<img style="width: 15px; height: 15px; position: absolute; top: 4px; left: 6px;" src="${html_encode(item.icon_active)}" />` : undefined,
                    action: item.action,
                    items: item.items ? sanitize_items(item.items) : undefined
                };
            });
        };
          
        // This array will store the menubar button elements
        const menubar_buttons = [];

        // Add menubar items
        let current = null;
        let current_i = null;
        let state_open = false;
        const open_menu = ({ i, pos, parent_element, items }) => {
            let delay = true;
            if ( state_open ) {
                // if already open, keep it open
                if ( current_i === i ) return;

                delay = false;
                current && current.cancel({ meta: 'menubar', fade: false });
            }

            // Close all other context menus
            $('.context-menu').remove();

            // Set this menubar button as active
            menubar_buttons.forEach(el => el.removeClass('active'));
            menubar_buttons[i].addClass('active');

            // Open the context menu
            const ctxMenu = UIContextMenu({
                delay: delay,
                parent_element: parent_element,
                position: {top: pos.top + 30, left: pos.left},
                css: {
                    'box-shadow': '0px 2px 6px #00000059'
                },
                items: sanitize_items(items),
            });

            state_open = true;
            current = ctxMenu;
            current_i = i;

            ctxMenu.onClose = (cancel_options) => {
                if ( cancel_options?.meta === 'menubar' ) return;
                menubar_buttons.forEach(el => el.removeClass('active'));
                ctxMenu.onClose = null;
                current_i = null;
                current = null;
                state_open = false;
            }
        };
        const add_items = (parent, items) => {
            for (let i=0; i < items.length; i++) {
                const I = i;
                const item = items[i];
                const label = html_encode(item.label);
                const el_item = $(`<div class="window-menubar-item"><span>${label}</span></div>`);
                const parent_element = el_item.get(0);
                
                el_item.on('mousedown', (e) => {
                    // check if it has has-open-context-menu class
                    if ( el_item.hasClass('has-open-contextmenu') ) {
                        return;
                    }
                    if ( state_open ) {
                        state_open = false;
                        current && current.cancel({ meta: 'menubar' });
                        current_i = null;
                        current = null;
                    }
                    if (item.items) {
                        const pos = el_item[0].getBoundingClientRect();
                        open_menu({
                            i,
                            pos,
                            parent_element,
                            items: item.items,
                        });
                        $(el_window).focusWindow(e);
                        e.stopPropagation();
                        e.preventDefault();
                        return;
                    }
                })
                
                // Clicking an item with an action will trigger that action
                el_item.on('click', () => {
                    if (item.action) {
                        item.action();
                    }
                });

                el_item.on('mouseover', () => {
                    if ( ! state_open ) return;
                    if ( ! item.items ) return;

                    const pos = el_item[0].getBoundingClientRect();
                    open_menu({
                        i,
                        pos,
                        parent_element,
                        items: item.items,
                    });
                });
                $menubar.append(el_item);
                menubar_buttons.push(el_item);
            }
        };
        add_items($menubar, window.menubars[event.data.appInstanceID]);
    }
    //--------------------------------------------------------
    // setWindowWidth
    //--------------------------------------------------------
    else if(event.data.msg === 'setWindowWidth' && event.data.width !== undefined){
        let el_window;
        // specific window
        if( event.data.window_id )
            el_window = $(`.window[data-element_uuid="${html_encode(event.data.window_id)}"]`)
        // app window
        else
            el_window = window.window_for_app_instance(event.data.appInstanceID);

        // window not found
        if(!el_window || el_window.length === 0)
            return;

        event.data.width = parseFloat(event.data.width);
        // must be at least 200
        if(event.data.width < 200)
            event.data.width = 200;
        // set window width
        $(el_window).css('width', event.data.width);
        // send confirmation to requester window
        target_iframe.contentWindow.postMessage({
            original_msg_id: msg_id, 
        }, '*');
    }
    //--------------------------------------------------------
    // setWindowHeight
    //--------------------------------------------------------
    else if(event.data.msg === 'setWindowHeight' && event.data.height !== undefined){
        let el_window;
        // specific window
        if( event.data.window_id )
            el_window = $(`.window[data-element_uuid="${html_encode(event.data.window_id)}"]`)
        // app window
        else
            el_window = window.window_for_app_instance(event.data.appInstanceID);

        // window not found
        if(!el_window || el_window.length === 0)
            return;

        event.data.height = parseFloat(event.data.height);
        // must be at least 200
        if(event.data.height < 200)
            event.data.height = 200;

        // convert to number and set
        $(el_window).css('height', event.data.height);

        // send confirmation to requester window
        target_iframe.contentWindow.postMessage({
            original_msg_id: msg_id, 
        }, '*');
    }
    //--------------------------------------------------------
    // setWindowSize
    //--------------------------------------------------------
    else if(event.data.msg === 'setWindowSize' && (event.data.width !== undefined || event.data.height !== undefined)){
        let el_window;
        // specific window
        if( event.data.window_id )
            el_window = $(`.window[data-element_uuid="${html_encode(event.data.window_id)}"]`)
        // app window
        else
            el_window = window.window_for_app_instance(event.data.appInstanceID);

        // window not found
        if(!el_window || el_window.length === 0)
            return;

        // convert to number and set
        if(event.data.width !== undefined){
            event.data.width = parseFloat(event.data.width);
            // must be at least 200
            if(event.data.width < 200)
                event.data.width = 200;
            $(el_window).css('width', event.data.width);
        }
        
        if(event.data.height !== undefined){
            event.data.height = parseFloat(event.data.height);
            // must be at least 200
            if(event.data.height < 200)
                event.data.height = 200;
            $(el_window).css('height', event.data.height);
        }

        // send confirmation to requester window
        target_iframe.contentWindow.postMessage({
            original_msg_id: msg_id, 
        }, '*');
    }
    //--------------------------------------------------------
    // setWindowPosition
    //--------------------------------------------------------
    else if(event.data.msg === 'setWindowPosition' && (event.data.x !== undefined || event.data.y !== undefined)){
        let el_window;
        // specific window
        if( event.data.window_id )
            el_window = $(`.window[data-element_uuid="${html_encode(event.data.window_id)}"]`)
        // app window
        else
            el_window = window.window_for_app_instance(event.data.appInstanceID);

        // window not found
        if(!el_window || el_window.length === 0)
            return;

        // convert to number and set
        if(event.data.x !== undefined){
            event.data.x = parseFloat(event.data.x);
            // we don't want the window to go off the left edge of the screen
            if(event.data.x < 0)
                event.data.x = 0;
            // we don't want the window to go off the right edge of the screen
            if(event.data.x > window.innerWidth - 100)
                event.data.x = window.innerWidth - 100;
            // set window left
            $(el_window).css('left', parseFloat(event.data.x));
        }

        if(event.data.y !== undefined){
            event.data.y = parseFloat(event.data.y);
            // we don't want the window to go off the top edge of the screen
            if(event.data.y < window.taskbar_height)
                event.data.y = window.taskbar_height;
            // we don't want the window to go off the bottom edge of the screen
            if(event.data.y > window.innerHeight - 100)
                event.data.y = window.innerHeight - 100;
            // set window top
            $(el_window).css('top', parseFloat(event.data.y));
        }

        // send confirmation to requester window
        target_iframe.contentWindow.postMessage({
            original_msg_id: msg_id, 
        }, '*');
    }
    //--------------------------------------------------------
    // setWindowX
    //--------------------------------------------------------
    else if(event.data.msg === 'setWindowX' && (event.data.x !== undefined)){
        let el_window;
        // specific window
        if( event.data.window_id )
            el_window = $(`.window[data-element_uuid="${html_encode(event.data.window_id)}"]`)
        // app window
        else
            el_window = window.window_for_app_instance(event.data.appInstanceID);

        // window not found
        if(!el_window || el_window.length === 0)
            return;

        // convert to number and set
        if(event.data.x !== undefined){
            event.data.x = parseFloat(event.data.x);
            // we don't want the window to go off the left edge of the screen
            if(event.data.x < 0)
                event.data.x = 0;
            // we don't want the window to go off the right edge of the screen
            if(event.data.x > window.innerWidth - 100)
                event.data.x = window.innerWidth - 100;
            // set window left
            $(el_window).css('left', parseFloat(event.data.x));
        }

        // send confirmation to requester window
        target_iframe.contentWindow.postMessage({
            original_msg_id: msg_id, 
        }, '*');
    }
    //--------------------------------------------------------
    // setWindowY
    //--------------------------------------------------------
    else if(event.data.msg === 'setWindowY' && (event.data.y !== undefined)){
        let el_window;
        // specific window
        if( event.data.window_id )
            el_window = $(`.window[data-element_uuid="${html_encode(event.data.window_id)}"]`)
        // app window
        else
            el_window = window.window_for_app_instance(event.data.appInstanceID);

        // window not found
        if(!el_window || el_window.length === 0)
            return;

        // convert to number and set
        if(event.data.y !== undefined){
            event.data.y = parseFloat(event.data.y);
            // we don't want the window to go off the top edge of the screen
            if(event.data.y < window.taskbar_height)
                event.data.y = window.taskbar_height;
            // we don't want the window to go off the bottom edge of the screen
            if(event.data.y > window.innerHeight - 100)
                event.data.y = window.innerHeight - 100;
            // set window top
            $(el_window).css('top', parseFloat(event.data.y));
        }

        // send confirmation to requester window
        target_iframe.contentWindow.postMessage({
            original_msg_id: msg_id, 
        }, '*');
    }    
    //--------------------------------------------------------
    // watchItem
    //--------------------------------------------------------
    else if(event.data.msg === 'watchItem' && event.data.item_uid !== undefined){
        if(!window.watchItems[event.data.item_uid])
            window.watchItems[event.data.item_uid] = [];

        window.watchItems[event.data.item_uid].push(event.data.appInstanceID);
    }
    //--------------------------------------------------------
    // readAppDataFile
    //--------------------------------------------------------
    else if(event.data.msg === 'readAppDataFile' && event.data.path !== undefined){
        // resolve path to absolute
        event.data.path = path.resolve(event.data.path);
        
        // join with appdata dir
        const file_path = path.join(window.appdata_path, app_uuid, event.data.path);

        puter.fs.sign(app_uuid, {
                path: file_path, 
                action: 'write',
            }, 
            function(signature){
                signature = signature.items;
                signature.signatures = signature.signatures ?? [signature];
                if(signature.signatures.length > 0 && signature.signatures[0].path){
                    signature.signatures[0].path = privacy_aware_path(signature.signatures[0].path)
                    // send confirmation to requester window
                    target_iframe.contentWindow.postMessage({
                        msg: "readAppDataFileSucceeded",
                        original_msg_id: msg_id, 
                        item: signature.signatures[0],
                    }, '*');
                }else{
                    // send error to requester window
                    target_iframe.contentWindow.postMessage({
                        msg: "readAppDataFileFailed",
                        original_msg_id: msg_id, 
                    }, '*');
                }
            }
        )
    }
    //--------------------------------------------------------
    // getAppData
    //--------------------------------------------------------
    // todo appdata should be provided from the /open_item api call
    else if(event.data.msg === 'getAppData'){
        if(window.appdata_signatures[app_uuid]){
            target_iframe.contentWindow.postMessage({
                msg: "getAppDataSucceeded",
                original_msg_id: msg_id, 
                item: window.appdata_signatures[app_uuid],
            }, '*');    
        }
        // make app directory if it doesn't exist
        puter.fs.mkdir({
            path: path.join( window.appdata_path, app_uuid),
            rename: false,
            overwrite: false,
            success: function(dir){
                puter.fs.sign(app_uuid, {
                    uid: dir.uid, 
                    action: 'write',
                    success: function(signature){
                        signature = signature.items;
                        window.appdata_signatures[app_uuid] = signature;
                        // send confirmation to requester window
                        target_iframe.contentWindow.postMessage({
                            msg: "getAppDataSucceeded",
                            original_msg_id: msg_id, 
                            item: signature,
                        }, '*');
                    }
                })
            },
            error: function(err){
                if(err.existing_fsentry || err.code === 'path_exists'){
                    puter.fs.sign(app_uuid, {
                        uid: err.existing_fsentry.uid, 
                        action: 'write',
                        success: function(signature){
                            signature = signature.items;
                            window.appdata_signatures[app_uuid] = signature;
                            // send confirmation to requester window
                            target_iframe.contentWindow.postMessage({
                                msg: "getAppDataSucceeded",
                                original_msg_id: msg_id, 
                                item: signature,
                            }, '*');
                        }
                    })    
                }
            }
        });
    }
    //--------------------------------------------------------
    // requestPermission
    //--------------------------------------------------------
    else if(event.data.msg === 'requestPermission'){
        // auth
        if(!window.is_auth() && !(await UIWindowSignup({referrer: app_name})))
            return;

        // options must be an object
        if(event.data.options === undefined || typeof event.data.options !== 'object')
            event.data.options = {};

        // clear window_options for security reasons
        event.data.options.window_options = {}

        // Set app as parent window of font picker window
        event.data.options.window_options.parent_uuid = event.data.appInstanceID;

        // disable parent window
        event.data.options.window_options.disable_parent_window = true;

        let granted = await UIWindowRequestPermission({
            origin: event.origin,
            permission: event.data.options.permission,
            window_options: event.data.options.window_options,
        });

        // send selected font to requester window
        target_iframe.contentWindow.postMessage({
            msg: "permissionGranted", 
            granted: granted,
            original_msg_id: msg_id, 
        }, '*');
        $(target_iframe).get(0).focus({preventScroll:true});
    }
    //--------------------------------------------------------
    // showFontPicker
    //--------------------------------------------------------
    else if(event.data.msg === 'showFontPicker'){
        // auth
        if(!window.is_auth() && !(await UIWindowSignup({referrer: app_name})))
            return;

        // set options
        event.data.options = event.data.options ?? {};

        // clear window_options for security reasons
        event.data.options.window_options = {}

        // Set app as parent window of font picker window
        event.data.options.window_options.parent_uuid = event.data.appInstanceID;

        // Open font picker
        let selected_font = await UIWindowFontPicker(event.data.options);

        // send selected font to requester window
        target_iframe.contentWindow.postMessage({
            msg: "fontPicked", 
            original_msg_id: msg_id, 
            font: selected_font,
        }, '*');
        $(target_iframe).get(0).focus({preventScroll:true});
    }
    //--------------------------------------------------------
    // showColorPicker
    //--------------------------------------------------------
    else if(event.data.msg === 'showColorPicker'){
        // Auth
        if(!window.is_auth() && !(await UIWindowSignup({referrer: app_name})))
            return;

        // set options
        event.data.options = event.data.options ?? {};

        // Clear window_options for security reasons
        event.data.options.window_options = {}

        // Set app as parent window of the font picker window
        event.data.options.window_options.parent_uuid = event.data.appInstanceID;

        // Open color picker
        let selected_color = await UIWindowColorPicker(event.data.options);

        // Send selected color to requester window
        target_iframe.contentWindow.postMessage({
            msg: "colorPicked", 
            original_msg_id: msg_id, 
            color: selected_color ? selected_color.color : undefined,
        }, '*');
        $(target_iframe).get(0).focus({preventScroll:true});
    }        
    //--------------------------------------------------------
    // setWallpaper
    //--------------------------------------------------------
    else if(event.data.msg === 'setWallpaper'){
        // Auth
        if(!window.is_auth() && !(await UIWindowSignup({referrer: app_name})))
            return;

        // No options?
        if(!event.data.options)
            event.data.options = {};

        // /set-desktop-bg
        try{
            await $.ajax({
                url: window.api_origin + "/set-desktop-bg",
                type: 'POST',
                data: JSON.stringify({ 
                    url: event.data.readURL,
                    fit: event.data.options.fit ?? 'cover',
                    color: event.data.options.color,
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
            });

            // Set wallpaper
            window.set_desktop_background({
                url: event.data.readURL,
                fit: event.data.options.fit ?? 'cover',
                color: event.data.options.color,
            })
    
            // Send success to app
            target_iframe.contentWindow.postMessage({
                msg: "wallpaperSet", 
                original_msg_id: msg_id, 
            }, '*');
            $(target_iframe).get(0).focus({preventScroll:true});
        }catch(err){
            console.error(err);
        }
    }        

    //--------------------------------------------------------
    // showSaveFilePicker
    //--------------------------------------------------------
    else if(event.data.msg === 'showSaveFilePicker'){
        //auth
        if(!window.is_auth() && !(await UIWindowSignup({referrer: app_name})))
            return;

        //disable parent window
        $el_parent_window.addClass('window-disabled')
        $el_parent_disable_mask.show();
        $el_parent_disable_mask.css('z-index', parseInt($el_parent_window.css('z-index')) + 1);
        $(target_iframe).blur();

        await UIWindow({
            path: '/' + window.user.username + '/Desktop',
            // this is the uuid of the window to which this dialog will return
            parent_uuid: event.data.appInstanceID,
            show_maximize_button: false,
            show_minimize_button: false,
            title: 'Save As…',
            is_dir: true,
            is_saveFileDialog: true,
            saveFileDialog_default_filename: event.data.suggestedName ?? '',
            selectable_body: false,
            iframe_msg_uid: msg_id,
            center: true,
            initiating_app_uuid: app_uuid,
            onSaveFileDialogSave: async function(target_path, el_filedialog_window){
                $(el_filedialog_window).find('.window-disable-mask, .busy-indicator').show();
                let busy_init_ts = Date.now();

                // -------------------------------------
                // URL
                // -------------------------------------
                if(event.data.url){
                    // download progress tracker
                    let dl_op_id = window.operation_id++;

                    // upload progress tracker defaults
                    window.progress_tracker[dl_op_id] = [];
                    window.progress_tracker[dl_op_id][0] = {};
                    window.progress_tracker[dl_op_id][0].total = 0;
                    window.progress_tracker[dl_op_id][0].ajax_uploaded = 0;
                    window.progress_tracker[dl_op_id][0].cloud_uploaded = 0;

                    let item_with_same_name_already_exists = true;
                    while(item_with_same_name_already_exists){
                        await download({
                            url: event.data.url, 
                            name: path.basename(target_path),
                            dest_path: path.dirname(target_path),
                            auth_token: window.auth_token,
                            api_origin: window.api_origin,
                            dedupe_name: false,
                            overwrite: false,
                            operation_id: dl_op_id,
                            item_upload_id: 0,
                            success: function(res){
                            },
                            error: function(err){
                                UIAlert(err && err.message ? err.message : "Download failed.");
                            }
                        });
                        item_with_same_name_already_exists = false;
                    }
                }
                // -------------------------------------
                // File
                // -------------------------------------
                else{
                    let overwrite = false;
                    let file_to_upload = new File([event.data.content], path.basename(target_path));
                    let item_with_same_name_already_exists = true;
                    while(item_with_same_name_already_exists){
                        // overwrite?
                        if(overwrite)
                            item_with_same_name_already_exists = false;
                        // upload
                        try{
                            const res = await puter.fs.write(
                                target_path,
                                file_to_upload, 
                                { 
                                    dedupeName: false,
                                    overwrite: overwrite
                                }
                            );

                            let file_signature = await puter.fs.sign(app_uuid, {uid: res.uid, action: 'write'});
                            file_signature = file_signature.items;

                            item_with_same_name_already_exists = false;
                            target_iframe.contentWindow.postMessage({
                                msg: "fileSaved", 
                                original_msg_id: msg_id, 
                                filename: res.name,
                                saved_file: {
                                    name: file_signature.fsentry_name,
                                    readURL: file_signature.read_url,
                                    writeURL: file_signature.write_url,
                                    metadataURL: file_signature.metadata_url,
                                    type: file_signature.type,
                                    uid: file_signature.uid,
                                    path: privacy_aware_path(res.path)
                                },
                            }, '*');

                            $(target_iframe).get(0).focus({preventScroll:true});
                            // Update matching items on open windows
                            // todo don't blanket-update, mostly files with thumbnails really need to be updated
                            // first remove overwritten items
                            $(`.item[data-uid="${res.uid}"]`).removeItems();
                            // now add new items
                            UIItem({
                                appendTo: $(`.item-container[data-path="${html_encode(path.dirname(target_path))}" i]`),
                                immutable: res.immutable,
                                associated_app_name: res.associated_app?.name,
                                path: target_path,
                                icon: await item_icon(res),
                                name: path.basename(target_path),
                                uid: res.uid,
                                size: res.size,
                                modified: res.modified,
                                type: res.type,
                                is_dir: false,
                                is_shared: res.is_shared,
                                suggested_apps: res.suggested_apps,
                            });
                            // sort each window
                            $(`.item-container[data-path="${html_encode(path.dirname(target_path))}" i]`).each(function(){
                                window.sort_items(this, $(this).attr('data-sort_by'), $(this).attr('data-sort_order'))
                            });                            
                            $(el_filedialog_window).close();
                            window.show_save_account_notice_if_needed();
                        }
                        catch(err){
                            // item with same name exists
                            if(err.code === 'item_with_same_name_exists'){
                                const alert_resp = await UIAlert({
                                    message: `<strong>${html_encode(err.entry_name)}</strong> already exists.`,
                                    buttons:[
                                        {
                                            label: i18n('replace'),
                                            value: 'replace',
                                            type: 'primary',
                                        },
                                        {
                                            label: i18n('cancel'),
                                            value: 'cancel',
                                        },
                                    ],
                                    parent_uuid: $(el_filedialog_window).attr('data-element_uuid'),
                                })
                                if(alert_resp === 'replace'){
                                    overwrite = true;
                                }else if(alert_resp === 'cancel'){
                                    // enable parent window
                                    $(el_filedialog_window).find('.window-disable-mask, .busy-indicator').hide();
                                    return;
                                }
                            }
                            else{
                                // show error
                                await UIAlert({
                                    message: err.message ?? "Upload failed.",
                                    parent_uuid: $(el_filedialog_window).attr('data-element_uuid'),
                                });
                                // enable parent window
                                $(el_filedialog_window).find('.window-disable-mask, .busy-indicator').hide();
                                return;
                            }
                        }
                    }
                }

                // done
                let busy_duration = (Date.now() - busy_init_ts);
                if( busy_duration >= window.busy_indicator_hide_delay){
                    $(el_filedialog_window).close();   
                }else{
                    setTimeout(() => {
                        // close this dialog
                        $(el_filedialog_window).close();  
                    }, Math.abs(window.busy_indicator_hide_delay - busy_duration));
                }
            }
        });
    }
    //--------------------------------------------------------
    // saveToPictures/Desktop/Documents/Videos/Audio/AppData
    //--------------------------------------------------------
    else if((event.data.msg === 'saveToPictures' || event.data.msg === 'saveToDesktop' || event.data.msg === 'saveToAppData' || 
            event.data.msg === 'saveToDocuments' || event.data.msg === 'saveToVideos' || event.data.msg === 'saveToAudio')){
        let target_path;
        let create_missing_ancestors = false;

        console.warn(`The method ${event.data.msg} is deprecated - see docs.puter.com for more information.`);
        event.data.filename = path.normalize(event.data.filename)
            .replace(/(\.+\/|\.+\\)/g, '');

        if(event.data.msg === 'saveToPictures')
            target_path = path.join(window.pictures_path, event.data.filename);
        else if(event.data.msg === 'saveToDesktop')
            target_path = path.join(window.desktop_path, event.data.filename);
        else if(event.data.msg === 'saveToDocuments')
            target_path = path.join(window.documents_path, event.data.filename);
        else if(event.data.msg === 'saveToVideos')
            target_path = path.join(window.videos_path, event.data.filename);
        else if(event.data.msg === 'saveToAudio')
            target_path = path.join(window.audio_path, event.data.filename);
        else if(event.data.msg === 'saveToAppData'){
            target_path = path.join(window.appdata_path, app_uuid, event.data.filename);
            create_missing_ancestors = true;
        }
        //auth
        if(!window.is_auth() && !(await UIWindowSignup({referrer: app_name})))
            return;

        let item_with_same_name_already_exists = true;
        let overwrite = false;

        // -------------------------------------
        // URL
        // -------------------------------------
        if(event.data.url){
            let overwrite = false;
            // download progress tracker
            let dl_op_id = window.operation_id++;

            // upload progress tracker defaults
            window.progress_tracker[dl_op_id] = [];
            window.progress_tracker[dl_op_id][0] = {};
            window.progress_tracker[dl_op_id][0].total = 0;
            window.progress_tracker[dl_op_id][0].ajax_uploaded = 0;
            window.progress_tracker[dl_op_id][0].cloud_uploaded = 0;

            let item_with_same_name_already_exists = true;
            while(item_with_same_name_already_exists){
                const res = await download({
                    url: event.data.url, 
                    name: path.basename(target_path),
                    dest_path: path.dirname(target_path),
                    auth_token: window.auth_token,
                    api_origin: window.api_origin,
                    dedupe_name: true,
                    overwrite: false,
                    operation_id: dl_op_id,
                    item_upload_id: 0,
                    success: function(res){
                    },
                    error: function(err){
                        UIAlert(err && err.message ? err.message : "Download failed.");
                    }
                });
                item_with_same_name_already_exists = false;
            }
        }
        // -------------------------------------
        // File
        // -------------------------------------
        else{
            let file_to_upload = new File([event.data.content], path.basename(target_path));
            
            while(item_with_same_name_already_exists){
                if(overwrite)
                    item_with_same_name_already_exists = false;
                try{
                    const res = await puter.fs.write(target_path, file_to_upload, {
                        dedupeName: true,
                        overwrite: false,
                        createMissingAncestors: create_missing_ancestors,
                    });
                    item_with_same_name_already_exists = false;
                    let file_signature = await puter.fs.sign(app_uuid, {uid: res.uid, action: 'write'});
                    file_signature = file_signature.items;

                    target_iframe.contentWindow.postMessage({
                        msg: "fileSaved", 
                        original_msg_id: msg_id, 
                        filename: res.name,
                        saved_file: {
                            name: file_signature.fsentry_name,
                            readURL: file_signature.read_url,
                            writeURL: file_signature.write_url,
                            metadataURL: file_signature.metadata_url,
                            uid: file_signature.uid,
                            path: privacy_aware_path(res.path),
                        },
                    }, '*');
                    $(target_iframe).get(0).focus({preventScroll:true});
                }
                catch(err){
                    if(err.code === 'item_with_same_name_exists'){
                        const alert_resp = await UIAlert({
                            message: `<strong>${html_encode(err.entry_name)}</strong> already exists.`,
                            buttons:[
                                {
                                    label: i18n('replace'),
                                    type: 'primary',
                                },
                                {
                                    label: i18n('cancel'),
                                    value: 'cancel'
                                },
                            ],
                            parent_uuid: event.data.appInstanceID,
                        })
                        if(alert_resp === 'Replace'){
                            overwrite = true;
                        }else if(alert_resp === 'cancel'){
                            item_with_same_name_already_exists = false;
                        }
                    }else{
                        break;
                    }
                }
            }
        }
    }
    //--------------------------------------------------------
    // messageToApp
    //--------------------------------------------------------
    else if (event.data.msg === 'messageToApp') {
        const { appInstanceID, targetAppInstanceID, targetAppOrigin, contents } = event.data;
        // TODO: Determine if we should allow the message
        // TODO: Track message traffic between apps

        // pass on the message
        const target_iframe = window.iframe_for_app_instance(targetAppInstanceID);
        if (!target_iframe) {
            console.error('Failed to send message to non-existent app', event);
            return;
        }
        target_iframe.contentWindow.postMessage({
            msg: 'messageToApp',
            appInstanceID,
            targetAppInstanceID,
            contents,
        }, targetAppOrigin);
    }
    //--------------------------------------------------------
    // closeApp
    //--------------------------------------------------------
    else if (event.data.msg === 'closeApp') {
        const { appInstanceID, targetAppInstanceID } = event.data;

        const target_window = window.window_for_app_instance(targetAppInstanceID);
        if (!target_window) {
            console.warn(`Failed to close non-existent app ${targetAppInstanceID}`);
            return;
        }

        // Check permissions
        const allowed = await (async () => {
            // Parents can close their children
            if (target_window.dataset['parent_instance_id'] === appInstanceID) {
                console.log(`⚠️ Allowing app ${appInstanceID} to close child app ${targetAppInstanceID}`);
                return true;
            }

            // God-mode apps can close anything
            const app_info = await window.get_apps(app_name);
            if (app_info.godmode === 1) {
                console.log(`⚠️ Allowing GODMODE app ${appInstanceID} to close app ${targetAppInstanceID}`);
                return true;
            }

            // TODO: What other situations should we allow?
            return false;
        })();

        if (allowed) {
            $(target_window).close();
        } else {
            console.warn(`⚠️ App ${appInstanceID} is not permitted to close app ${targetAppInstanceID}`);
        }
    }

    //--------------------------------------------------------
    // exit
    //--------------------------------------------------------
    else if(event.data.msg === 'exit'){
        // Ensure status code is a number. Convert any truthy non-numbers to 1.
        let status_code = event.data.statusCode ?? 0;
        if (status_code && (typeof status_code !== 'number')) {
            status_code = 1;
        }

        $(window.window_for_app_instance(event.data.appInstanceID)).close({
            bypass_iframe_messaging: true,
            status_code,
        });
    }
});
