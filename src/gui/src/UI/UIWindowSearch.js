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
import path from "../lib/path.js"
import UIAlert from './UIAlert.js'
import launch_app from '../helpers/launch_app.js'
import item_icon from '../helpers/item_icon.js'

async function UIWindowSearch(options){
    let h = '';

    h += `<div class="search-input-wrapper">`;
        h += `<input type="text" class="search-input" placeholder="Search" style="background-image:url('${window.icons['magnifier-outline.svg']}');">`;
    h += `</div>`;
    h += `<div class="search-results" style="overflow-y: auto; max-height: 300px;">`;

    const el_window = await UIWindow({
        icon: null,
        single_instance: true,
        app: 'search',
        uid: null,
        is_dir: false,
        body_content: h,
        has_head: false,
        selectable_body: false,
        draggable_body: true,
        allow_context_menu: false,
        is_draggable: false,
        is_resizable: false,
        is_droppable: false,
        init_center: true,
        allow_native_ctxmenu: true,
        allow_user_select: true,
        window_class: 'window-search',
        backdrop: true,
        center: isMobile.phone,
        onAppend: function(el_window){
        },
        width: 500,
        dominant: true,

        window_css: {
            height: 'initial',
            padding: '0',
        },
        body_css: {
            width: 'initial',
            'max-height': 'calc(100vh - 200px)',
            'background-color': 'rgb(241 246 251)',
            'backdrop-filter': 'blur(3px)',
            'padding': '0',
            'height': 'initial',
            'overflow': 'hidden',
            'min-height': '65px',
            'padding-bottom': '10px',
        }    
    });

    $(el_window).find('.search-input').focus();

    // Debounce function to limit rate of API calls
    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                func.apply(context, args);
            }, wait);
        };
    }

    // State for managing loading indicator
    let isSearching = false;

    // Debounced search function
    const performSearch = debounce(async function(searchInput, resultsContainer) {
        // Don't search if input is empty
        if (searchInput.val() === '') {
            resultsContainer.html('');
            resultsContainer.hide();
            return;
        }

        // Set loading state
        if (!isSearching) {
            isSearching = true;
        }

        try {
            // Perform the search
            let results = await fetch(window.api_origin + '/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${puter.authToken}`
                },
                body: JSON.stringify({ text: searchInput.val() })
            });

            results = await results.json();

            // Hide results if there are none
            if(results.length === 0)
                resultsContainer.hide();
            else
                resultsContainer.show();

            // Build results HTML
            let h = '';

            for(let i = 0; i < results.length; i++){
                const result = results[i];
                h += `<div 
                        class="search-result"
                        data-path="${html_encode(result.path)}" 
                        data-uid="${html_encode(result.uid)}"
                        data-is_dir="${html_encode(result.is_dir)}"
                    >`;
                // icon
                h += `<img src="${(await item_icon(result)).image}" style="width: 20px; height: 20px; margin-right: 6px;">`;
                h += html_encode(result.name);
                h += `</div>`;
            }
            resultsContainer.html(h);
        } catch (error) {
            resultsContainer.html('<div class="search-error">Search failed. Please try again.</div>');
            console.error('Search error:', error);
        } finally {
            isSearching = false;
        }
    }, 300); // Wait 300ms after last keystroke before searching

    // Event binding
    $(el_window).find('.search-input').on('input', function(e) {
        const searchInput = $(this);
        const resultsContainer = $(el_window).find('.search-results');
        performSearch(searchInput, resultsContainer);
    });
}

$(document).on('click', '.search-result', async function(e){
    const fspath = $(this).data('path');
    const fsuid = $(this).data('uid');
    const is_dir = $(this).attr('data-is_dir') === 'true' || $(this).data('is_dir') === '1';
    let open_item_meta;

    if(is_dir){
        UIWindow({
            path: fspath,
            title: path.basename(fspath),
            icon: await item_icon({is_dir: true, path: fspath}),
            uid: fsuid,
            is_dir: is_dir,
            app: 'explorer',
            // top: options.maximized ? 0 : undefined,
            // left: options.maximized ? 0 : undefined,
            // height: options.maximized ? `calc(100% - ${window.taskbar_height + window.toolbar_height + 1}px)` : undefined,
            // width: options.maximized ? `100%` : undefined,
        });

        // close search window
        $(this).closest('.window').close();

        return;
    }

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
        if(path.extname(fspath) === '.zip'){
            window.unzipItem(fspath);
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
            window.trigger_download([fspath]);
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
            file_path: fspath,
            app_obj: suggested_apps[0],
            window_title: path.basename(fspath),
            file_uid: fsuid,
            // maximized: options.maximized,
            file_signature: open_item_meta.signature,
        });
    }


    // close
    $(this).closest('.window').close();
})

export default UIWindowSearch