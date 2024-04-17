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

/**
 * In Puter, apps are loaded in iframes and communicate with the graphical user interface (GUI) aand each other using the postMessage API.
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
    if (typeof event.data.original_msg_id !== "undefined" && typeof appCallbackFunctions[event.data.original_msg_id] !== "undefined") {
        // Execute callback
        appCallbackFunctions[event.data.original_msg_id](event.data);
        // Remove this callback function since it won't be needed again
        delete appCallbackFunctions[event.data.original_msg_id];

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
        console.log(`appInstanceID is needed`);
        return;
    }

    const $el_parent_window = $(window_for_app_instance(event.data.appInstanceID));
    const parent_window_id = $el_parent_window.attr('data-id');
    const $el_parent_disable_mask = $el_parent_window.find('.window-disable-mask');
    const target_iframe = iframe_for_app_instance(event.data.appInstanceID);
    const msg_id = event.data.uuid;
    const app_name = $(target_iframe).attr('data-app');
    const app_uuid = $el_parent_window.attr('data-app_uuid');

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
    }
    //-------------------------------------------------
    // windowFocused
    //-------------------------------------------------
    else if(event.data.msg === 'windowFocused'){
        console.log('windowFocused');
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
            UIWindow({
                title: event.data.options.title,
                disable_parent_window: event.data.options.disable_parent_window,
                width: event.data.options.width,
                height: event.data.options.height,
                is_resizable: event.data.options.is_resizable,
                has_head: event.data.options.has_head,
                center: event.data.options.center,
                show_in_taskbar: event.data.options.show_in_taskbar,                    
                iframe_srcdoc: event.data.options.content,
                iframe_url: event.data.options.url,
                parent_uuid: event.data.appInstanceID,
            })
        }
    }
    //--------------------------------------------------------
    // setItem
    //--------------------------------------------------------
    else if(event.data.msg === 'setItem' && event.data.key && event.data.value){
        // todo: validate key and value to avoid unnecessary api calls
        return await $.ajax({
            url: api_origin + "/setItem",
            type: 'POST',
            data: JSON.stringify({ 
                app: app_uuid,
                key: event.data.key,
                value: event.data.value,
            }),
            async: true,
            contentType: "application/json",
            headers: {
                "Authorization": "Bearer "+auth_token
            },
            statusCode: {
                401: function () {
                    logout();
                },
            },        
            success: function (fsentry){
            }  
        })
    }
    //--------------------------------------------------------
    // getItem
    //--------------------------------------------------------
    else if(event.data.msg === 'getItem' && event.data.key){
        // todo: validate key to avoid unnecessary api calls
        $.ajax({
            url: api_origin + "/getItem",
            type: 'POST',
            data: JSON.stringify({ 
                key: event.data.key,
                app: app_uuid,
            }),
            async: true,
            contentType: "application/json",
            headers: {
                "Authorization": "Bearer "+auth_token
            },
            statusCode: {
                401: function () {
                    logout();
                },
            },        
            success: function (result){
                // send confirmation to requester window
                target_iframe.contentWindow.postMessage({
                    original_msg_id: msg_id,
                    msg: 'getItemSucceeded',
                    value: result ? result.value : null,
                }, '*');
            }  
        })
    }
    //--------------------------------------------------------
    // removeItem
    //--------------------------------------------------------
    else if(event.data.msg === 'removeItem' && event.data.key){
        // todo: validate key to avoid unnecessary api calls
        $.ajax({
            url: api_origin + "/removeItem",
            type: 'POST',
            data: JSON.stringify({ 
                key: event.data.key,
                app: app_uuid,
            }),
            async: true,
            contentType: "application/json",
            headers: {
                "Authorization": "Bearer "+auth_token
            },
            statusCode: {
                401: function () {
                    logout();
                },
            },        
            success: function (result){
                // send confirmation to requester window
                target_iframe.contentWindow.postMessage({
                    original_msg_id: msg_id,
                }, '*');
            }  
        })
    }
    //--------------------------------------------------------
    // showOpenFilePicker
    //--------------------------------------------------------
    else if(event.data.msg === 'showOpenFilePicker'){
        // Auth
        if(!is_auth() && !(await UIWindowSignup({referrer: app_name})))
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
        if(!is_auth() && !(await UIWindowSignup({referrer: app_name})))
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
        const el_window = window_for_app_instance(event.data.appInstanceID);
        // set window title
        $(el_window).find(`.window-head-title`).html(html_encode(event.data.new_title));
        // send confirmation to requester window
        target_iframe.contentWindow.postMessage({
            original_msg_id: msg_id, 
        }, '*');
    }
    //--------------------------------------------------------
    // setWindowWidth
    //--------------------------------------------------------
    else if(event.data.msg === 'setWindowWidth' && event.data.width !== undefined){
        event.data.width = parseFloat(event.data.width);
        // must be at least 200
        if(event.data.width < 200)
            event.data.width = 200;
        // set window width
        $($el_parent_window).css('width', event.data.width);
        // send confirmation to requester window
        target_iframe.contentWindow.postMessage({
            original_msg_id: msg_id, 
        }, '*');
    }
    //--------------------------------------------------------
    // setWindowHeight
    //--------------------------------------------------------
    else if(event.data.msg === 'setWindowHeight' && event.data.height !== undefined){
        event.data.height = parseFloat(event.data.height);
        // must be at least 200
        if(event.data.height < 200)
            event.data.height = 200;

        // convert to number and set
        $($el_parent_window).css('height', event.data.height);

        // send confirmation to requester window
        target_iframe.contentWindow.postMessage({
            original_msg_id: msg_id, 
        }, '*');
    }
    //--------------------------------------------------------
    // setWindowSize
    //--------------------------------------------------------
    else if(event.data.msg === 'setWindowSize' && (event.data.width !== undefined || event.data.height !== undefined)){
        // convert to number and set
        if(event.data.width !== undefined){
            event.data.width = parseFloat(event.data.width);
            // must be at least 200
            if(event.data.width < 200)
                event.data.width = 200;
            $($el_parent_window).css('width', event.data.width);
        }
        
        if(event.data.height !== undefined){
            event.data.height = parseFloat(event.data.height);
            // must be at least 200
            if(event.data.height < 200)
                event.data.height = 200;
            $($el_parent_window).css('height', event.data.height);
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
            $($el_parent_window).css('left', parseFloat(event.data.x));
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
            $($el_parent_window).css('top', parseFloat(event.data.y));
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
    // openItem
    //--------------------------------------------------------
    else if(event.data.msg === 'openItem'){
        // check if readURL returns 200
        $.ajax({
            url: event.data.metadataURL + '&return_suggested_apps=true&return_path=true',
            type: 'GET',
            headers: {
                "Authorization": "Bearer "+auth_token
            },
            success: async function(metadata){
                $.ajax({
                    url: api_origin + "/open_item",
                    type: 'POST',
                    contentType: "application/json",
                    data: JSON.stringify({
                        uid: metadata.uid ?? undefined,
                        path: metadata.path ?? undefined,
                    }),
                    headers: {
                        "Authorization": "Bearer "+auth_token
                    },
                    statusCode: {
                        401: function () {
                            logout();
                        },
                    },
                    success: function(open_item_meta){
                        setTimeout(function(){
                            launch_app({ 
                                name: metadata.name, 
                                file_path: metadata.path,
                                app_obj: open_item_meta.suggested_apps[0],
                                window_title: metadata.name,
                                file_uid: metadata.uid,
                                file_signature: open_item_meta.signature,
                            });
                        // todo: this is done because sometimes other windows such as openFileDialog
                        // bring focus to their apps and steal the focus from the newly-opened app
                        }, 800);
                    },
                });            
            }
        })
    }
    //--------------------------------------------------------
    // launchApp
    //--------------------------------------------------------
    else if(event.data.msg === 'launchApp'){
        // TODO: Determine if the app is allowed to launch child apps? We may want to limit this to prevent abuse.
        // remember app for launch callback later
        const child_instance_id = uuidv4();
        window.child_launch_callbacks[child_instance_id] = {
            parent_instance_id: event.data.appInstanceID,
            launch_msg_id: msg_id,
        };
        // launch child app
        launch_app({
            name: event.data.app_name ?? app_name,
            args: event.data.args ?? {},
            parent_instance_id: event.data.appInstanceID,
            uuid: child_instance_id,
        });
    }
    //--------------------------------------------------------
    // readAppDataFile
    //--------------------------------------------------------
    else if(event.data.msg === 'readAppDataFile' && event.data.path !== undefined){
        // resolve path to absolute
        event.data.path = path.resolve(event.data.path);
        
        // join with appdata dir
        const file_path = path.join(appdata_path, app_uuid, event.data.path);

        puter.fs.sign(app_uuid, {
                path: file_path, 
                action: 'write',
            }, 
            function(signature){
                signature = signature.items;
                signature.signatures = signature.signatures ?? [signature];
                if(signature.signatures.length > 0 && signature.signatures[0].path){
                    signature.signatures[0].path = `~/` + signature.signatures[0].path.split('/').slice(2).join('/')
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
        if(appdata_signatures[app_uuid]){
            target_iframe.contentWindow.postMessage({
                msg: "getAppDataSucceeded",
                original_msg_id: msg_id, 
                item: appdata_signatures[app_uuid],
            }, '*');    
        }
        // make app directory if it doesn't exist
        puter.fs.mkdir({
            path: path.join( appdata_path, app_uuid),
            rename: false,
            overwrite: false,
            success: function(dir){
                puter.fs.sign(app_uuid, {
                    uid: dir.uid, 
                    action: 'write',
                    success: function(signature){
                        signature = signature.items;
                        appdata_signatures[app_uuid] = signature;
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
                            appdata_signatures[app_uuid] = signature;
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
        if(!is_auth() && !(await UIWindowSignup({referrer: app_name})))
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
        if(!is_auth() && !(await UIWindowSignup({referrer: app_name})))
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
        if(!is_auth() && !(await UIWindowSignup({referrer: app_name})))
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
        if(!is_auth() && !(await UIWindowSignup({referrer: app_name})))
            return;

        // No options?
        if(!event.data.options)
            event.data.options = {};

        // /set-desktop-bg
        try{
            await $.ajax({
                url: api_origin + "/set-desktop-bg",
                type: 'POST',
                data: JSON.stringify({ 
                    url: event.data.readURL,
                    fit: event.data.options.fit ?? 'cover',
                    color: event.data.options.color,
                }),
                async: true,
                contentType: "application/json",
                headers: {
                    "Authorization": "Bearer "+auth_token
                },
                statusCode: {
                    401: function () {
                        logout();
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
        if(!is_auth() && !(await UIWindowSignup({referrer: app_name})))
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
                    let dl_op_id = operation_id++;

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
                            auth_token: auth_token, 
                            api_origin: api_origin,
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
                                    path: `~/` + res.path.split('/').slice(2).join('/'),
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
                                sort_items(this, $(this).attr('data-sort_by'), $(this).attr('data-sort_order'))
                            });                            
                            $(el_filedialog_window).close();
                            show_save_account_notice_if_needed();
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
                if( busy_duration >= busy_indicator_hide_delay){
                    $(el_filedialog_window).close();   
                }else{
                    setTimeout(() => {
                        // close this dialog
                        $(el_filedialog_window).close();  
                    }, Math.abs(busy_indicator_hide_delay - busy_duration));
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

        if(event.data.msg === 'saveToPictures')
            target_path = path.join(pictures_path, event.data.filename);
        else if(event.data.msg === 'saveToDesktop')
            target_path = path.join(desktop_path, event.data.filename);
        else if(event.data.msg === 'saveToDocuments')
            target_path = path.join(documents_path, event.data.filename);
        else if(event.data.msg === 'saveToVideos')
            target_path = path.join(videos_path, event.data.filename);
        else if(event.data.msg === 'saveToAudio')
            target_path = path.join(audio_path, event.data.filename);
        else if(event.data.msg === 'saveToAppData'){
            target_path = path.join(appdata_path, app_uuid, event.data.filename);
            create_missing_ancestors = true;
        }
        //auth
        if(!is_auth() && !(await UIWindowSignup({referrer: app_name})))
            return;

        let item_with_same_name_already_exists = true;
        let overwrite = false;

        // -------------------------------------
        // URL
        // -------------------------------------
        if(event.data.url){
            let overwrite = false;
            // download progress tracker
            let dl_op_id = operation_id++;

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
                    auth_token: auth_token, 
                    api_origin: api_origin,
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
                            path: `~/` + res.path.split('/').slice(2).join('/'),
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
        const target_iframe = iframe_for_app_instance(targetAppInstanceID);
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

        const target_window = window_for_app_instance(targetAppInstanceID);
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
            const app_info = await get_apps(app_name);
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
        $(window_for_app_instance(event.data.appInstanceID)).close({bypass_iframe_messaging: true});
    }
});