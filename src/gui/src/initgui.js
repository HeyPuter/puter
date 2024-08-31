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
import { ThemeService } from './services/ThemeService.js';
import { BroadcastService } from './services/BroadcastService.js';
import { ProcessService } from './services/ProcessService.js';
import { PROCESS_RUNNING } from './definitions.js';
import { LocaleService } from './services/LocaleService.js';
import { SettingsService } from './services/SettingsService.js';
import UIComponentWindow from './UI/UIComponentWindow.js';
import update_mouse_position from './helpers/update_mouse_position.js';
import { LaunchOnInitService } from './services/LaunchOnInitService.js';
import item_icon from './helpers/item_icon.js';
import { AntiCSRFService } from './services/AntiCSRFService.js';
import { IPCService } from './services/IPCService.js';
import { ExecService } from './services/ExecService.js';

const launch_services = async function (options) {
    // === Services Data Structures ===
    const services_l_ = [];
    const services_m_ = {};
    globalThis.services = {
        get: (name) => services_m_[name],
    };
    const register = (name, instance) => {
        services_l_.push([name, instance]);
        services_m_[name] = instance;
    }

    globalThis.def(UIComponentWindow, 'ui.UIComponentWindow');

    // === Hooks for Service Scripts from Backend ===
    const service_script_deferred = { services: [], on_ready: [] };
    const service_script_api = {
        register: (...a) => service_script_deferred.services.push(a),
        on_ready: fn => service_script_deferred.on_ready.push(fn),
        // Some files can't be imported by service scripts,
        // so this hack makes that possible.
        def: globalThis.def,
        use: globalThis.use,
        // use: name => ({ UIWindow, UIComponentWindow })[name],
    };
    globalThis.service_script_api_promise.resolve(service_script_api);

    // === Builtin Services ===
    register('ipc', new IPCService());
    register('exec', new ExecService());
    register('broadcast', new BroadcastService());
    register('theme', new ThemeService());
    register('process', new ProcessService());
    register('locale', new LocaleService());
    register('settings', new SettingsService());
    register('anti-csrf', new AntiCSRFService());
    register('__launch-on-init', new LaunchOnInitService());

    // === Service-Script Services ===
    for (const [name, script] of service_script_deferred.services) {
        register(name, script);
    }

    for (const [_, instance] of services_l_) {
        await instance.construct({
            gui_params: options,
        });
    }

    for (const [_, instance] of services_l_) {
        await instance.init({
            services: globalThis.services,
        });
    }

    // === Service-Script Ready ===
    for (const fn of service_script_deferred.on_ready) {
        await fn();
    }

    // Set init process status
    {
        const svc_process = globalThis.services.get('process');
        svc_process.get_init().chstatus(PROCESS_RUNNING);
    }
};

// This code snippet addresses the issue flagged by Lighthouse regarding the use of
// passive event listeners to enhance scrolling performance. It provides custom
// implementations for touchstart, touchmove, wheel, and mousewheel events in jQuery.
// By setting the 'passive' option appropriately, it ensures that default browser
// behavior is prevented when necessary, thereby improving page scroll performance.
// More info: https://stackoverflow.com/a/62177358
if(jQuery){
    jQuery.event.special.touchstart = {
        setup: function( _, ns, handle ) {
            this.addEventListener("touchstart", handle, { passive: !ns.includes("noPreventDefault") });
        }
    };
    jQuery.event.special.touchmove = {
        setup: function( _, ns, handle ) {
            this.addEventListener("touchmove", handle, { passive: !ns.includes("noPreventDefault") });
        }
    };
    jQuery.event.special.wheel = {
        setup: function( _, ns, handle ){
            this.addEventListener("wheel", handle, { passive: true });
        }
    };
    jQuery.event.special.mousewheel = {
        setup: function( _, ns, handle ){
            this.addEventListener("mousewheel", handle, { passive: true });
        }
    };
}

