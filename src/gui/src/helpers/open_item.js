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

import UIWindow from '../UI/UIWindow.js';
import UIAlert from '../UI/UIAlert.js';
import i18n from '../i18n/i18n.js';
import launch_app from "./launch_app.js";
import path from '../lib/path.js';
import item_icon from './item_icon.js';

const open_item = async function(options){
    let el_item = options.item;
    const $el_parent_window = $(el_item).closest('.window');
    const parent_win_id = $($el_parent_window).attr('data-id');
    const is_dir = $(el_item).attr('data-is_dir') === '1' ? true : false;
    const uid = $(el_item).attr('data-shortcut_to') === '' ? $(el_item).attr('data-uid') : $(el_item).attr('data-shortcut_to');
    const item_path = $(el_item).attr('data-shortcut_to_path') === '' ? $(el_item).attr('data-path') : $(el_item).attr('data-shortcut_to_path');
    const is_shortcut = $(el_item).attr('data-is_shortcut') === '1';
    const shortcut_to_path = $(el_item).attr('data-shortcut_to_path');
    const associated_app_name = $(el_item).attr('data-associated_app_name');
    const file_uid = $(el_item).attr('data-uid');
    
    //----------------------------------------------------------------
    // Is this a shortcut whose source is perma-deleted?
    //----------------------------------------------------------------
    if(is_shortcut && shortcut_to_path === ''){
        UIAlert(`This shortcut can't be opened because its source has been deleted.`)
    }
    //----------------------------------------------------------------
    // Is this a shortcut whose source is trashed?
    //----------------------------------------------------------------
    else if(is_shortcut && shortcut_to_path.startsWith(window.trash_path + '/')){
        UIAlert(`This shortcut can't be opened because its source has been deleted.`)
    }
    //----------------------------------------------------------------
    // Is this a trashed file?
    //----------------------------------------------------------------
    else if(item_path.startsWith(window.trash_path + '/')){
        UIAlert(`This item can't be opened because it's in the trash. To use this item, first drag it out of the Trash.`)
    }
    //----------------------------------------------------------------
    // Is this a file (no dir) on a SaveFileDialog?
    //----------------------------------------------------------------
    else if($el_parent_window.attr('data-is_saveFileDialog') === 'true' && !is_dir){
        $el_parent_window.find('.savefiledialog-filename').val($(el_item).attr('data-name'));
        $el_parent_window.find('.savefiledialog-save-btn').trigger('click');
    }
    //----------------------------------------------------------------
    // Is this a file (no dir) on an OpenFileDialog?
    //----------------------------------------------------------------
    else if($el_parent_window.attr('data-is_openFileDialog') === 'true' && !is_dir){
        $el_parent_window.find('.window-disable-mask, .busy-indicator').show();
        let busy_init_ts = Date.now();
        try{    
            let filedialog_parent_uid = $el_parent_window.attr('data-parent_uuid');
            let $filedialog_parent_app_window = $(`.window[data-element_uuid="${filedialog_parent_uid}"]`);
            let parent_window_app_uid = $filedialog_parent_app_window.attr('data-app_uuid');
            const initiating_app_uuid = $el_parent_window.attr('data-initiating_app_uuid');

            let res = await puter.fs.sign(window.host_app_uid ?? parent_window_app_uid, {uid: uid, action: 'write'});
            res = res.items;
            // todo split is buggy because there might be a slash in the filename
            res.path = window.privacy_aware_path(item_path);
            const parent_uuid = $el_parent_window.attr('data-parent_uuid');
            const return_to_parent_window = $el_parent_window.attr('data-return_to_parent_window') === 'true';
            if(return_to_parent_window){
                window.opener.postMessage({
                    msg: "fileOpenPicked", 
                    original_msg_id: $el_parent_window.attr('data-iframe_msg_uid'), 
                    items: Array.isArray(res) ? [...res] : [res],
                    // LEGACY SUPPORT, remove this in the future when Polotno uses the new SDK
                    // this is literally put in here to support Polotno's legacy code
                    ...(!Array.isArray(res) && res)    
                }, '*');

                window.close();
            }
            else if(parent_uuid){
                // send event to iframe
                const target_iframe = $(`.window[data-element_uuid="${parent_uuid}"]`).find('.window-app-iframe').get(0);
                if(target_iframe){
                    let retobj = {
                        msg: "fileOpenPicked", 
                        original_msg_id: $el_parent_window.attr('data-iframe_msg_uid'), 
                        items: Array.isArray(res) ? [...res] : [res],
                        // LEGACY SUPPORT, remove this in the future when Polotno uses the new SDK
                        // this is literally put in here to support Polotno's legacy code
                        ...(!Array.isArray(res) && res)    
                    };
                    target_iframe.contentWindow.postMessage(retobj, '*');
                }

                // focus iframe
                $(target_iframe).get(0)?.focus({preventScroll:true});
              
                // send file_opened event
                const file_opened_event = new CustomEvent('file_opened', {detail: res});

                // dispatch event to parent window
                $(`.window[data-element_uuid="${parent_uuid}"]`).get(0)?.dispatchEvent(file_opened_event);
            }
        }catch(e){
            console.log(e);
        }
        // done
        let busy_duration = (Date.now() - busy_init_ts);
        if( busy_duration >= window.busy_indicator_hide_delay){
            $el_parent_window.close();   
        }else{
            setTimeout(() => {
                // close this dialog
                $el_parent_window.close();  
            }, Math.abs(window.busy_indicator_hide_delay - busy_duration));
        }
    }
    //----------------------------------------------------------------
    // Does the user have a preference for this file type?
    //----------------------------------------------------------------
    else if(!associated_app_name && !is_dir && window.user_preferences[`default_apps${path.extname(item_path).toLowerCase()}`]) {
        launch_app({
            name: window.user_preferences[`default_apps${path.extname(item_path).toLowerCase()}`],
            file_path: item_path,
            window_title: path.basename(item_path),
            maximized: options.maximized,
            file_uid: file_uid,
        });
    }
    //----------------------------------------------------------------
    // Is there an app associated with this item?
    //----------------------------------------------------------------
    else if(associated_app_name !== ''){
        launch_app({
            name: associated_app_name,
        })
    }
    //----------------------------------------------------------------
    // Dir with no open windows: create a new window
    //----------------------------------------------------------------
    else if(is_dir && ($el_parent_window.length === 0 || options.new_window)){
        UIWindow({
            path: item_path,
            title: path.basename(item_path),
            icon: await item_icon({is_dir: true, path: item_path}),
            uid: $(el_item).attr('data-uid'),
            is_dir: is_dir,
            app: 'explorer',
            top: options.maximized ? 0 : undefined,
            left: options.maximized ? 0 : undefined,
            height: options.maximized ? `calc(100% - ${window.taskbar_height + window.toolbar_height + 1}px)` : undefined,
            width: options.maximized ? `100%` : undefined,
        });
    }
    //----------------------------------------------------------------
    // Dir with an open window: change the path of the open window
    //----------------------------------------------------------------
    else if($el_parent_window.length > 0 && is_dir){
        window.window_nav_history[parent_win_id] = window.window_nav_history[parent_win_id].slice(0, window.window_nav_history_current_position[parent_win_id]+1);
        window.window_nav_history[parent_win_id].push(item_path);
        window.window_nav_history_current_position[parent_win_id]++;

        window.update_window_path($el_parent_window, item_path);
    }
    //----------------------------------------------------------------
    // all other cases: try to open using an app
    //----------------------------------------------------------------
    else{
        const fspath = item_path.toLowerCase();
        const fsuid = uid.toLowerCase();
        let open_item_meta;

        // get all info needed to open an item
        try{
            open_item_meta = await $.ajax({
                url: window.api_origin + "/open_item",
                type: 'POST',
                contentType: "application/json",
                data: JSON.stringify({
                    uid: fsuid ?? undefined,
                    path: fspath ?? undefined,
                }),
                headers: {
                    "Authorization": "Bearer "+window.auth_token
                },
                statusCode: {
                    401: function () {
                        window.logout();
                    },
                },
            });
        }catch(err){
            // Ignored
        }

        // get a list of suggested apps for this file type.
        let suggested_apps = open_item_meta?.suggested_apps ?? await window.suggest_apps_for_fsentry({uid: fsuid, path: fspath});
        
        //---------------------------------------------
        // No suitable apps, ask if user would like to
        // download
        //---------------------------------------------
        if(suggested_apps.length === 0){
            //---------------------------------------------
            // If .zip file, unzip it
            //---------------------------------------------
            if(path.extname(item_path) === '.zip'){
                window.unzipItem(item_path);
                return;
            }
            const alert_resp = await UIAlert(
                    'Found no suitable apps to open this file with. Would you like to download it instead?',
                    [
                    {
                        label: i18n('download_file'),
                        value: 'download_file',
                        type: 'primary',

                    },
                    {
                        label: i18n('cancel')
                    }
                ])
            if(alert_resp === 'download_file'){
                window.trigger_download([item_path]);
            }
            return;
        }
        //---------------------------------------------
        // First suggested app is default app to open this item
        //---------------------------------------------
        else{
            launch_app({
                name: suggested_apps[0].name, 
                token: open_item_meta.token,
                file_path: item_path,
                app_obj: suggested_apps[0],
                window_title: path.basename(item_path),
                file_uid: fsuid,
                maximized: options.maximized,
                file_signature: open_item_meta.signature,
            });
        }
    }    
}

export default open_item;