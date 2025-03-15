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
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  
 * 
 * See the GNU Affero General Public License for more details.
 * License: https://www.gnu.org/licenses/
 */

import UIWindow from './UIWindow.js';
import UIContextMenu from './UIContextMenu.js'; // ✅ Importing context menu functionality
import path from "../lib/path.js";
import UIAlert from './UIAlert.js';
import launch_app from '../helpers/launch_app.js';
import item_icon from '../helpers/item_icon.js';

async function UIWindowSearch(options) {
    let h = '';

    // 🏷️ Search Input Field UI
    h += `<div class="search-input-wrapper">`;
        h += `<input type="text" class="search-input" placeholder="Search" 
                style="background-image:url('${window.icons['magnifier-outline.svg']}');">`;
    h += `</div>`;

    // 🏷️ Search Results UI
    h += `<div class="search-results" style="overflow-y: auto; max-height: 300px;">`;

    // 📌 Creating the search window
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
        width: 500,
        dominant: true,
        window_css: { height: 'initial', padding: '0' },
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

    // 🛑 Debounce function to prevent excessive API calls when typing
    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                func.apply(this, args);
            }, wait);
        };
    }

    let isSearching = false;

    // 🔍 Handles search functionality with API calls
    const performSearch = debounce(async function(searchInput, resultsContainer) {
        if (searchInput.val() === '') {
            resultsContainer.html('');
            resultsContainer.hide();
            return;
        }

        if (!isSearching) {
            isSearching = true;
        }

        try {
            let results = await fetch(window.api_origin + '/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${puter.authToken}`
                },
                body: JSON.stringify({ text: searchInput.val() })
            });

            results = await results.json();

            results.length === 0 ? resultsContainer.hide() : resultsContainer.show();

            let h = '';

            // 📝 Loop through search results and display them
            for(let i = 0; i < results.length; i++){
                const result = results[i];
                h += `<div 
                        class="search-result"
                        data-path="${html_encode(result.path)}" 
                        data-uid="${html_encode(result.uid)}"
                        data-is_dir="${html_encode(result.is_dir)}"
                    >`;
                h += `<img src="${(await item_icon(result)).image}" 
                         style="width: 20px; height: 20px; margin-right: 6px;">`;
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
    }, 300);

    // 🖱️ Event listener for typing inside search bar
    $(el_window).find('.search-input').on('input', function(e) {
        performSearch($(this), $(el_window).find('.search-results'));
    });
}

// 🆕 Right-click context menu for search results
$(document).on('contextmenu', '.search-result', async function(e){
    e.preventDefault(); // Prevents browser’s default context menu

    const fspath = $(this).data('path');
    const fsuid = $(this).data('uid');

    UIContextMenu({
        position: { top: e.clientY, left: e.clientX },
        items: [
            { html: '📂 Open File', onClick: () => openFile(fspath, fsuid) },
            { html: '📁 Open Containing Folder', onClick: () => openContainingFolder(fspath) }
        ]
    });
});

// ✅ Left-click event: Opens file/folder normally
$(document).on('click', '.search-result', async function(e){
    const fspath = $(this).data('path');
    const fsuid = $(this).data('uid');
    const is_dir = $(this).attr('data-is_dir') === 'true' || $(this).data('is_dir') === '1';

    is_dir ? openContainingFolder(fspath) : openFile(fspath, fsuid);
});

// 🏷️ Function to open a file
const openFile = async (filePath, fileUid) => {
    try {
        let open_item_meta = await $.ajax({
            url: window.api_origin + "/open_item",
            type: 'POST',
            contentType: "application/json",
            data: JSON.stringify({ uid: fileUid, path: filePath }),
            headers: { "Authorization": "Bearer "+window.auth_token }
        });

        let suggested_apps = open_item_meta?.suggested_apps ?? 
                            await window.suggest_apps_for_fsentry({uid: fileUid, path: filePath});

        if (suggested_apps.length === 0) {
            const alert_resp = await UIAlert(
                'No apps found to open this file. Download instead?',
                [{ label: 'Download File', value: 'download_file', type: 'primary' }, { label: 'Cancel' }]
            );
            if (alert_resp === 'download_file') {
                window.trigger_download([filePath]);
            }
            return;
        }

        launch_app({
            name: suggested_apps[0].name, 
            token: open_item_meta.token,
            file_path: filePath,
            app_obj: suggested_apps[0],
            window_title: path.basename(filePath),
            file_uid: fileUid,
            file_signature: open_item_meta.signature,
        });
    } catch (error) {
        console.error("Error opening file:", error);
    }
};

// 🏷️ Function to open containing folder
const openContainingFolder = async (filePath) => {
    UIWindow({
        path: path.dirname(filePath),
        title: path.basename(filePath),
        icon: await item_icon({ is_dir: true, path: filePath }),
        uid: `folder-${filePath}`,
        is_dir: true,
        app: 'explorer',
    });
};

export default UIWindowSearch;
