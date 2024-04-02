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

import UIDesktop from './UI/UIDesktop.js'
import UIWindow from './UI/UIWindow.js'
import UIAlert from './UI/UIAlert.js'
import UIWindowLogin from './UI/UIWindowLogin.js';
import UIWindowSignup from './UI/UIWindowSignup.js';
import path from "./lib/path.js";
import UIWindowSaveAccount from './UI/UIWindowSaveAccount.js';
import UIWindowNewPassword from './UI/UIWindowNewPassword.js';
import UIWindowLoginInProgress from './UI/UIWindowLoginInProgress.js';
import UIWindowEmailConfirmationRequired from './UI/UIWindowEmailConfirmationRequired.js';
import UIWindowSessionList from './UI/UIWindowSessionList.js';
import UIWindowRequestPermission from './UI/UIWindowRequestPermission.js';
import UIWindowChangeUsername from './UI/UIWindowChangeUsername.js';
import update_last_touch_coordinates from './helpers/update_last_touch_coordinates.js';
import update_title_based_on_uploads from './helpers/update_title_based_on_uploads.js';
import PuterDialog from './UI/PuterDialog.js';
import determine_active_container_parent from './helpers/determine_active_container_parent.js';

window.initgui = async function(){
    let url = new URL(window.location);
    url = url.href;

    // update SDK if auth_token is different from the one in the SDK
    if(window.auth_token && puter.authToken !== window.auth_token)
        puter.setAuthToken(window.auth_token);
    // update SDK if api_origin is different from the one in the SDK
    if(window.api_origin && puter.APIOrigin !== window.api_origin)
        puter.setAPIOrigin(api_origin);

    // Checks the type of device the user is on (phone, tablet, or desktop).
    // Depending on the device type, it sets a class attribute on the body tag 
    // to style or script the page differently for each device type.
    if(isMobile.phone)
        $('body').attr('class', 'device-phone');
    else if(isMobile.tablet)
        $('body').attr('class', 'device-tablet');
    else
        $('body').attr('class', 'device-desktop');

    // Appends a meta tag to the head of the document specifying the character encoding to be UTF-8.
    // This ensures that special characters and symbols display correctly across various platforms and browsers.
    $('head').append(`<meta charset="utf-8">`);

    // Appends a viewport meta tag to the head of the document, ensuring optimal display on mobile devices. 
    // This tag sets the width of the viewport to the device width, and locks the zoom level to 1 (prevents user scaling).
    $('head').append(`<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1">`);

    // GET query params provided
    window.url_query_params = new URLSearchParams(window.location.search);

    // will hold the result of the whoami API call
    let whoami;

    //--------------------------------------------------------------------------------------
    // Determine if an app was launched from URL
    // i.e. https://puter.com/app/<app_name>
    //--------------------------------------------------------------------------------------
    const url_paths = window.location.pathname.split('/').filter(element => element);
    if(url_paths[0]?.toLocaleLowerCase() === 'app' && url_paths[1]){
        window.app_launched_from_url = url_paths[1];

        // get query params, any param that doesn't start with 'puter.' will be passed to the app
        window.app_query_params = {};
        for (let [key, value] of url_query_params) {
            if(!key.startsWith('puter.'))
                app_query_params[key] = value;
        }
    }

    //--------------------------------------------------------------------------------------
    // Extract 'action' from URL
    //--------------------------------------------------------------------------------------
    let action;
    if(url_paths[0]?.toLocaleLowerCase() === 'action' && url_paths[1]){
        action = url_paths[1].toLowerCase();
    }

    //--------------------------------------------------------------------------------------
    // Determine if we are in full-page mode
    // i.e. https://puter.com/app/<app_name>/?puter.fullpage=true
    //--------------------------------------------------------------------------------------
    if(url_query_params.has('puter.fullpage') && (url_query_params.get('puter.fullpage') === 'false' || url_query_params.get('puter.fullpage') === '0')){
        window.is_fullpage_mode = false;
    }else if(url_query_params.has('puter.fullpage') && (url_query_params.get('puter.fullpage') === 'true' || url_query_params.get('puter.fullpage') === '1')){
        // In fullpage mode, we want to hide the taskbar for better UX
        window.taskbar_height = 0;

        // Puter is in fullpage mode.
        window.is_fullpage_mode = true;
    }

    //--------------------------------------------------------------------------------------
    // Is GUI embedded in a popup?
    // i.e. https://puter.com/?embedded_in_popup=true
    //--------------------------------------------------------------------------------------
    if(url_query_params.has('embedded_in_popup') && (url_query_params.get('embedded_in_popup') === 'true' || url_query_params.get('embedded_in_popup') === '1')){
        window.embedded_in_popup = true;
        $('body').addClass('embedded-in-popup');

        // determine the origin of the opener
        window.openerOrigin = document.referrer;

        // if no referrer, request it from the opener via messaging
        if(!document.referrer){
            try{
                openerOrigin = await requestOpenerOrigin();
            }catch(e){
                throw new Error('No referrer found');
            }
        }

        // this is the referrer in terms of user acquisition
        window.referrerStr = openerOrigin;

        if(action === 'sign-in' && !is_auth()){
            // show signup window
            if(await UIWindowSignup({
                reload_on_success: false,
                send_confirmation_code: false,
                show_close_button: false,
                window_options:{
                    has_head: false,
                    cover_page: true,
                }
            }))
                await getUserAppToken(openerOrigin);
        }
        else if(action === 'sign-in' && is_auth()){
            if(await UIWindowSessionList({
                reload_on_success: false,
                draggable_body: false,
                has_head: false,
                cover_page: true,
            }))
                await getUserAppToken(openerOrigin);

        }
    }

    //--------------------------------------------------------------------------------------
    // Get user referral code from URL query params
    // i.e. https://puter.com/?r=123456
    //--------------------------------------------------------------------------------------
    if(url_query_params.has('r')){
        window.referral_code = url_query_params.get('r');
        // remove 'r' from URL
        window.history.pushState(null, document.title, '/');    
        // show referral notice, this will be used later if Desktop is loaded
        if(window.first_visit_ever)
            window.show_referral_notice = true;
    }

    //--------------------------------------------------------------------------------------
    // Action: Request Permission
    //--------------------------------------------------------------------------------------
    if(action === 'request-permission'){
        let app_uid = url_query_params.get('app_uid');
        let origin = openerOrigin ?? url_query_params.get('origin');
        let permission = url_query_params.get('permission');

        let granted = await UIWindowRequestPermission({
            app_uid: app_uid,
            origin: origin,
            permission: permission,
        });

        let messageTarget = embedded_in_popup ? window.opener : window.parent;
        messageTarget.postMessage({
            msg: "permissionGranted", 
            granted: granted,
        }, origin);
    }
    //--------------------------------------------------------------------------------------
    // Action: Password recovery
    //--------------------------------------------------------------------------------------
    else if(action === 'set-new-password'){
        let user = url_query_params.get('user');
        let token = url_query_params.get('token');

        await UIWindowNewPassword({
            user: user,
            token: token,
        });
    }
    //--------------------------------------------------------------------------------------
    // Action: Change Username
    //--------------------------------------------------------------------------------------
    else if(action === 'change-username'){
        await UIWindowChangeUsername();
    }
    //--------------------------------------------------------------------------------------
    // Action: Login
    //--------------------------------------------------------------------------------------
    else if(action === 'login'){
        await UIWindowLogin();
    }
    //--------------------------------------------------------------------------------------
    // Action: Signup
    //--------------------------------------------------------------------------------------
    else if(action === 'signup'){
        await UIWindowSignup();
    }

    // -------------------------------------------------------------------------------------
    // If in embedded in a popup, it is important to check whether the opener app has a relationship with the user
    // if yes, we need to get the user app token and send it to the opener
    // if not, we need to ask the user for confirmation before proceeding BUT only if the action is a file-picker action
    // -------------------------------------------------------------------------------------
    if(window.embedded_in_popup && openerOrigin){
        let response = await checkUserSiteRelationship(openerOrigin);
        window.userAppToken = response.token;

        if(logged_in_users.length > 0 && (!userAppToken || url_query_params.get('request_auth') )){
            await UIWindowSessionList({
                reload_on_success: false,
                draggable_body: false,
                has_head: false,
                cover_page: true,
            });
        }
        // if not and action is show-open-file-picker, we need confirmation before proceeding
        if(action === 'show-open-file-picker' || action === 'show-save-file-picker' || action === 'show-directory-picker'){
            if(!userAppToken){
                let is_confirmed = await PuterDialog();
                
                if(is_confirmed === false){
                    if(!is_auth()){
                        window.first_visit_ever = false;
                        localStorage.removeItem("has_visited_before", true);
                    }

                    window.close();
                    window.open('','_self').close();
                }
            }
        }
    }
    // -------------------------------------------------------------------------------------
    // `auth_token` provided in URL, use it to log in
    // -------------------------------------------------------------------------------------
    else if(url_query_params.has('auth_token')){
        let query_param_auth_token = url_query_params.get('auth_token');

        try{
            whoami = await puter.os.user();
        }catch(e){
            if(e.status === 401){
                logout();
                return;
            }
        }

        if(whoami){
            if(whoami.requires_email_confirmation){
                let is_verified;
                do{
                    is_verified = await UIWindowEmailConfirmationRequired({
                        stay_on_top: true, 
                        has_head: false
                    });
                }
                while(!is_verified)
            }
            // if user is logging in using an auth token that means it's not their first ever visit to Puter.com
            // it might be their first visit to Puter on this specific device but it's not their first time ever visiting Puter.
            window.first_visit_ever = false;
            // show login progress window
            UIWindowLoginInProgress({user_info: whoami});
            // update auth data
            update_auth_data(query_param_auth_token, whoami);
        }
        // remove auth_token from URL
        window.history.pushState(null, document.title, '/');
    }

    /**
     * Logout without showing confirmation or "Save Account" action,
     * and without authenticating with the server.
     */
    const bad_session_logout = async () => {
        try {
            // TODO: i18n
            await UIAlert({
                message: 'Your session is invalid. You will be logged out.'
            });
            // clear local storage
            localStorage.clear();
            // reload the page
            window.location.reload();
        }catch(e){
            // TODO: i18n
            await UIAlert({
                message: 'Session is invalid and logout failed; ' +
                    'please clear local storage manually.'
            });
        }
    };

    // -------------------------------------------------------------------------------------
    // Authed
    // -------------------------------------------------------------------------------------
    if(is_auth()){
        // try to get user data using /whoami, only if that data is missing
        if(!whoami){
            try{
                whoami = await puter.os.user();
            }catch(e){
                if(e.status === 401){
                    bad_session_logout();
                    return;
                }
            }
        }
        // update local user data
        if(whoami){
            // is email confirmation required?
            if(whoami.requires_email_confirmation){
                let is_verified;
                do{
                    is_verified = await UIWindowEmailConfirmationRequired({
                        stay_on_top: true, 
                        has_head: false
                    });
                }
                while(!is_verified)
            }
            update_auth_data(window.auth_token, whoami);

            // -------------------------------------------------------------------------------------
            // Load desktop, only if we're not embedded in a popup
            // -------------------------------------------------------------------------------------
            if(!window.embedded_in_popup){
                await get_auto_arrange_data()
                puter.fs.stat(desktop_path, async function(desktop_fsentry){
                    UIDesktop({desktop_fsentry: desktop_fsentry});
                })
            }
            // -------------------------------------------------------------------------------------
            // If embedded in a popup, send the token to the opener and close the popup
            // -------------------------------------------------------------------------------------
            else{
                let msg_id = url_query_params.get('msg_id');
                try{
                    let data = await getUserAppToken(new URL(openerOrigin).origin);
                    // This is an implicit app and the app_uid is sent back from the server
                    // we cache it here so that we can use it later
                    window.host_app_uid = data.app_uid;
                    // send token to parent
                    window.opener.postMessage({
                        msg: 'puter.token',
                        success: true,
                        token: data.token,
                        app_uid: data.app_uid,
                        username: user.username,
                        msg_id: msg_id,
                    }, openerOrigin);
                    // close popup
                    if(!action || action==='sign-in'){
                        window.close();
                        window.open('','_self').close();
                    }
                }catch(err){
                    // send error to parent
                    window.opener.postMessage({
                        msg: 'puter.token',
                        success: false,
                        token: null,
                        msg_id: msg_id,
                    }, openerOrigin);
                    // close popup
                    window.close();
                    window.open('','_self').close();
                }

                let app_uid;
    
                if(openerOrigin){
                    app_uid = await getAppUIDFromOrigin(openerOrigin);
                    window.host_app_uid = app_uid;
                }
    
                if(action === 'show-open-file-picker'){
                    let options = url_query_params.get('options');
                    options = JSON.parse(options ?? '{}');

                    // Open dialog
                    UIWindow({
                        allowed_file_types: options?.accept,
                        selectable_body: options?.multiple,
                        path: '/' + window.user.username + '/Desktop',
                        // this is the uuid of the window to which this dialog will return
                        return_to_parent_window: true,
                        show_maximize_button: false,
                        show_minimize_button: false,
                        title: 'Open',
                        is_dir: true,
                        is_openFileDialog: true,
                        is_resizable: false,
                        has_head: false,
                        cover_page: true,
                        // selectable_body: is_selectable_body,
                        iframe_msg_uid: msg_id,
                        center: true,
                        initiating_app_uuid: app_uid,
                        on_close: function(){
                            window.opener.postMessage({
                                msg: "fileOpenCanceled", 
                                original_msg_id: msg_id, 
                            }, '*');
                        }
                    });
                }
                //--------------------------------------------------------------------------------------
                // Action: Show Directory Picker
                //--------------------------------------------------------------------------------------
                else if(action === 'show-directory-picker'){
                    // open directory picker dialog
                    UIWindow({
                        path: '/' + window.user.username + '/Desktop',
                        // this is the uuid of the window to which this dialog will return
                        // parent_uuid: event.data.appInstanceID,
                        return_to_parent_window: true,
                        show_maximize_button: false,
                        show_minimize_button: false,
                        title: 'Open',
                        is_dir: true,
                        is_directoryPicker: true,
                        is_resizable: false,
                        has_head: false,
                        cover_page: true,
                        // selectable_body: is_selectable_body,
                        iframe_msg_uid: msg_id,
                        center: true,
                        initiating_app_uuid: app_uid,
                        on_close: function(){
                            window.opener.postMessage({
                                msg: "directoryOpenCanceled", 
                                original_msg_id: msg_id, 
                            }, '*');
                        }
                    });
                }
                //--------------------------------------------------------------------------------------
                // Action: Show Save File Dialog
                //--------------------------------------------------------------------------------------
                else if(action === 'show-save-file-picker'){
                    let allowed_file_types = url_query_params.get('allowed_file_types');

                    // send 'sendMeFileData' event to parent
                    window.opener.postMessage({
                        msg: 'sendMeFileData',
                    }, '*');
                        
                    // listen for 'showSaveFilePickerPopup' event from parent
                    window.addEventListener('message', async (event) => {
                        if(event.data.msg !== 'showSaveFilePickerPopup')
                            return;

                        // Open dialog
                        UIWindow({
                            allowed_file_types: allowed_file_types,
                            path: '/' + window.user.username + '/Desktop',
                            // this is the uuid of the window to which this dialog will return
                            return_to_parent_window: true,
                            show_maximize_button: false,
                            show_minimize_button: false,
                            title: 'Save',
                            is_dir: true,
                            is_saveFileDialog: true,
                            is_resizable: false,
                            has_head: false,
                            cover_page: true,
                            // selectable_body: is_selectable_body,
                            iframe_msg_uid: msg_id,
                            center: true,
                            initiating_app_uuid: app_uid,
                            on_close: function(){
                                window.opener.postMessage({
                                    msg: "fileSaveCanceled", 
                                    original_msg_id: msg_id, 
                                }, '*');
                            },
                            onSaveFileDialogSave: async function(target_path, el_filedialog_window){
                                $(el_filedialog_window).find('.window-disable-mask, .busy-indicator').show();
                                let busy_init_ts = Date.now();

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

                                        let file_signature = await puter.fs.sign(app_uid, {uid: res.uid, action: 'write'});
                                        file_signature = file_signature.items;

                                        item_with_same_name_already_exists = false;
                                        window.opener.postMessage({
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

                                        window.close();
                                        window.open('','_self').close();
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
                                            console.log(err);
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
                    });
                }
            }

            // ----------------------------------------------------------
            // Get user's sites
            // ----------------------------------------------------------
            update_sites_cache();
        } 
    }
    // -------------------------------------------------------------------------------------
    // Desktop Background
    // If we're in fullpage/emebedded/Auth Popup mode, we don't want to load the custom background 
    // because it's not visible anyway and it's a waste of bandwidth
    // -------------------------------------------------------------------------------------
    if(!window.is_fullpage_mode && !window.embedded_in_popup){
        refresh_desktop_background();
    }
    // -------------------------------------------------------------------------------------
    // Un-authed but not first visit -> try to log in/sign up
    // -------------------------------------------------------------------------------------
    if(!is_auth() && !first_visit_ever){
        if(logged_in_users.length > 0){
            UIWindowSessionList();
        }
        else{
            await UIWindowLogin({
                reload_on_success: true,
                send_confirmation_code: false,
                window_options:{
                    has_head: false
                }
            });
        }
    }

    // -------------------------------------------------------------------------------------
    // Un-authed and first visit ever -> create temp user
    // -------------------------------------------------------------------------------------
    else if(!is_auth() && first_visit_ever){
        let referrer;
        try{
            referrer = new URL(window.location.href).pathname;
        }catch(e){
            console.log(e)
        }

        referrer = window.openerOrigin ?? referrer;

        // a global object that will be used to store the user's referrer
        window.referrerStr = referrer;

        // in case there is also a referrer query param, add it to the referrer URL
        if(url_query_params.has('ref')){
            if(!referrer)
                referrer = '/';
            referrer += '?ref=' + html_encode(url_query_params.get('ref'));
        }

        
        let headers = {};
        if(window.custom_headers)
            headers = window.custom_headers;
        $.ajax({
            url: gui_origin + "/signup",
            type: 'POST',
            async: true,
            headers: headers,
            contentType: "application/json",
            data: JSON.stringify({ 
                referrer: referrer,
                referral_code: window.referral_code,
                is_temp: true,
            }),
            success: async function (data){
                update_auth_data(data.token, data.user);
                document.dispatchEvent(new Event("login", { bubbles: true})); 
            },
            error: function (err){
                $('#signup-error-msg').html(err.responseText);
                $('#signup-error-msg').fadeIn();
                // re-enable 'Create Account' button
                $('.signup-btn').prop('disabled', false);
            }
        });
    }

    // if there is at least one window open (only non-Explorer windows), ask user for confirmation when navigating away
    if(feature_flags.prompt_user_when_navigation_away_from_puter){
        window.onbeforeunload = function(){
            if($(`.window:not(.window[data-app="explorer"])`).length > 0)
                return true;
        };
    }

    // -------------------------------------------------------------------------------------
    // `login` event handler
    // --------------------------------------------------------------------------------------
    $(document).on("login", async (e) => {
        // close all windows
        $('.window').close();

        // -------------------------------------------------------------------------------------
        // Load desktop, if not embedded in a popup
        // -------------------------------------------------------------------------------------
        if(!window.embedded_in_popup){
            await get_auto_arrange_data();
            puter.fs.stat(desktop_path, function (desktop_fsentry) {
                UIDesktop({ desktop_fsentry: desktop_fsentry });
            })
        }
        // -------------------------------------------------------------------------------------
        // If embedded in a popup, send the 'ready' event to referrer and close the popup
        // -------------------------------------------------------------------------------------
        else{
            let msg_id = url_query_params.get('msg_id');
            try{

                let data = await getUserAppToken(new URL(openerOrigin).origin);
                // This is an implicit app and the app_uid is sent back from the server
                // we cache it here so that we can use it later
                window.host_app_uid = data.app_uid;
                // send token to parent
                window.opener.postMessage({
                    msg: 'puter.token',
                    success: true,
                    msg_id: msg_id,
                    token: data.token,
                    username: user.username,
                    app_uid: data.app_uid,
                }, openerOrigin);
                // close popup
                if(!action || action==='sign-in'){
                    window.close();
                    window.open('','_self').close();
                }
            }catch(err){
                // send error to parent
                window.opener.postMessage({
                    msg: 'puter.token',
                    msg_id: msg_id,
                    success: false,
                    token: null,
                }, openerOrigin);
                // close popup
                window.close();
                window.open('','_self').close();
            }


            let app_uid;

            if(openerOrigin){
                app_uid = await getAppUIDFromOrigin(openerOrigin);
                window.host_app_uid = app_uid;
            }

            //--------------------------------------------------------------------------------------
            // Action: Show Open File Picker
            //--------------------------------------------------------------------------------------
            if(action === 'show-open-file-picker'){
                let options = url_query_params.get('options');
                options = JSON.parse(options ?? '{}');

                // Open dialog
                UIWindow({
                    allowed_file_types: options?.accept,
                    selectable_body: options?.multiple,
                    path: '/' + window.user.username + '/Desktop',
                    return_to_parent_window: true,
                    show_maximize_button: false,
                    show_minimize_button: false,
                    title: 'Open',
                    is_dir: true,
                    is_openFileDialog: true,
                    is_resizable: false,
                    has_head: false,
                    cover_page: true,
                    iframe_msg_uid: msg_id,
                    center: true,
                    initiating_app_uuid: app_uid,
                    on_close: function(){
                        window.opener.postMessage({
                            msg: "fileOpenCanceled", 
                            original_msg_id: msg_id, 
                        }, '*');
                    }
                });
            }
            //--------------------------------------------------------------------------------------
            // Action: Show Directory Picker
            //--------------------------------------------------------------------------------------
            else if(action === 'show-directory-picker'){
                // open directory picker dialog
                UIWindow({
                    path: '/' + window.user.username + '/Desktop',
                    // this is the uuid of the window to which this dialog will return
                    // parent_uuid: event.data.appInstanceID,
                    return_to_parent_window: true,
                    show_maximize_button: false,
                    show_minimize_button: false,
                    title: 'Open',
                    is_dir: true,
                    is_directoryPicker: true,
                    is_resizable: false,
                    has_head: false,
                    cover_page: true,
                    // selectable_body: is_selectable_body,
                    iframe_msg_uid: msg_id,
                    center: true,
                    initiating_app_uuid: app_uid,
                    on_close: function(){
                        window.opener.postMessage({
                            msg: "directoryOpenCanceled", 
                            original_msg_id: msg_id, 
                        }, '*');
                    }
                });
            }

            //--------------------------------------------------------------------------------------
            // Action: Show Save File Dialog
            //--------------------------------------------------------------------------------------
            else if(action === 'show-save-file-picker'){
                let allowed_file_types = url_query_params.get('allowed_file_types');

                // send 'sendMeFileData' event to parent
                window.opener.postMessage({
                    msg: 'sendMeFileData',
                }, '*');
                    
                // listen for 'showSaveFilePickerPopup' event from parent
                window.addEventListener('message', async (event) => {
                    if(event.data.msg !== 'showSaveFilePickerPopup')
                        return;

                    // Open dialog
                    UIWindow({
                        allowed_file_types: allowed_file_types,
                        path: '/' + window.user.username + '/Desktop',
                        // this is the uuid of the window to which this dialog will return
                        return_to_parent_window: true,
                        show_maximize_button: false,
                        show_minimize_button: false,
                        title: 'Save',
                        is_dir: true,
                        is_saveFileDialog: true,
                        is_resizable: false,
                        has_head: false,
                        cover_page: true,
                        // selectable_body: is_selectable_body,
                        iframe_msg_uid: msg_id,
                        center: true,
                        initiating_app_uuid: app_uid,
                        on_close: function(){
                            window.opener.postMessage({
                                msg: "fileSaveCanceled", 
                                original_msg_id: msg_id, 
                            }, '*');
                        },
                        onSaveFileDialogSave: async function(target_path, el_filedialog_window){
                            $(el_filedialog_window).find('.window-disable-mask, .busy-indicator').show();
                            let busy_init_ts = Date.now();

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

                                    let file_signature = await puter.fs.sign(app_uid, {uid: res.uid, action: 'write'});
                                    file_signature = file_signature.items;

                                    item_with_same_name_already_exists = false;
                                    window.opener.postMessage({
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

                                    window.close();
                                    window.open('','_self').close();
                                    // show_save_account_notice_if_needed();
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
                                        console.log(err);
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
                });
            }

        }

    })

    $(".popover, .context-menu").on("remove", function () {
        $('.window-active .window-app-iframe').css('pointer-events', 'all');
    })

    // If the document is clicked/tapped somewhere
    $(document).bind("mousedown touchstart", function (e) {
        // update last touch coordinates
        update_last_touch_coordinates(e);

        // dismiss touchstart on regular devices
        if(e.type === 'touchstart' && !isMobile.phone && !isMobile.tablet)
            return;

        // If .item-container clicked, unselect all its item children
        if($(e.target).hasClass('item-container') && !e.ctrlKey && !e.metaKey){
            $(e.target).children('.item-selected').removeClass('item-selected');
            update_explorer_footer_selected_items_count(e.target);
        }

        // If the clicked element is not a context menu, remove all context menus
        if ($(e.target).parents(".context-menu").length === 0) {
            const $ctxmenus = $(".context-menu");
            $ctxmenus.fadeOut(200, function(){
                $ctxmenus.remove();
            });
        }

        // click on anything will close all popovers, but there are some exceptions
        if(!$(e.target).hasClass('start-app') 
            && !$(e.target).hasClass('launch-search') 
            && !$(e.target).hasClass('launch-search-clear') 
            && $(e.target).closest('.start-app').length === 0  
            && !isMobile.phone && !isMobile.tablet
            && !$(e.target).hasClass('popover')
            && $(e.target).parents('.popover').length === 0){

            $(".popover").fadeOut(200, function(){
                $(".popover").remove();
            });
        }

        // Close all tooltips
        $('.ui-tooltip').remove();

        // rename items whose names were being edited
        if(!$(e.target).hasClass('item-name-editor')){
            // blurring an Item Name Editor will automatically trigger renaming the item
            $(".item-name-editor-active").blur();
        }

        // update active_item_container
        if($(e.target).hasClass('item-container')){
            active_item_container = e.target;
        }else{
            let ic = $(e.target).closest('.item-container')
            if(ic.length > 0){
                active_item_container = ic.get(0);
            }else{
                let pp = $(e.target).find('.item-container')
                if(pp.length > 0){
                    active_item_container = pp.get(0);
                }
            }
        }

        //active element
        active_element = e.target;
    });

    $(document).bind('keydown', async function(e){
        const focused_el = document.activeElement;

        //-----------------------------------------------------------------------
        // ← ↑ → ↓: an arrow key is pressed 
        //-----------------------------------------------------------------------
        if((e.which === 37 || e.which === 38 || e.which === 39 || e.which === 40)){
            // ----------------------------------------------
            // Launch menu is open
            // ----------------------------------------------
            if($('.launch-popover').length > 0){
                // If no item is selected and down arrow is pressed, select the first item
                if($('.launch-popover .start-app-card.launch-app-selected').length === 0 && (e.which === 40)){
                    $('.launch-popover .start-app-card:visible').first().addClass('launch-app-selected');
                    // blur search input
                    $('.launch-popover .launch-search').blur();
                    return false;
                }
                // if search input is focused and left or right arrow is pressed, return false
                else if($('.launch-popover .launch-search').is(':focus') && (e.which === 37 || e.which === 39)){
                    return false;
                }
                else{
                    // If an item is already selected, move the selection up, down, left or right
                    let selected_item = $('.launch-popover .start-app-card.launch-app-selected').get(0);
                    let selected_item_index = $('.launch-popover .start-app-card:visible').index(selected_item);
                    let selected_item_row = Math.floor(selected_item_index / 5);
                    let selected_item_col = selected_item_index % 5;
                    let selected_item_row_count = Math.ceil($('.launch-popover .start-app-card:visible').length / 5);
                    let selected_item_col_count = 5;
                    let new_selected_item_index = selected_item_index;
                    let new_selected_item_row = selected_item_row;
                    let new_selected_item_col = selected_item_col;
                    let new_selected_item;
                    
                    // if up arrow is pressed
                    if(e.which === 38){
                        // if this item is in the first row, up arrow should bring the focus back to the search input
                        if(selected_item_row === 0){
                            $('.launch-popover .launch-search').focus();
                            // unselect all items
                            $('.launch-popover .start-app-card.launch-app-selected').removeClass('launch-app-selected');
                            // bring cursor to the end of the search input
                            $('.launch-popover .launch-search').val($('.launch-popover .launch-search').val());

                            return false;
                        }
                        // if this item is not in the first row, move the selection up
                        else{
                            new_selected_item_row = selected_item_row - 1;
                            if(new_selected_item_row < 0)
                                new_selected_item_row = selected_item_row_count - 1;
                        }
                    }
                    // if down arrow is pressed
                    else if(e.which === 40){
                        new_selected_item_row = selected_item_row + 1;
                        if(new_selected_item_row >= selected_item_row_count)
                            new_selected_item_row = 0;
                    }
                    // if left arrow is pressed
                    else if(e.which === 37){
                        new_selected_item_col = selected_item_col - 1;
                        if(new_selected_item_col < 0)
                            new_selected_item_col = selected_item_col_count - 1;
                    }
                    // if right arrow is pressed
                    else if(e.which === 39){
                        new_selected_item_col = selected_item_col + 1;
                        if(new_selected_item_col >= selected_item_col_count)
                            new_selected_item_col = 0;
                    }
                    new_selected_item_index = (new_selected_item_row * selected_item_col_count) + new_selected_item_col;
                    new_selected_item = $('.launch-popover .start-app-card:visible').get(new_selected_item_index);
                    $(selected_item).removeClass('launch-app-selected');
                    $(new_selected_item).addClass('launch-app-selected');

                    // make sure the selected item is visible in the popover by scrolling the popover
                    let popover = $('.launch-popover').get(0);
                    let popover_height = $('.launch-popover').height();
                    let popover_scroll_top = popover.getBoundingClientRect().top;
                    let popover_scroll_bottom = popover_scroll_top + popover_height;
                    let selected_item_top = new_selected_item.getBoundingClientRect().top;
                    let selected_item_bottom = new_selected_item.getBoundingClientRect().bottom;
                    let isVisible = (selected_item_top >= popover_scroll_top) && (selected_item_bottom <= popover_scroll_top + popover_height);

                    if ( ! isVisible ) {
                        const scrollTop = selected_item_top - popover_scroll_top;
                        const scrollBot = selected_item_bottom - popover_scroll_bottom;
                        if (Math.abs(scrollTop) < Math.abs(scrollBot)) {
                            popover.scrollTop += scrollTop;
                        } else {
                            popover.scrollTop += scrollBot;
                        }
                    }
                    return false;
                }
            }
            // ----------------------------------------------
            // A context menu is open
            // ----------------------------------------------
            else if($('.context-menu').length > 0){
                // if no item is selected and down arrow is pressed, select the first item
                if($('.context-menu-active .context-menu-item-active').length === 0 && (e.which === 40)){
                    let selected_item = $('.context-menu-active .context-menu-item').get(0);
                    select_ctxmenu_item(selected_item);
                    return false;
                }
                // if no item is selected and up arrow is pressed, select the last item
                else if($('.context-menu-active .context-menu-item-active').length === 0 && (e.which === 38)){
                    let selected_item = $('.context-menu .context-menu-item').get($('.context-menu .context-menu-item').length - 1);
                    select_ctxmenu_item(selected_item);
                    return false;
                }
                // if an item is selected and down arrow is pressed, select the next enabled item
                else if($('.context-menu-active .context-menu-item-active').length > 0 && (e.which === 40)){
                    let selected_item = $('.context-menu-active .context-menu-item-active').get(0);
                    let selected_item_index = $('.context-menu-active .context-menu-item').index(selected_item);
                    let new_selected_item_index = selected_item_index + 1;
                    let new_selected_item = $('.context-menu-active .context-menu-item').get(new_selected_item_index);
                    while($(new_selected_item).hasClass('context-menu-item-disabled')){
                        new_selected_item_index = new_selected_item_index + 1;
                        new_selected_item = $('.context-menu-active .context-menu-item').get(new_selected_item_index);
                    }
                    select_ctxmenu_item(new_selected_item);
                    return false;
                }
                // if an item is selected and up arrow is pressed, select the previous enabled item
                else if($('.context-menu-active .context-menu-item-active').length > 0 && (e.which === 38)){
                    let selected_item = $('.context-menu-active .context-menu-item-active').get(0);
                    let selected_item_index = $('.context-menu-active .context-menu-item').index(selected_item);
                    let new_selected_item_index = selected_item_index - 1;
                    let new_selected_item = $('.context-menu-active .context-menu-item').get(new_selected_item_index);
                    while($(new_selected_item).hasClass('context-menu-item-disabled')){
                        new_selected_item_index = new_selected_item_index - 1;
                        new_selected_item = $('.context-menu-active .context-menu-item').get(new_selected_item_index);
                    }
                    select_ctxmenu_item(new_selected_item);
                    return false;
                }
                // if right arrow is pressed, open the submenu by triggering a mouseover event
                else if($('.context-menu-active .context-menu-item-active').length > 0 && (e.which === 39)){
                    const selected_item = $('.context-menu-active .context-menu-item-active').get(0);
                    $(selected_item).trigger('mouseover');
                    // if the submenu is open, select the first item in the submenu
                    if($(selected_item).hasClass('context-menu-item-submenu') === true){
                        $(selected_item).removeClass('context-menu-item-active');
                        $(selected_item).addClass('context-menu-item-active-blurred');
                        select_ctxmenu_item($('.context-menu[data-is-submenu="true"] .context-menu-item').get(0));
                    }
                    return false;
                }
                // if left arrow is pressed on a submenu, close the submenu
                else if($('.context-menu-active[data-is-submenu="true"]').length > 0 && (e.which === 37)){
                    // get parent menu
                    let parent_menu_id = $('.context-menu-active[data-is-submenu="true"]').data('parent-id');
                    let parent_menu = $('.context-menu[data-element-id="' + parent_menu_id + '"]');
                    // remove the submenu
                    $('.context-menu-active[data-is-submenu="true"]').remove();
                    // activate the parent menu
                    $(parent_menu).addClass('context-menu-active');
                    // select the item that opened the submenu
                    let selected_item = $('.context-menu-active .context-menu-item-active-blurred').get(0);
                    $(selected_item).removeClass('context-menu-item-active-blurred');
                    $(selected_item).addClass('context-menu-item-active');

                    return false;
                }
                // if enter is pressed, trigger a click event on the selected item
                else if($('.context-menu-active .context-menu-item-active').length > 0 && (e.which === 13)){
                    let selected_item = $('.context-menu-active .context-menu-item-active').get(0);
                    $(selected_item).trigger('click');
                    return false;
                }
            }
            // ----------------------------------------------
            // Navigate items in the active item container
            // ----------------------------------------------
            else if(!$(focused_el).is('input') && !$(focused_el).is('textarea') && (e.which === 37 || e.which === 38 || e.which === 39 || e.which === 40)){
                let item_width = 110, item_height = 110, selected_item;
                // select first item in container if none is selected
                if($(active_item_container).find('.item-selected').length === 0){
                    selected_item = $(active_item_container).find('.item').get(0);
                    active_element = selected_item;
                    $(active_item_container).find('.item-selected').removeClass('item-selected');
                    $(selected_item).addClass('item-selected');
                    return false;
                }
                // if Shift key is pressed and ONE item is already selected, pick that item
                else if($(active_item_container).find('.item-selected').length === 1 && e.shiftKey){
                    selected_item = $(active_item_container).find('.item-selected').get(0);
                }
                // if Shift key is pressed and MORE THAN ONE item is selected, pick the latest active item
                else if($(active_item_container).find('.item-selected').length > 1 && e.shiftKey){
                    selected_item = $(active_element).hasClass('item') ? active_element : $(active_element).closest('.item').get(0);
                }
                // otherwise if an item is selected, pick that item
                else if($(active_item_container).find('.item-selected').length === 1){
                    selected_item = $(active_item_container).find('.item-selected').get(0);
                }
                else{
                    selected_item = $(active_element).hasClass('item') ? active_element : $(active_element).closest('.item').get(0);
                }
                
                // override the default behavior of ctrl/meta key
                // in some browsers ctrl/meta key + arrow keys will scroll the page or go back/forward in history
                if(e.ctrlKey || e.metaKey){
                    e.preventDefault();
                    e.stopPropagation();
                }

                // get the position of the selected item
                let active_el_pos = $(selected_item).hasClass('item') ? selected_item.getBoundingClientRect() : $(selected_item).closest('.item').get(0).getBoundingClientRect();
                let xpos = active_el_pos.left + item_width/2;
                let ypos = active_el_pos.top + item_height/2;
                // these hold next item's position on the grid
                let x_nxtpos, y_nxtpos;
                // these hold the amount of pixels to scroll the container
                let x_scroll = 0, y_scroll = 0;
                // determine next item's position on the grid
                // left
                if(e.which === 37){
                    x_nxtpos = (xpos - item_width) > 0 ? (xpos - item_width) : 0;
                    y_nxtpos = (ypos);
                    x_scroll = (item_width / 2);
                }
                // up
                else if(e.which === 38){
                    x_nxtpos = (xpos);
                    y_nxtpos = (ypos - item_height) > 0 ? (ypos - item_height) : 0;
                    y_scroll = -1 * (item_height / 2);
                }
                // right
                else if(e.which === 39){
                    x_nxtpos = (xpos + item_width);
                    y_nxtpos = (ypos);
                    x_scroll = -1 * (item_width / 2);
                }
                // down
                else if(e.which === 40){
                    x_nxtpos = (xpos);
                    y_nxtpos = (ypos + item_height);
                    y_scroll = (item_height / 2);
                }

                let elements_at_next_pos = document.elementsFromPoint(x_nxtpos, y_nxtpos);
                let next_item;
                for (let index = 0; index < elements_at_next_pos.length; index++) {
                    const elem_at_next_pos = elements_at_next_pos[index];
                    if($(elem_at_next_pos).hasClass('item') && $(elem_at_next_pos).closest('.item-container').is(active_item_container)){
                        next_item = elem_at_next_pos;
                        break;
                    }
                }
                
                if(next_item){
                    selected_item = next_item;
                    active_element = next_item;
                    // if ctrl or meta key is not pressed, unselect all items
                    if(!e.shiftKey){
                        $(active_item_container).find('.item').removeClass('item-selected');
                    }
                    $(next_item).addClass('item-selected');
                    window.latest_selected_item = next_item;
                    // scroll to the selected item only if this was a down or up move
                    if(e.which === 38 || e.which === 40)
                        next_item.scrollIntoView(false);
                }
            }
        }
        //-----------------------------------------------------------------------
        // if the Esc key is pressed on a FileDialog/Alert, close that FileDialog/Alert
        //-----------------------------------------------------------------------
        else if(
            // escape key code
            e.which === 27 && 
            // active window must be a FileDialog or Alert
            ($('.window-active').hasClass('window-filedialog') || $('.window-active').hasClass('window-alert')) &&
            // either don't close if an input is focused or if the input is the filename input
            ((!$(focused_el).is('input') && !$(focused_el).is('textarea')) || $(focused_el).hasClass('savefiledialog-filename'))
            ){
            // close the FileDialog
            $('.window-active').close();
        }
        //-----------------------------------------------------------------------
        // if the Esc key is pressed on a Window Navbar Editor, deactivate the editor
        //-----------------------------------------------------------------------
        else if( e.which === 27 && $(focused_el).hasClass('window-navbar-path-input')){
            $(focused_el).blur();
            $(focused_el).val($(focused_el).closest('.window').attr('data-path'));
            $(focused_el).attr('data-path', $(focused_el).closest('.window').attr('data-path'));
        }

        //-----------------------------------------------------------------------
        // Esc key should:
        //      - always close open context menus
        //      - close the Launch Popover if it's open
        //-----------------------------------------------------------------------
        if( e.which === 27){
            // close open context menus
            $('.context-menu').remove();

            // close the Launch Popover if it's open
            $(".launch-popover").closest('.popover').fadeOut(200, function(){
                $(".launch-popover").closest('.popover').remove();
            });    
        }
    })

    $(document).bind('keydown', async function(e){
        const focused_el = document.activeElement;
        //-----------------------------------------------------------------------
        // Shift+Delete (win)/ option+command+delete (Mac) key pressed
        // Permanent delete bypassing trash after alert
        //-----------------------------------------------------------------------
        if((e.keyCode === 46 && e.shiftKey) || (e.altKey && e.metaKey && e.keyCode === 8)) {
            let $selected_items = $(active_element).closest(`.item-container`).find(`.item-selected`);
            if($selected_items.length > 0){
                const alert_resp = await UIAlert({
                    message: i18n('confirm_delete_multiple_items'),
                    buttons:[
                        {
                            label: i18n('delete'),
                            type: 'primary',
                        },
                        {
                            label: i18n('cancel')
                        },
                    ]
                })
                if((alert_resp) === 'Delete'){
                    for (let index = 0; index < $selected_items.length; index++) {
                        const element = $selected_items[index];
                        await delete_item(element);
                    }
                }    
            }
            return false;
        }
        //-----------------------------------------------------------------------
        // Delete (win)/ ctrl+delete (Mac) / cmd+delete (Mac) key pressed
        // Permanent delete from trash after alert or move to trash
        //-----------------------------------------------------------------------
        if(e.keyCode === 46 || (e.keyCode === 8 && (e.ctrlKey || e.metaKey))) {
            // permanent delete?
            let $selected_items = $(active_element).closest(`.item-container`).find(`.item-selected[data-path^="${trash_path + '/'}"]`);
            if($selected_items.length > 0){
                const alert_resp = await UIAlert({
                    message: i18n('confirm_delete_multiple_items'),
                    buttons:[
                        {
                            label: i18n('delete'),
                            type: 'primary',
                        },
                        {
                            label: i18n('cancel')
                        },
                    ]
                })
                if((alert_resp) === 'Delete'){
                    for (let index = 0; index < $selected_items.length; index++) {
                        const element = $selected_items[index];
                        await delete_item(element);
                    }  
                    const trash = await puter.fs.stat(trash_path);
                    if(window.socket){
                        window.socket.emit('trash.is_empty', {is_empty: trash.is_empty});
                    }

                    if(trash.is_empty){
                        $(`[data-app="trash"]`).find('.taskbar-icon > img').attr('src', window.icons['trash.svg']);
                        $(`.item[data-path="${html_encode(trash_path)}" i]`).find('.item-icon > img').attr('src', window.icons['trash.svg']);
                        $(`.window[data-path="${html_encode(trash_path)}"]`).find('.window-head-icon').attr('src', window.icons['trash.svg']);
                    }
                }    
            }
            // regular delete?
            else{
                $selected_items = $(active_element).closest('.item-container').find('.item-selected');
                if($selected_items.length > 0){
                    // Only delete the items if we're not renaming one.
                    if ($selected_items.children('.item-name-editor-active').length === 0) {
                        move_items($selected_items, trash_path);
                    }
                }
            }
            return false;
        }

        //-----------------------------------------------------------------------
        // A letter or number is pressed and there is no context menu open: search items by name
        //-----------------------------------------------------------------------
        if(!e.ctrlKey && !e.metaKey && !$(focused_el).is('input') && !$(focused_el).is('textarea') && $('.context-menu').length === 0){
            if(keypress_item_seach_term !== '')
                clearTimeout(keypress_item_seach_buffer_timeout);
            
            keypress_item_seach_buffer_timeout = setTimeout(()=>{
                keypress_item_seach_term = '';
            }, 700);

            keypress_item_seach_term += e.key.toLocaleLowerCase();

            let matches= [];
            const selected_items = $(active_item_container).find(`.item-selected`).not('.item-disabled').first();

            // if one item is selected and the selected item matches the search term, don't continue search and select this item again
            if(selected_items.length === 1 && $(selected_items).attr('data-name').toLowerCase().startsWith(keypress_item_seach_term)){
                return false;
            }

            // search for matches
            let haystack = $(active_item_container).find(`.item`).not('.item-disabled');
            for(let j=0; j < haystack.length; j++){
                if($(haystack[j]).attr('data-name').toLowerCase().startsWith(keypress_item_seach_term)){
                    matches.push(haystack[j])
                }
            }

            if(matches.length > 0){
                // if there are multiple matches and an item is already selected, remove all matches before the selected item
                if(selected_items.length > 0 && matches.length > 1){
                    let match_index;
                    for(let i=0; i < matches.length - 1; i++){
                        if($(matches[i]).is(selected_items)){
                            match_index = i;
                            break;
                        }
                    }
                    matches.splice(0, match_index+1);
                }
                // deselect all selected sibling items
                $(active_item_container).find(`.item-selected`).removeClass('item-selected');
                // select matching item
                $(matches[0]).not('.item-disabled').addClass('item-selected');
                matches[0].scrollIntoView(false);
                update_explorer_footer_selected_items_count($(active_element).closest('.window'));
            }

            return false;
        }
        //-----------------------------------------------------------------------
        // A letter or number is pressed and there is a context menu open: search items by name
        //-----------------------------------------------------------------------
        else if(!e.ctrlKey && !e.metaKey && !$(focused_el).is('input') && !$(focused_el).is('textarea') && $('.context-menu').length > 0){
            if(keypress_item_seach_term !== '')
                clearTimeout(keypress_item_seach_buffer_timeout);
            
            keypress_item_seach_buffer_timeout = setTimeout(()=>{
                keypress_item_seach_term = '';
            }, 700);

            keypress_item_seach_term += e.key.toLocaleLowerCase();

            let matches= [];
            const selected_items = $('.context-menu').find(`.context-menu-item-active`).first();

            // if one item is selected and the selected item matches the search term, don't continue search and select this item again
            if(selected_items.length === 1 && $(selected_items).text().toLowerCase().startsWith(keypress_item_seach_term)){
                return false;
            }

            // search for matches
            let haystack = $('.context-menu-active').find(`.context-menu-item`);
            for(let j=0; j < haystack.length; j++){
                if($(haystack[j]).text().toLowerCase().startsWith(keypress_item_seach_term)){
                    matches.push(haystack[j])
                }
            }

            if(matches.length > 0){
                // if there are multiple matches and an item is already selected, remove all matches before the selected item
                if(selected_items.length > 0 && matches.length > 1){
                    let match_index;
                    for(let i=0; i < matches.length - 1; i++){
                        if($(matches[i]).is(selected_items)){
                            match_index = i;
                            break;
                        }
                    }
                    matches.splice(0, match_index+1);
                }
                // deselect all selected sibling items
                $('.context-menu').find(`.context-menu-item-active`).removeClass('context-menu-item-active');
                // select matching item
                $(matches[0]).addClass('context-menu-item-active');
                // matches[0].scrollIntoView(false);
                // update_explorer_footer_selected_items_count($(active_element).closest('.window'));
            }

            return false;
        }
    })

    $(document).bind("keyup keydown", async function(e){
        const focused_el = document.activeElement;
        //-----------------------------------------------------------------------------
        // Override ctrl/cmd + s/o
        //-----------------------------------------------------------------------------
        if((e.ctrlKey || e.metaKey) && (e.which === 83 || e.which === 79)){
            e.preventDefault()
            return false;
        }
        //-----------------------------------------------------------------------------
        // Select All
        // ctrl/command + a, will select all items on desktop and windows
        //-----------------------------------------------------------------------------
        if((e.ctrlKey || e.metaKey) && e.which === 65 && !$(focused_el).is('input') && !$(focused_el).is('textarea')){
            let $parent_container = $(active_element).closest('.item-container');
            if($parent_container.length === 0)
                $parent_container = $(active_element).find('.item-container');

            if($parent_container.attr('data-multiselectable') === 'false')
                return false;

            if($parent_container){
                $($parent_container).find('.item').not('.item-disabled').addClass('item-selected');
                update_explorer_footer_selected_items_count($parent_container.closest('.window'));
            }

            return false;
        }
        //-----------------------------------------------------------------------------
        // Close Window
        // ctrl + w, will close the active window
        //-----------------------------------------------------------------------------
        if(e.ctrlKey && e.which === 87){
            let $parent_window = $(active_element).closest('.window');
            if($parent_window.length === 0)
                $parent_window = $(active_element).find('.window');


            if($parent_window !== null){
                $($parent_window).close();
            }
        }

        //-----------------------------------------------------------------------------
        // Copy
        // ctrl/command + c, will copy selected items on the active element to the clipboard
        //-----------------------------------------------------------------------------
        if((e.ctrlKey || e.metaKey) && e.which === 67 && 
            $(mouseover_window).attr('data-is_dir') !== 'false' && 
            $(mouseover_window).attr('data-path') !== trash_path && 
            !$(focused_el).is('input') && 
            !$(focused_el).is('textarea')){
            let $selected_items;

            let parent_container = $(active_element).closest('.item-container');
            if(parent_container.length === 0)
                parent_container = $(active_element).find('.item-container');

            if(parent_container !== null){
                $selected_items = $(parent_container).find('.item-selected');
                if($selected_items.length > 0){
                    clipboard = [];
                    clipboard_op = 'copy';
                    $selected_items.each(function() {
                        // error if trash is being copied
                        if($(this).attr('data-path') === trash_path){
                            return;
                        }
                        // add to clipboard
                        clipboard.push({path: $(this).attr('data-path'), uid: $(this).attr('data-uid'), metadata: $(this).attr('data-metadata')});
                    })
                }
            }
            return false;
        }
        //-----------------------------------------------------------------------------
        // Cut
        // ctrl/command + x, will copy selected items on the active element to the clipboard
        //-----------------------------------------------------------------------------
        if((e.ctrlKey || e.metaKey) && e.which === 88 && !$(focused_el).is('input') && !$(focused_el).is('textarea')){
            let $selected_items;
            let parent_container = $(active_element).closest('.item-container');
            if(parent_container.length === 0)
                parent_container = $(active_element).find('.item-container');

            if(parent_container !== null){
                $selected_items = $(parent_container).find('.item-selected');
                if($selected_items.length > 0){
                    clipboard = [];
                    clipboard_op = 'move';
                    $selected_items.each(function() {
                        clipboard.push($(this).attr('data-path'));
                    })
                }
            }
            return false;
        }
        //-----------------------------------------------------------------------
        // Open
        // Enter key on a selected item will open it
        //-----------------------------------------------------------------------
        if(e.which === 13 && !$(focused_el).is('input') && !$(focused_el).is('textarea') && (Date.now() - last_enter_pressed_to_rename_ts) >200
            // prevent firing twice, because this will be fired on both keyup and keydown
            && e.type === 'keydown'){
            let $selected_items;

            e.preventDefault();
            e.stopPropagation();
            
            // ---------------------------------------------
            // if this is a selected Launch menu item, open it
            // ---------------------------------------------
            if($('.launch-app-selected').length > 0){
                // close launch menu
                $(".launch-popover").fadeOut(200, function(){
                    launch_app({
                        name: $('.launch-app-selected').attr('data-name'),
                    }) 
                    $(".launch-popover").remove();
                });

                return false;
            }
            // ---------------------------------------------
            // if this is a selected context menu item, open it
            // ---------------------------------------------
            else if($('.context-menu-active .context-menu-item-active').length > 0 && (e.which === 13)){
                // let selected_item = $('.context-menu-active .context-menu-item-active').get(0);
                // $(selected_item).trigger('mouseover');
                // $(selected_item).trigger('click');

                let selected_item = $('.context-menu-active .context-menu-item-active').get(0);
                $(selected_item).removeClass('context-menu-item-active');
                $(selected_item).addClass('context-menu-item-active-blurred');
                $(selected_item).trigger('mouseover');
                $(selected_item).trigger('click');
                if($('.context-menu[data-is-submenu="true"]').length > 0){
                    let selected_item = $('.context-menu[data-is-submenu="true"] .context-menu-item').get(0);
                    select_ctxmenu_item(selected_item);
                }

                return false;
            }
            // ---------------------------------------------
            // if this is a selected item, open it
            // ---------------------------------------------
            else if(active_item_container){
                $selected_items = $(active_item_container).find('.item-selected');
                if($selected_items.length > 0){
                    $selected_items.each(function() {
                        open_item({
                            item: this, 
                            new_window: e.metaKey || e.ctrlKey,
                        });        
                    })
                }
                return false;
            }
            
            return false;
        }
        //----------------------------------------------
        // Paste
        // ctrl/command + v, will paste items from the clipboard to the active element
        //----------------------------------------------
        if((e.ctrlKey || e.metaKey) && e.which === 86 && !$(focused_el).is('input') && !$(focused_el).is('textarea')){
            let target_path, target_el;

            // continue only if there is something in the clipboard
            if(clipboard.length === 0)
                return;

            let parent_container = determine_active_container_parent();

            if(parent_container){
                target_el = parent_container;
                target_path = $(parent_container).attr('data-path');
                // don't allow pasting in Trash
                if((target_path === trash_path || target_path.startsWith(trash_path + '/')) && clipboard_op !== 'move')
                    return;
                // execute clipboard operation
                if(clipboard_op === 'copy')
                    copy_clipboard_items(target_path);
                else if(clipboard_op === 'move')
                    move_clipboard_items(target_el, target_path);
            }
            return false;
        }
        //-----------------------------------------------------------------------------
        // Undo
        // ctrl/command + z, will undo last action
        //-----------------------------------------------------------------------------
        if((e.ctrlKey || e.metaKey) && e.which === 90){
            undo_last_action();
            return false;
        }
    });

    // update mouse position coordinates
    $(document).mousemove(function(event){
        mouseX = event.clientX;
        mouseY = event.clientY;
        
        // mouse in top-left corner of screen
        if((mouseX < 150 && mouseY < toolbar_height + 20) || (mouseX < 20 && mouseY < 150))
            current_active_snap_zone = 'nw';
        // mouse in left edge of screen
        else if(mouseX < 20 && mouseY >= 150 && mouseY < desktop_height - 150)
            current_active_snap_zone = 'w';
        // mouse in bottom-left corner of screen
        else if(mouseX < 20 && mouseY > desktop_height - 150)
            current_active_snap_zone = 'sw';
        // mouse in right edge of screen
        else if(mouseX > desktop_width - 20 && mouseY >= 150 && mouseY < desktop_height - 150)
            current_active_snap_zone = 'e';
        // mouse in top-right corner of screen
        else if((mouseX > desktop_width - 150 && mouseY < toolbar_height + 20) || (mouseX > desktop_width - 20 && mouseY < 150))
            current_active_snap_zone = 'ne';
        // mouse in bottom-right corner of screen
        else if(mouseX > desktop_width - 20 && mouseY >= desktop_height - 150)
            current_active_snap_zone = 'se';
        // mouse in top edge of screen
        else if(mouseY < toolbar_height + 20 && mouseX >= 150 && mouseX < desktop_width - 150)
            current_active_snap_zone =  'n';
        // not in any snap zone
        else
            current_active_snap_zone = undefined;

        // mouseover_window
        var windows = document.getElementsByClassName("window");
        let active_win;
        if(windows.length > 0){
            let highest_window_zindex = 0;
            for(let i=0; i<windows.length; i++){
                const rect = windows[i].getBoundingClientRect();
                if( mouseX > rect.x &&  mouseX < (rect.x + rect.width) && mouseY > rect.y &&  mouseY < (rect.y + rect.height)){
                    if(parseInt($(windows[i]).css('z-index')) >= highest_window_zindex){
                        active_win = windows[i];
                        highest_window_zindex = parseInt($(windows[i]).css('z-index'));
                    }
                }
            }
        }
        window.mouseover_window = active_win;

        // mouseover_item_container
        var item_containers = document.getElementsByClassName("item-container");
        let active_ic;
        if(item_containers.length > 0){
            let highest_window_zindex = 0;
            for(let i=0; i<item_containers.length; i++){
                const rect = item_containers[i].getBoundingClientRect();
                if( mouseX > rect.x &&  mouseX < (rect.x + rect.width) && mouseY > rect.y &&  mouseY < (rect.y + rect.height)){
                    let active_container_zindex = parseInt($(item_containers[i]).closest('.window').css('z-index'));
                    if( !isNaN(active_container_zindex) && active_container_zindex >= highest_window_zindex){
                        active_ic = item_containers[i];
                        highest_window_zindex = active_container_zindex;
                    }
                }
            }
        }
        window.mouseover_item_container = active_ic;
    });

    //--------------------------------------------------------
    // Window Activation
    //--------------------------------------------------------
    $(document).on('mousedown', function(e){
        // if taskbar or any parts of it is clicked, drop the event
        if($(e.target).hasClass('taskbar') || $(e.target).closest('.taskbar').length > 0)
            return;

        // if mouse is clicked on a window, activate it
        if(mouseover_window !== undefined){
            $(mouseover_window).focusWindow(e);
        }
    })

    // if an element has the .long-hover class, fire a long-hover event after 600ms
    $(document).on('mouseenter', '.long-hover', function(){
        let el = this;
        el.long_hover_timeout = setTimeout(() => {
            $(el).trigger('long-hover');
        }, 600);
    })

    // if an element has the .long-hover class, cancel the long-hover event if the mouse leaves
    $(document).on('mouseleave', '.long-hover', function(){
        clearTimeout(this.long_hover_timeout);
    })

    // if an element has the .long-hover class, cancel the long-hover event if the mouse leaves
    $(document).on('paste', function(event){
        event = event.originalEvent ?? event;

        let clipboardData = event.clipboardData || window.clipboardData;
        let items = clipboardData.items || clipboardData.files;

        // return if paste is on input or textarea
        if($(event.target).is('input') || $(event.target).is('textarea'))
            return;

        if(!(items instanceof DataTransferItemList))
            return;

        // upload files
        if(items?.length>0){
            let parent_container = determine_active_container_parent();
            if(parent_container){
                upload_items(items, $(parent_container).attr('data-path'));
            }
        }

        event.stopPropagation();
        event.preventDefault();
        return false;
    })

    document.addEventListener("visibilitychange", (event) => {
        if (document.visibilityState !== "visible") {
            window.doc_title_before_blur = document.title;
            if(!_.isEmpty(window.active_uploads)){
                update_title_based_on_uploads();
            }
        }else if(window.active_uploads){
            document.title = window.doc_title_before_blur ?? 'Puter';
        }
    });

    /**
     * Event handler for a custom 'logout' event attached to the document.
     * This function handles the process of logging out, including user confirmation,
     * communication with the backend, and subsequent UI updates. It takes special
     * precautions if the user is identified as using a temporary account.
     *
     * @listens Document#event:logout
     * @async
     * @param {Event} event - The JQuery event object associated with the logout event.
     * @returns {Promise<void>} - This function does not return anything meaningful, but it performs an asynchronous operation.
     */
    $(document).on("logout", async function(event) {
        // is temp user?
        if(window.user && window.user.is_temp && !window.user.deleted){
            const alert_resp = await UIAlert({
                message: `<strong>Save account before logging out!</strong><p>You are using a temporary account and logging out will erase all your data.</p>`,
                buttons:[
                    {
                        label: i18n('save_account'),
                        value: 'save_account',
                        type: 'primary',
                    },
                    {
                        label: i18n('log_out'),
                        value: 'log_out',
                        type: 'danger',
                    },
                    {
                        label: i18n('cancel'),
                    },
                ]
            })
            if(alert_resp === 'save_account'){
                let saved = await UIWindowSaveAccount({
                    send_confirmation_code: false,
                    default_username: window.user.username
                });
                if(saved)
                    logout();
            }else if (alert_resp === 'log_out'){
                logout();
            }
            else{
                return;
            }
        }

        // logout
        try{
            await $.ajax({
                url: gui_origin + "/logout",
                type: 'POST',
                async: true,
                contentType: "application/json",
                headers: {
                    "Authorization": "Bearer " + auth_token
                },
                statusCode: {
                    401: function () {
                    },
                },
            })
        }catch(e){

        }

        // remove this user from the array of logged_in_users
        for (let i = 0; i < window.logged_in_users.length; i++) {
            if(window.logged_in_users[i].uuid === window.user.uuid){
                window.logged_in_users.splice(i, 1);
                break;
            }
        }

        // update logged_in_users in local storage
        localStorage.setItem('logged_in_users', JSON.stringify(window.logged_in_users));

        // delete this user from local storage
        window.user = null;
        localStorage.removeItem('user');
        window.auth_token = null;
        localStorage.removeItem('auth_token');

        // close all windows
        $('.window').close();
        // close all ctxmenus
        $('.context-menu').remove();
        // remove desktop
        $('.desktop').remove();
        // remove taskbar
        $('.taskbar').remove();
        // disable native browser exit confirmation
        window.onbeforeunload = null;
        // go to home page
        window.location.replace("/");
    });    
}

function requestOpenerOrigin() {
    return new Promise((resolve, reject) => {
        if (!window.opener) {
            reject(new Error("No window.opener available"));
            return;
        }

        // Function to handle the message event
        const handleMessage = (event) => {
            // Check if the message is the expected response
            if (event.data.msg === 'originResponse') {
                // Clean up by removing the event listener
                window.removeEventListener('message', handleMessage);
                resolve(event.origin);
            }
        };

        // Set up the listener for the response
        window.addEventListener('message', handleMessage, false);

        // Send the request to the opener
        window.opener.postMessage({ msg: 'requestOrigin' }, '*');

        // Optional: Reject the promise if no response is received within a timeout
        setTimeout(() => {
            window.removeEventListener('message', handleMessage);
            reject(new Error("Response timed out"));
        }, 5000); // Timeout after 5 seconds
    });
}

$(document).on('click', '.generic-close-window-button', function(e){
    $(this).closest('.window').close();
});

// Re-calculate desktop height and width on window resize and re-position the login and signup windows
$(window).on("resize", function () {
    // If host env is popup, don't continue because the popup window has its own resize requirements.
    if (window.embedded_in_popup)
        return;

    const ratio = window.desktop_width / window.innerWidth;

    window.desktop_height = window.innerHeight - window.toolbar_height - window.taskbar_height;
    window.desktop_width = window.innerWidth;

    // Re-center the login window
    const top = $(".window-login").position()?.top;
    const width = $(".window-login").width();
    $(".window-login").css({
        left: (window.desktop_width - width) / 2,
        top: top / ratio,
    });

    // Re-center the create account window
    const top2 = $(".window-signup").position()?.top;
    const width2 = $(".window-signup").width();
    $(".window-signup").css({
        left: (window.desktop_width - width2) / 2,
        top: top2 / ratio,
    });
});