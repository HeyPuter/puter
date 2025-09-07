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

import path from "../lib/path.js"
import { PROCESS_IPC_ATTACHED, PROCESS_RUNNING, PortalProcess, PseudoProcess } from "../definitions.js";
import UIWindow from "../UI/UIWindow.js";

/**
 * Launches an app. 
 * 
 * @param {*} options.name - The name of the app to launch.
 */
const launch_app = async (options)=>{
    let transaction;
    // A transaction to trace the time it takes to launch an app and 
    // for it to be ready.
    // Explorer is a special case, it's not an app per se, so it doesn't need a transaction.
    if(options?.name !== 'explorer'){
        transaction = new window.Transaction('app-is-ready');
        transaction.start();
    }

    const uuid = options.uuid ?? window.uuidv4();
    let icon, title, file_signature;
    const window_options = options.window_options ?? {};

    if (options.parent_instance_id) {
        window_options.parent_instance_id = options.parent_instance_id;
    }

    // If the app object is not provided, get it from the server
    let app_info;
    
    // explorer is a special case
    if(options.name === 'explorer'){
        app_info = [];
    }
    else if(options.app_obj)
        app_info = options.app_obj;
    else
        app_info = await puter.apps.get(options.name, {icon_size: 64});

    // For backward compatibility reasons we need to make sure that both `uuid` and `uid` are set
    app_info.uuid = app_info.uuid ?? app_info.uid;
    app_info.uid = app_info.uid ?? app_info.uuid;

    // If no `options.name` is provided, use the app name from the app_info
    options.name = options.name ?? app_info.name;

    //-----------------------------------
    // icon
    //-----------------------------------
    if(app_info.icon)
        icon = app_info.icon;
    else if(options.name === 'explorer')
        icon = window.icons['folder.svg'];
    else
        icon = window.icons['app-icon-'+options.name+'.svg']

    //-----------------------------------
    // title
    //-----------------------------------
    if(app_info.title)
        title = app_info.title;
    else if(options.window_title)
        title = options.window_title;
    else if(options.name)
        title = options.name;

    //-----------------------------------
    // maximize on start
    //-----------------------------------
    if(app_info.maximize_on_start){
        options.maximized = 1;
    }
    //-----------------------------------
    // if opened a file, sign it
    //-----------------------------------
    if(options.file_signature)
        file_signature = options.file_signature;
    else if(options.file_uid){
        file_signature = await puter.fs.sign(app_info.uuid, {uid: options.file_uid, action: 'write'});
        // add token to options
        options.token = file_signature.token;
        // add file_signature to options
        file_signature = file_signature.items;
    }

    // -----------------------------------
    // Create entry to track the "portal"
    // (portals are processese in Puter's GUI)
    // -----------------------------------

    let el_win;
    let process;

    //------------------------------------
    // Explorer
    //------------------------------------
    if(options.name === 'explorer' || options.name === 'trash'){
        process = new PseudoProcess({
            uuid,
            name: 'explorer',
            parent: options.parent_instance_id,
            meta: {
                launch_options: options,
                app_info: app_info,
            }
        });
        const svc_process = globalThis.services.get('process');
        svc_process.register(process);
        if(options.path === window.home_path){
            title = i18n('home');
            icon = window.icons['folder-home.svg'];
        }
        else if(options.path === window.trash_path){
            title = 'Trash';
            icon = window.icons['trash.svg'];
        }
        else if(!options.path)
            title = window.root_dirname;
        else
            title = path.dirname(options.path);

        // if options.args.path is provided, use it as the path
        if(options.args?.path){
            // if args.path is provided, enforce the directory
            let fsentry = await puter.fs.stat(options.args.path);
            if(!fsentry.is_dir){
                let parent = path.dirname(options.args.path);
                if(parent === options.args.path)
                    parent = window.home_path;
                options.path = parent;
            }else{
                options.path = options.args.path;
            }  
        }

        // if path starts with ~, replace it with home_path
        if(options.path && options.path.startsWith('~/'))
            options.path = window.home_path + options.path.slice(1);
        // if path is ~, replace it with home_path
        else if(options.path === '~')
            options.path = window.home_path;

        // open window
        el_win = UIWindow({
            element_uuid: uuid,
            icon: icon,
            path: options.path ?? window.home_path,
            title: title,
            uid: null,
            is_dir: true,
            app: 'explorer',
            ...window_options,
            is_maximized: options.maximized,
        });
    }
    //------------------------------------
    // All other apps
    //------------------------------------
    else{
        process = new PortalProcess({
            uuid,
            name: app_info.name,
            parent: options.parent_instance_id,
            meta: {
                launch_options: options,
                app_info: app_info,
            }
        });
        const svc_process = globalThis.services.get('process');
        svc_process.register(process);

        //-----------------------------------
        // iframe_url
        //-----------------------------------
        let iframe_url;

        // This can be any trusted URL that won't be used for other apps
        const BUILTIN_PREFIX = 'https://builtins.namespaces.puter.com/';

        if(!app_info.index_url){
            iframe_url = new URL('https://'+options.name+'.' + window.app_domain + `/index.html`);
        } else if ( app_info.index_url.startsWith(BUILTIN_PREFIX) ) {
            const name = app_info.index_url.slice(BUILTIN_PREFIX.length);
            iframe_url = new URL(`${window.gui_origin}/builtin/${name}`);
        } else {
            iframe_url = new URL(app_info.index_url);
        }

        // add app_instance_id to URL
        iframe_url.searchParams.append('puter.app_instance_id', uuid);

        // add app_id to URL
        iframe_url.searchParams.append('puter.app.id', app_info.uuid);
        iframe_url.searchParams.append('puter.app.name', app_info.name);

        // add parent_app_instance_id to URL
        if (options.parent_instance_id) {
            iframe_url.searchParams.append('puter.parent_instance_id', options.parent_pseudo_id);
        }

        // add source app metadata to URL
        if (options.source_app_title) {
            iframe_url.searchParams.append('puter.source_app.title', options.source_app_title);
        }
        if (options.source_app_id) {
            iframe_url.searchParams.append('puter.source_app.id', options.source_app_id);
        }
        if (options.source_app_icon) {
            iframe_url.searchParams.append('puter.source_app.icon', options.source_app_icon);
        }
        if (options.source_app_name) {
            iframe_url.searchParams.append('puter.source_app.name', options.source_app_name);
        }

        if(file_signature){
            iframe_url.searchParams.append('puter.item.uid', file_signature.uid);
            iframe_url.searchParams.append('puter.item.path', options.file_path ? privacy_aware_path(options.file_path) : file_signature.path);
            iframe_url.searchParams.append('puter.item.name', file_signature.fsentry_name);
            iframe_url.searchParams.append('puter.item.read_url', file_signature.read_url);
            iframe_url.searchParams.append('puter.item.write_url', file_signature.write_url);
            iframe_url.searchParams.append('puter.item.metadata_url', file_signature.metadata_url);
            iframe_url.searchParams.append('puter.item.size', file_signature.fsentry_size);
            iframe_url.searchParams.append('puter.item.accessed', file_signature.fsentry_accessed);
            iframe_url.searchParams.append('puter.item.modified', file_signature.fsentry_modified);
            iframe_url.searchParams.append('puter.item.created', file_signature.fsentry_created);
        }
        else if(options.readURL){
            iframe_url.searchParams.append('puter.item.name', options.filename);
            iframe_url.searchParams.append('puter.item.path', privacy_aware_path(options.file_path));
            iframe_url.searchParams.append('puter.item.read_url', options.readURL);
        }

        // In godmode, we add the super token to the iframe URL
        // so that the app can access everything.
        if (app_info.godmode && (app_info.godmode === true || app_info.godmode === 1)){
            iframe_url.searchParams.append('puter.auth.token', window.auth_token);
            iframe_url.searchParams.append('puter.auth.username', window.user.username);
        } 
        // App token. Only add token if it's not a GODMODE app since GODMODE apps already have the super token
        // that has access to everything.
        else if (options.token){
            iframe_url.searchParams.append('puter.auth.token', options.token);
        } else {
            // Try to acquire app token from the server

            let response = await fetch(window.api_origin + "/auth/get-user-app-token", {
                "headers": {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer "+ window.auth_token,
                },
                "body": JSON.stringify({app_uid: app_info.uid ?? app_info.uuid}),
                "method": "POST",
                });
            let res = await response.json();
            if(res.token){
                iframe_url.searchParams.append('puter.auth.token', res.token);
            }
        }

        iframe_url.searchParams.append('puter.domain', window.app_domain);

        // get URL parts
        const url = new URL(window.location.href);
  
        iframe_url.searchParams.append('puter.origin', url.origin);
        iframe_url.searchParams.append('puter.hostname', url.hostname);
        iframe_url.searchParams.append('puter.port', url.port);
        iframe_url.searchParams.append('puter.protocol', url.protocol.slice(0, -1));
      
        if(window.api_origin)
            iframe_url.searchParams.append('puter.api_origin', window.api_origin);

        // Add options.params to URL
        if(options.params){
            for (const property in options.params) {
                iframe_url.searchParams.append(property, options.params[property]);
            }
        }

        // Add locale to URL
        iframe_url.searchParams.append('puter.locale', window.locale);

        // Add options.args to URL
        iframe_url.searchParams.append('puter.args', JSON.stringify(options.args ?? {}));

        // ...and finally append utm_source=puter.com to the URL
        iframe_url.searchParams.append('utm_source', 'puter.com');

        // register app_instance_uid
        window.app_instance_ids.add(uuid);

        // width
        let window_width;
        if(app_info.metadata?.window_size?.width !== undefined && app_info.metadata?.window_size?.width !== '')
            window_width = parseFloat(app_info.metadata.window_size.width);
        if(options.maximized)
            window_width = '100%';

        // height
        let window_height;
        if(app_info.metadata?.window_size?.height !== undefined && app_info.metadata?.window_size?.height !== ''){
            window_height = parseFloat(app_info.metadata.window_size.height);
        }if(options.maximized)
            window_height = `calc(100% - ${window.taskbar_height + window.toolbar_height + 1}px)`;

        // top
        let top;
        if(app_info.metadata?.window_position?.top !== undefined && app_info.metadata?.window_position?.top !== '')
            top = parseFloat(app_info.metadata.window_position.top) + window.toolbar_height + 1;
        if(options.maximized)
            top = 0;

        // left
        let left;
        if(app_info.metadata?.window_position?.left !== undefined && app_info.metadata?.window_position?.left !== '')
            left = parseFloat(app_info.metadata.window_position.left);
        if(options.maximized)
            left = 0;

        // window_resizable
        let window_resizable = true;
        if(app_info.metadata?.window_resizable !== undefined && typeof app_info.metadata.window_resizable === 'boolean')
            window_resizable = app_info.metadata.window_resizable;

        // hide_titlebar
        let hide_titlebar = false;
        if(app_info.metadata?.hide_titlebar !== undefined && typeof app_info.metadata.hide_titlebar === 'boolean')
            hide_titlebar = app_info.metadata.hide_titlebar;

        // credentialless
        let credentialless = true;
        if(app_info.metadata?.credentialless !== undefined && typeof app_info.metadata.credentialless === 'boolean')
            credentialless = app_info.metadata.credentialless;

        // open window
        el_win = UIWindow({
            element_uuid: uuid,
            title: title,
            iframe_url: iframe_url.href,
            params: options.params ?? undefined,
            icon: icon,
            window_class: 'window-app',
            update_window_url: true,
            app_uuid: app_info.uuid ?? app_info.uid,
            top: top,
            left: left,
            height: window_height,
            width: window_width,
            app: options.name,
            iframe_credentialless: credentialless,
            is_visible: ! app_info.background,
            is_maximized: options.maximized,
            is_fullpage: options.is_fullpage,
            ...(options.pseudonym ? {pseudonym: options.pseudonym} : {}),
            ...window_options,
            is_resizable: window_resizable,
            has_head: ! hide_titlebar,
            show_in_taskbar: app_info.background ? false : window_options?.show_in_taskbar,
        });

        // If the app is not in the background, show the window
        if ( ! app_info.background ) {
            $(el_win).show();
        }

        // send post request to /rao to record app open
        if(options.name !== 'explorer'){
            // add the app to the beginning of the array
            window.launch_apps.recent.unshift(app_info);

            // dedupe the array by uuid, uid, and id
            window.launch_apps.recent = _.uniqBy(window.launch_apps.recent, 'name');

            // limit to window.launch_recent_apps_count
            window.launch_apps.recent = window.launch_apps.recent.slice(0, window.launch_recent_apps_count);

            // send post request to /rao to record app open
            $.ajax({
                url: window.api_origin + "/rao",
                type: 'POST',
                data: JSON.stringify({ 
                    original_client_socket_id: window.socket?.id,
                    app_uid: app_info.uid ?? app_info.uuid,
                }),
                async: true,
                contentType: "application/json",
                headers: {
                    "Authorization": "Bearer "+window.auth_token
                },
            })
        }
    }

    const el = await el_win;
    process.references.el_win = el;

    if ( ! options.launched_by_exec_service ) {
        process.onchange('ipc_status', value => {
            if ( value !== PROCESS_IPC_ATTACHED ) return;

            $(process.references.iframe).attr('data-appUsesSDK', 'true');

            // Send any saved broadcasts to the new app
            globalThis.services.get('broadcast').sendSavedBroadcastsTo(uuid);

            // If `window-active` is set (meaning the window is focused), focus the window one more time
            // this is to ensure that the iframe is `definitely` focused and can receive keyboard events (e.g. keydown)
            if($(process.references.el_win).hasClass('window-active')){
                $(process.references.el_win).focusWindow();
            }
        });
    }

    process.chstatus(PROCESS_RUNNING);

    $(el).on('remove', () => {
        const svc_process = globalThis.services.get('process');
        svc_process.unregister(process.uuid);
    });

    // end the transaction
    if(transaction)
        transaction.end();


    return process;
}

export default launch_app;