window.initgui = async function(options){
    let url = new URL(window.location);
    url = url.href;

    let picked_a_user_for_sdk_login = false;

    // update SDK if auth_token is different from the one in the SDK
    if(window.auth_token && puter.authToken !== window.auth_token)
        puter.setAuthToken(window.auth_token);
    // update SDK if api_origin is different from the one in the SDK
    if(window.api_origin && puter.APIOrigin !== window.api_origin)
        puter.setAPIOrigin(window.api_origin);

    // Print the version to the console
    puter.os.version()
    .then(res => {
        const deployed_date = new Date(res.deploy_timestamp);
        console.log(`Your Puter information:\n• Version: ${(res.version)}\n• Server: ${(res.location)}\n• Deployed: ${(deployed_date)}`);
    })
    .catch(error => {
        console.error("Failed to fetch server info:", error);
    });

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

    window.url_paths = window.location.pathname.split('/').filter(element => element);

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
    if(window.url_query_params.has('puter.fullpage') && (window.url_query_params.get('puter.fullpage') === 'false' || window.url_query_params.get('puter.fullpage') === '0')){
        window.is_fullpage_mode = false;
    }else if(window.url_query_params.has('puter.fullpage') && (window.url_query_params.get('puter.fullpage') === 'true' || window.url_query_params.get('puter.fullpage') === '1')){
        // In fullpage mode, we want to hide the taskbar for better UX
        window.taskbar_height = 0;

        // Puter is in fullpage mode.
        window.is_fullpage_mode = true;
    }

    // Launch services before any UI is rendered
    await launch_services(options);

    //--------------------------------------------------------------------------------------
    // Is GUI embedded in a popup?
    // i.e. https://puter.com/?embedded_in_popup=true
    //--------------------------------------------------------------------------------------
    if(window.url_query_params.has('embedded_in_popup') && (window.url_query_params.get('embedded_in_popup') === 'true' || window.url_query_params.get('embedded_in_popup') === '1')){
        window.embedded_in_popup = true;
        $('body').addClass('embedded-in-popup');

        // determine the origin of the opener
        window.openerOrigin = document.referrer;

        // if no referrer, request it from the opener via messaging
        if(!document.referrer){
            try{
                window.openerOrigin = await requestOpenerOrigin();
            }catch(e){
                throw new Error('No referrer found');
            }
        }

        // this is the referrer in terms of user acquisition
        window.referrerStr = window.openerOrigin;

        if(action === 'sign-in' && !window.is_auth()){
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
                await window.getUserAppToken(window.openerOrigin);
        }
        else if(action === 'sign-in' && window.is_auth()){
            picked_a_user_for_sdk_login = await UIWindowSessionList({
                reload_on_success: false,
                draggable_body: false,
                has_head: false,
                cover_page: true,
            });

            if(picked_a_user_for_sdk_login){
                await window.getUserAppToken(window.openerOrigin);
            }

        }
    }
    
    //--------------------------------------------------------------------------------------
    // Display an error if the query parameters have an error
    //--------------------------------------------------------------------------------------
    if ( window.url_query_params.has('error') ) {
        // TODO: i18n
        await UIAlert({
            message: window.url_query_params.get('message')
        });
    }

    //--------------------------------------------------------------------------------------
    // Get user referral code from URL query params
    // i.e. https://puter.com/?r=123456
    //--------------------------------------------------------------------------------------
    if(window.url_query_params.has('r')){
        window.referral_code = window.url_query_params.get('r');
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
        let app_uid = window.url_query_params.get('app_uid');
        let origin = window.openerOrigin ?? window.url_query_params.get('origin');
        let permission = window.url_query_params.get('permission');

        let granted = await UIWindowRequestPermission({
            app_uid: app_uid,
            origin: origin,
            permission: permission,
        });

        let messageTarget = window.embedded_in_popup ? window.opener : window.parent;
        messageTarget.postMessage({
            msg: "permissionGranted",
            granted: granted,
        }, origin);
    }
    //--------------------------------------------------------------------------------------
    // Action: Password recovery
    //--------------------------------------------------------------------------------------
    else if(action === 'set-new-password'){
        let user = window.url_query_params.get('user');
        let token = window.url_query_params.get('token');

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
    if(window.embedded_in_popup && window.openerOrigin){
        let response = await window.checkUserSiteRelationship(window.openerOrigin);
        window.userAppToken = response.token;

        if(!picked_a_user_for_sdk_login && window.logged_in_users.length > 0 && (!window.userAppToken || window.url_query_params.get('request_auth') )){
            await UIWindowSessionList({
                reload_on_success: false,
                draggable_body: false,
                has_head: false,
                cover_page: true,
            });
        }
        // if not and action is show-open-file-picker, we need confirmation before proceeding
        if(action === 'show-open-file-picker' || action === 'show-save-file-picker' || action === 'show-directory-picker'){
            if(!window.userAppToken){
                let is_confirmed = await PuterDialog();

                if(is_confirmed === false){
                    if(!window.is_auth()){
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
    else if(window.url_query_params.has('auth_token')){
        let query_param_auth_token = window.url_query_params.get('auth_token');

        try{
            whoami = await puter.os.user();
        }catch(e){
            if(e.status === 401){
                window.logout();
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
            window.update_auth_data(query_param_auth_token, whoami);
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
    if(window.is_auth()){
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
            window.update_auth_data(whoami.token || window.auth_token, whoami);

            // -------------------------------------------------------------------------------------
            // Load desktop, only if we're not embedded in a popup
            // -------------------------------------------------------------------------------------
            if(!window.embedded_in_popup){
                await window.get_auto_arrange_data()
                puter.fs.stat(window.desktop_path, async function(desktop_fsentry){
                    UIDesktop({desktop_fsentry: desktop_fsentry});
                })
            }
            // -------------------------------------------------------------------------------------
            // If embedded in a popup, send the token to the opener and close the popup
            // -------------------------------------------------------------------------------------
            else{
                let msg_id = window.url_query_params.get('msg_id');
                try{
                    let data = await window.getUserAppToken(new URL(window.openerOrigin).origin);
                    // This is an implicit app and the app_uid is sent back from the server
                    // we cache it here so that we can use it later
                    window.host_app_uid = data.app_uid;
                    // send token to parent
                    window.opener.postMessage({
                        msg: 'puter.token',
                        success: true,
                        token: data.token,
                        app_uid: data.app_uid,
                        username: window.user.username,
                        msg_id: msg_id,
                    }, window.openerOrigin);
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
                    }, window.openerOrigin);
                    // close popup
                    window.close();
                    window.open('','_self').close();
                }

                let app_uid;

                if(window.openerOrigin){
                    app_uid = await window.getAppUIDFromOrigin(window.openerOrigin);
                    window.host_app_uid = app_uid;
                }

                if(action === 'show-open-file-picker'){
                    let options = window.url_query_params.get('options');
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
                    let allowed_file_types = window.url_query_params.get('allowed_file_types');

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
                                                path: privacy_aware_path(res.path),
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
                    });
                }
            }

            // ----------------------------------------------------------
            // Get user's sites
            // ----------------------------------------------------------
            window.update_sites_cache();
        }
    }
    //--------------------------------------------------------------------------------------
    // `share_token` provided
    // i.e. https://puter.com/?share_token=<share_token>
    //--------------------------------------------------------------------------------------
    if(window.url_query_params.has('share_token')){
        let share_token = window.url_query_params.get('share_token');

        fetch(`${puter.APIOrigin}/sharelink/check`, {
            "headers": {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${puter.authToken}`,
            },
            "body": JSON.stringify({
                token: share_token,
            }),
            "method": "POST",
        }).then(response => response.json())
        .then(async data => {
            // Show register screen
            if(data.email && data.email !== window.user?.email){
                await UIWindowSignup({
                    reload_on_success: true,
                    email: data.email,
                    send_confirmation_code: false,
                    window_options:{
                        has_head: false
                    }
                });
            }
            // Show email confirmation screen
            else if(data.email && data.email === window.user.email && !window.user.email_confirmed){
                // todo show email confirmation window
                await UIWindowEmailConfirmationRequired({
                    stay_on_top: true,
                    has_head: false
                });
            }

            // show shared item
            UIWindow({
                path: data.path,
                title: path.basename(data.path),
                icon: await item_icon({is_dir: data.is_dir, path: data.path}),
                is_dir: data.is_dir,
                app: 'explorer',
            });
        }).catch(error => {
            console.error('Error:', error);
        })
    }
    // -------------------------------------------------------------------------------------
    // Desktop Background
    // If we're in fullpage/emebedded/Auth Popup mode, we don't want to load the custom background
    // because it's not visible anyway and it's a waste of bandwidth
    // -------------------------------------------------------------------------------------
    if(!window.is_fullpage_mode && !window.embedded_in_popup){
        window.refresh_desktop_background();
    }
    // -------------------------------------------------------------------------------------
    // Un-authed but not first visit -> try to log in/sign up
    // -------------------------------------------------------------------------------------
    if(!window.is_auth() && (!window.first_visit_ever || window.disable_temp_users)){
        if(window.logged_in_users.length > 0){
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
    else if(!window.is_auth() && window.first_visit_ever && !window.disable_temp_users){
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
        if(window.url_query_params.has('ref')){
            if(!referrer)
                referrer = '/';
            referrer += '?ref=' + html_encode(window.url_query_params.get('ref'));
        }


        let headers = {};
        if(window.custom_headers)
            headers = window.custom_headers;
        $.ajax({
            url: window.gui_origin + "/signup",
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
                window.update_auth_data(data.token, data.user);
                document.dispatchEvent(new Event("login", { bubbles: true}));
            },
            error: function (err){
                $('#signup-error-msg').html(html_encode(err.responseText));
                $('#signup-error-msg').fadeIn();
                // re-enable 'Create Account' button
                $('.signup-btn').prop('disabled', false);
            }
        });
    }

    // if there is at least one window open (only non-Explorer windows), ask user for confirmation when navigating away
    if(window.feature_flags.prompt_user_when_navigation_away_from_puter){
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
            await window.get_auto_arrange_data();
            puter.fs.stat(window.desktop_path, function (desktop_fsentry) {
                UIDesktop({ desktop_fsentry: desktop_fsentry });
            })
        }
        // -------------------------------------------------------------------------------------
        // If embedded in a popup, send the 'ready' event to referrer and close the popup
        // -------------------------------------------------------------------------------------
        else{
            let msg_id = window.url_query_params.get('msg_id');
            try{

                let data = await window.getUserAppToken(new URL(window.openerOrigin).origin);
                // This is an implicit app and the app_uid is sent back from the server
                // we cache it here so that we can use it later
                window.host_app_uid = data.app_uid;
                // send token to parent
                window.opener.postMessage({
                    msg: 'puter.token',
                    success: true,
                    msg_id: msg_id,
                    token: data.token,
                    username: window.user.username,
                    app_uid: data.app_uid,
                }, window.openerOrigin);
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
                }, window.openerOrigin);
                // close popup
                window.close();
                window.open('','_self').close();
            }


            let app_uid;

            if(window.openerOrigin){
                app_uid = await window.getAppUIDFromOrigin(window.openerOrigin);
                window.host_app_uid = app_uid;
            }

            //--------------------------------------------------------------------------------------
            // Action: Show Open File Picker
            //--------------------------------------------------------------------------------------
            if(action === 'show-open-file-picker'){
                let options = window.url_query_params.get('options');
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
                let allowed_file_types = window.url_query_params.get('allowed_file_types');

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
                                            path: privacy_aware_path(res.path),
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
            window.update_explorer_footer_selected_items_count(e.target);
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
            window.active_item_container = e.target;
        }else{
            let ic = $(e.target).closest('.item-container')
            if(ic.length > 0){
                window.active_item_container = ic.get(0);
            }else{
                let pp = $(e.target).find('.item-container')
                if(pp.length > 0){
                    window.active_item_container = pp.get(0);
                }
            }
        }

        //active element
        window.active_element = e.target;
    });

    // update mouse position coordinates
    $(document).mousemove(function(event){
        update_mouse_position(event.clientX, event.clientY);
    });

    //--------------------------------------------------------
    // Window Activation
    //--------------------------------------------------------
    $(document).on('mousedown', function(e){
        // if taskbar or any parts of it is clicked, drop the event
        if($(e.target).hasClass('taskbar') || $(e.target).closest('.taskbar').length > 0)
            return;

        // if mouse is clicked on a window, activate it
        if(window.mouseover_window !== undefined){
            $(window.mouseover_window).focusWindow(e);
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
                window.upload_items(items, $(parent_container).attr('data-path'));
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
                    window.logout();
            }else if (alert_resp === 'log_out'){
                window.logout();
            }
            else{
                return;
            }
        }

        // logout
        try{
            const resp = await fetch(`${window.gui_origin}/get-anticsrf-token`);
            const { token } = await resp.json();
            await $.ajax({
                url: window.gui_origin + "/logout",
                type: 'POST',
                async: true,
                contentType: "application/json",
                headers: {
                    "Authorization": "Bearer " + window.auth_token
                },
                data: JSON.stringify({ anti_csrf: token }),
                statusCode: {
                    401: function () {
                    },
                },
            })
        }catch(e){
            // Ignored
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

$(document).on('contextmenu', '.disable-context-menu', function(e){
    if($(e.target).hasClass('disable-context-menu') ){
        e.preventDefault();
        return false;
    }
})

/**
 * Converts a file system path to a privacy-aware path.
 * - Paths starting with `~/` are returned unchanged.
 * - Paths starting with the user's home path are replaced with `~`.
 * - Absolute paths not starting with the user's home path are returned unchanged.
 * - Relative paths are prefixed with `~/`.
 * - Other paths are returned unchanged.
 *
 * @param {string} fspath - The file system path to be converted.
 * @returns {string} The privacy-aware path.
 */
window.privacy_aware_path = function(fspath){
    // e.g. /my_username/test.txt -> ~/test.txt
    if(fspath.startsWith('~/'))
        return fspath;
    // e.g. /my_username/test.txt -> ~/test.txt
    else if(fspath.startsWith(window.home_path))
        return fspath.replace(window.home_path, '~');
    // e.g. /other_username/test.txt -> /other_username/test.txt
    else if(fspath.startsWith('/') && !fspath.startsWith(window.home_path))
        return fspath;
    // e.g. test.txt -> ~/test.txt
    else if(!fspath.startsWith('/'))
        return '~/' + fspath;
    // e.g. /username/path/to/item -> /username/path/to/item
    else
        return fspath;
}