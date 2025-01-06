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

const update_username_in_gui = function(new_username){
    // ------------------------------------------------------------
    // Update all item/window/... paths, with the new username
    // ------------------------------------------------------------
    $(':not([data-path=""]),:not([data-item-path=""])').each((i, el)=>{
        const $el = $(el);
        const attr_path = $el.attr('data-path');
        const attr_item_path = $el.attr('data-item-path');
        const attr_shortcut_to_path = $el.attr('data-shortcut_to_path');
        // data-path
        if(attr_path && attr_path !== 'null' && attr_path !== 'undefined'){
            // /[username]
            if(attr_path === '/' + window.user.username)
                $el.attr('data-path', '/' + new_username);
            // /[username]/...
            else if (attr_path.startsWith('/' + window.user.username + '/'))
                $el.attr('data-path',  attr_path.replace('/' + window.user.username + '/', '/' + new_username + '/'));

            // .window-navbar-path-dirname
            if($el.hasClass('window-navbar-path-dirname') && attr_path === '/' + window.user.username)
                $el.text(new_username)

            // .window-navbar-path-input value
            else if($el.hasClass('window-navbar-path-input')){
                // /[username]
                if(attr_path === '/' + window.user.username)
                    $el.val('/' + new_username);
                // /[username]/...
                else if (attr_path.startsWith('/' + window.user.username + '/'))
                    $el.val(attr_path.replace('/' + window.user.username + '/', '/' + new_username + '/'));
            }
        }
        // data-shortcut_to_path
        if(attr_shortcut_to_path && attr_shortcut_to_path !== '' && attr_shortcut_to_path !== 'null' && attr_shortcut_to_path !== 'undefined'){
            // home dir
            if(attr_shortcut_to_path === '/' + window.user.username)
                $el.attr('data-shortcut_to_path', '/' + new_username);
            // every other paths
            else if(attr_shortcut_to_path.startsWith('/' + window.user.username + '/'))
                $el.attr('data-shortcut_to_path', attr_shortcut_to_path.replace('/' + window.user.username + '/', '/' + new_username + '/'));
        }
        // data-item-path
        if(attr_item_path && attr_item_path !== 'null' && attr_item_path !== 'undefined'){
            // /[username]
            if(attr_item_path === '/' + window.user.username)
                $el.attr('data-item-path', '/' + new_username);
            // /[username]/...
            else if (attr_item_path.startsWith('/' + window.user.username + '/'))
                $el.attr('data-item-path',  attr_item_path.replace('/' + window.user.username + '/', '/' + new_username + '/'));
        }

        // any element with username class
        $('.username').text(new_username);
    })

    // todo update all window paths
    $('.window').each((i, el)=>{
    })

    window.desktop_path = '/' + new_username + '/Desktop';
    window.trash_path = '/' + new_username + '/Trash';
    window.appdata_path = '/' + new_username + '/AppData';
    window.docs_path = '/' + new_username + '/Documents';
    window.pictures_path = '/' + new_username + '/Pictures';
    window.videos_path = '/' + new_username + '/Videos';
    window.desktop_path = '/' + new_username + '/Desktop';
    window.public_path = '/' + new_username + '/Public';
    window.home_path = '/' + new_username;
}

export default update_username_in_gui;