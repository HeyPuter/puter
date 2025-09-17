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

import path from '../lib/path.js';
import UIItem from '../UI/UIItem.js';
import item_icon from './item_icon.js';

const refresh_item_container = function(el_item_container, options){
    // start a transaction
    const transaction = new window.Transaction('refresh-item-container');
    transaction.start();

    options = options || {};

    let container_path =  $(el_item_container).attr('data-path');
    let el_window = $(el_item_container).closest('.window');
    let el_window_head_icon = $(el_window).find('.window-head-icon');
    const loading_spinner = $(el_item_container).find('.explorer-loading-spinner');
    const error_message = $(el_item_container).find('.explorer-error-message');
    const empty_message = $(el_item_container).find('.explorer-empty-message');

    if(options.fadeInItems)
        $(el_item_container).css('opacity', '0')

    // Hide the 'This folder is empty' message to avoid the flickering effect
    // if the folder is not empty.
    $(el_item_container).find('.explorer-empty-message').hide();

    // Hide the loading spinner to avoid the flickering effect if the folder
    // is already loaded.
    $(loading_spinner).hide();

    // Hide the error message in case it's visible
    $(error_message).hide();

    // current timestamp in milliseconds
    let start_ts = new Date().getTime();

    // A timeout that will show the loading spinner if the folder is not loaded
    // after 1000ms
    let loading_timeout = setTimeout(function(){
        // make sure the same folder is still loading
        if($(loading_spinner).closest('.item-container').attr('data-path') !== container_path)
            return;

        // show the loading spinner
        $(loading_spinner).show();
        setTimeout(function(){
            $(loading_spinner).find('.explorer-loading-spinner-msg').html('Taking a little longer than usual. Please wait...');
        }, 3000)
    }, 1000);

    // --------------------------------------------------------
    // Folder's configs and properties
    // --------------------------------------------------------
    puter.fs.stat(container_path, function(fsentry){
        if(el_window){
            $(el_window).attr('data-uid', fsentry.id);
            $(el_window).attr('data-sort_by', fsentry.sort_by ?? 'name');
            $(el_window).attr('data-sort_order', fsentry.sort_order ?? 'asc');
            $(el_window).attr('data-layout', fsentry.layout ?? 'icons');
            // data-name
            $(el_window).attr('data-name', html_encode(fsentry.name));
            // data-path
            $(el_window).attr('data-path', html_encode(container_path));
            $(el_window).find('.window-navbar-path-input').val(container_path);
            $(el_window).find('.window-navbar-path-input').attr('data-path', container_path);
        }
        $(el_item_container).attr('data-sort_by', fsentry.sort_by ?? 'name');
        $(el_item_container).attr('data-sort_order', fsentry.sort_order ?? 'asc');
        // update layout
        if(el_window && el_window.length > 0)
            window.update_window_layout(el_window, fsentry.layout);
        //
        if(fsentry.layout === 'details'){
            window.update_details_layout_sort_visuals(el_window, fsentry.sort_by, fsentry.sort_order);
        }
    });

    // is_directoryPicker
    let is_directoryPicker = $(el_window).attr('data-is_directoryPicker');
    is_directoryPicker = (is_directoryPicker === 'true' || is_directoryPicker === '1') ? true : false;

    // allowed_file_types
    let allowed_file_types = $(el_window).attr('data-allowed_file_types');

    // is_directoryPicker
    let is_openFileDialog = $(el_window).attr('data-is_openFileDialog');
    is_openFileDialog = (is_openFileDialog === 'true' || is_openFileDialog === '1') ? true : false;

    // remove all existing items
    $(el_item_container).find('.item').removeItems()

    // get items
    puter.fs.readdir({path: container_path, consistency: options.consistency ?? 'eventual'}).then((fsentries)=>{
        // Check if the same folder is still loading since el_item_container's
        // data-path might have changed by other operations while waiting for the response to this `readdir`.
        if($(el_item_container).attr('data-path') !== container_path)
            return;

        setTimeout(async function(){
            // clear loading timeout
            clearTimeout(loading_timeout);

            // hide loading spinner
            $(loading_spinner).hide();

            // if no items, show empty folder message
            if(fsentries.length === 0){
                $(el_item_container).find('.explorer-empty-message').show();
            }

            // trash icon
            if(container_path === window.trash_path && el_window_head_icon){
                if(fsentries.length > 0){
                    $(el_window_head_icon).attr('src', window.icons['trash-full.svg']);
                }else{
                    $(el_window_head_icon).attr('src', window.icons['trash.svg']);
                }
            }

            // add each item to window
            for (let index = 0; index < fsentries.length; index++) {
                const fsentry = fsentries[index];
                let is_disabled = false;

                // disable files if this is a showDirectoryPicker() window
                if(is_directoryPicker && !fsentry.is_dir)
                    is_disabled = true;

                // if this item is not allowed because of filetype restrictions, disable it
                if(!window.check_fsentry_against_allowed_file_types_string(fsentry, allowed_file_types))
                    is_disabled = true;

                // set visibility based on user preferences and whether file is hidden by default
                const is_hidden_file = fsentry.name.startsWith('.');
                let visible;
                if (!is_hidden_file){
                    visible = 'visible';
                }else if (window.user_preferences.show_hidden_files) {
                    visible = 'revealed';
                }else{
                    visible = 'hidden';
                }

                // metadata
                let metadata;
                if(fsentry.metadata !== ''){
                    try{
                        metadata = JSON.parse(fsentry.metadata);
                    }
                    catch(e){
                        // Ignored
                    }
                }

                const item_path = fsentry.path ?? path.join($(el_window).attr('data-path'), fsentry.name);
                // render any item but Trash/AppData
                if(item_path !== window.trash_path && item_path !== window.appdata_path){
                    // if this is trash, get original name from item metadata
                    fsentry.name = (metadata && metadata.original_name !== undefined) ? metadata.original_name : fsentry.name;
                    const position = window.desktop_item_positions[fsentry.uid] ?? undefined;
                    UIItem({
                        appendTo: el_item_container,
                        uid: fsentry.uid,
                        immutable: fsentry.immutable || fsentry.writable === false,
                        associated_app_name: fsentry.associated_app?.name,
                        path: item_path,
                        icon: await item_icon(fsentry),
                        name: (metadata && metadata.original_name !== undefined) ? metadata.original_name : fsentry.name,
                        is_dir: fsentry.is_dir,
                        multiselectable: !is_openFileDialog,
                        has_website: fsentry.has_website,
                        is_shared: fsentry.is_shared,
                        metadata: fsentry.metadata,
                        is_shortcut: fsentry.is_shortcut,
                        shortcut_to: fsentry.shortcut_to,
                        shortcut_to_path: fsentry.shortcut_to_path,
                        size: fsentry.size,
                        type: fsentry.type,
                        modified: fsentry.modified,
                        suggested_apps: fsentry.suggested_apps,
                        disabled: is_disabled,
                        visible: visible,
                        position: position,
                    });
                }
            }

            // if this is desktop, add Trash
            if($(el_item_container).hasClass('desktop')){
                try{
                    const trash = await puter.fs.stat(window.trash_path);
                    UIItem({
                        appendTo: el_item_container,
                        uid: trash.id,
                        immutable: trash.immutable,
                        path: window.trash_path,
                        icon: {image: (trash.is_empty ? window.icons['trash.svg'] : window.icons['trash-full.svg']), type: 'icon'},
                        name: trash.name,
                        is_dir: trash.is_dir,
                        sort_by: trash.sort_by,
                        type: trash.type,
                        is_trash: true,
                        sortable: false,
                    });
                    window.sort_items(el_item_container, $(el_item_container).attr('data-sort_by'), $(el_item_container).attr('data-sort_order'));
                }catch(e){
                    // Ignored
                }            
            }
            // sort items
            window.sort_items(
                el_item_container,
                $(el_item_container).attr('data-sort_by'),
                $(el_item_container).attr('data-sort_order')
            );

            if(options.fadeInItems) {
                $(el_item_container).animate({'opacity': '1'}, {
                    complete: () => {
                        // Call onComplete callback when fade-in animation is done
                        if(options.onComplete && typeof options.onComplete === 'function') {
                            options.onComplete();
                        }
                    }
                });
            } else {
                // If no fade-in animation, call onComplete immediately
                if(options.onComplete && typeof options.onComplete === 'function') {
                    options.onComplete();
                }
            }

            // update footer item count if this is an explorer window
            if(el_window)
                window.update_explorer_footer_item_count(el_window);

            // end the transaction
            transaction.end();
        },
        // This makes sure the loading spinner shows up if the request takes longer than 1 second 
        // and stay there for at least 1 second since the flickering is annoying
        (Date.now() - start_ts) > 1000 ? 1000 : 1)
    }).catch(e => {
        // end the transaction
        transaction.end();

        // clear loading timeout
        clearTimeout(loading_timeout);

        // hide other messages/indicators
        $(loading_spinner).hide();
        $(empty_message).hide();

        // show error message
        $(error_message).html('Failed to load directory' + html_encode((e && e.message ? ': ' + e.message : '')));
        $(error_message).show();

        // Call onComplete callback even in error case, since the "loading" is technically complete
        if(options.onComplete && typeof options.onComplete === 'function') {
            options.onComplete();
        }
    });
}    

export default refresh_item_container;