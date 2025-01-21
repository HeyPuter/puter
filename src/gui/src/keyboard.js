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

import UIAlert from './UI/UIAlert.js';
import UIWindowSearch from './UI/UIWindowSearch.js';
import launch_app from './helpers/launch_app.js';
import open_item from './helpers/open_item.js';
import determine_active_container_parent from './helpers/determine_active_container_parent.js';

$(document).bind('keydown', async function(e){
    const focused_el = document.activeElement;
    //-----------------------------------------------------------------------------
    // Search
    // ctrl/command + f, will open UIWindowSearch
    //-----------------------------------------------------------------------------
    if((e.ctrlKey || e.metaKey) && e.which === 70 && !$(focused_el).is('input') && !$(focused_el).is('textarea')){
        e.preventDefault();
        e.stopPropagation();    
        UIWindowSearch();
        return false;
    }

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
                window.select_ctxmenu_item(selected_item);
                return false;
            }
            // if no item is selected and up arrow is pressed, select the last item
            else if($('.context-menu-active .context-menu-item-active').length === 0 && (e.which === 38)){
                let selected_item = $('.context-menu .context-menu-item').get($('.context-menu .context-menu-item').length - 1);
                window.select_ctxmenu_item(selected_item);
                return false;
            }
            // if an item is selected and down arrow is pressed, select the next enabled item
            else if($('.context-menu-active .context-menu-item-active').length > 0 && (e.which === 40)){
                let selected_item = $('.context-menu-active .context-menu-item-active').get(0);
                let selected_item_index = $('.context-menu-active .context-menu-item').index(selected_item);
                let new_selected_item_index = selected_item_index + 1;
                let new_selected_item = $('.context-menu-active .context-menu-item').get(new_selected_item_index);
                while($(new_selected_item).hasClass('context-menu-item-disabled') || $(new_selected_item).hasClass('context-menu-divider')){
                    new_selected_item_index = new_selected_item_index + 1;
                    new_selected_item = $('.context-menu-active .context-menu-item').get(new_selected_item_index);
                }
                window.select_ctxmenu_item(new_selected_item);
                return false;
            }
            // if an item is selected and up arrow is pressed, select the previous enabled item
            else if($('.context-menu-active .context-menu-item-active').length > 0 && (e.which === 38)){
                let selected_item = $('.context-menu-active .context-menu-item-active').get(0);
                let selected_item_index = $('.context-menu-active .context-menu-item').index(selected_item);
                let new_selected_item_index = selected_item_index - 1;
                let new_selected_item = $('.context-menu-active .context-menu-item').get(new_selected_item_index);
                while($(new_selected_item).hasClass('context-menu-item-disabled') || $(new_selected_item).hasClass('context-menu-divider')){
                    new_selected_item_index = new_selected_item_index - 1;
                    new_selected_item = $('.context-menu-active .context-menu-item').get(new_selected_item_index);
                }
                window.select_ctxmenu_item(new_selected_item);
                return false;
            }
            // if right arrow is pressed, open the submenu by triggering a mouseover event
            else if($('.context-menu-active .context-menu-item-active').length > 0 && e.which === 39){
                const selected_item = $('.context-menu-active .context-menu-item-active').get(0);
                $(selected_item).trigger('mouseover', {keyboard: true});
                // if the submenu is open, select the first item in the submenu
                if($(selected_item).hasClass('context-menu-item-submenu') === true){
                    $(selected_item).removeClass('context-menu-item-active');
                    $(selected_item).addClass('context-menu-item-active-blurred');
                    window.select_ctxmenu_item($('.context-menu[data-is-submenu="true"] .context-menu-item').get(0));
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
                $(selected_item).removeClass('has-open-context-menu-submenu');
                $(selected_item).addClass('context-menu-item-active');

                return false;
            }
            // if enter is pressed, trigger a click event on the selected item
            else if($('.context-menu-active .context-menu-item-active').length > 0 && (e.which === 13)){
                let selected_item = $('.context-menu-active .context-menu-item-active').get(0);
                $(selected_item).trigger('click', {keyboard: true});
                return false;
            }
        }
        // ----------------------------------------------
        // Navigate items in the active item container
        // ----------------------------------------------
        else if(!$(focused_el).is('input') && !$(focused_el).is('textarea') && (e.which === 37 || e.which === 38 || e.which === 39 || e.which === 40)){
            let item_width = 110, item_height = 110, selected_item;
            // select first item in container if none is selected
            if($(window.active_item_container).find('.item-selected').length === 0){
                selected_item = $(window.active_item_container).find('.item').get(0);
                window.active_element = selected_item;
                $(window.active_item_container).find('.item-selected').removeClass('item-selected');
                $(selected_item).addClass('item-selected');
                return false;
            }
            // if Shift key is pressed and ONE item is already selected, pick that item
            else if($(window.active_item_container).find('.item-selected').length === 1 && e.shiftKey){
                selected_item = $(window.active_item_container).find('.item-selected').get(0);
            }
            // if Shift key is pressed and MORE THAN ONE item is selected, pick the latest active item
            else if($(window.active_item_container).find('.item-selected').length > 1 && e.shiftKey){
                selected_item = $(window.active_element).hasClass('item') ? window.active_element : $(window.active_element).closest('.item').get(0);
            }
            // otherwise if an item is selected, pick that item
            else if($(window.active_item_container).find('.item-selected').length === 1){
                selected_item = $(window.active_item_container).find('.item-selected').get(0);
            }
            else{
                selected_item = $(window.active_element).hasClass('item') ? window.active_element : $(window.active_element).closest('.item').get(0);
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
                if($(elem_at_next_pos).hasClass('item') && $(elem_at_next_pos).closest('.item-container').is(window.active_item_container)){
                    next_item = elem_at_next_pos;
                    break;
                }
            }

            if(next_item){
                selected_item = next_item;
                window.active_element = next_item;
                // if ctrl or meta key is not pressed, unselect all items
                if(!e.shiftKey){
                    $(window.active_item_container).find('.item').removeClass('item-selected');
                }
                $(next_item).addClass('item-selected');
                window.latest_selected_item = next_item;
                // scroll to the selected item only if this was a down or up move
                if(e.which === 38 || e.which === 40)
                    next_item.scrollIntoView(false);
            }
        }
        // ----------------------------------------------
        // Navigate search results in the search window
        // ----------------------------------------------
        else if($('.window-search').length > 0){
            let selected_item = $('.window-search .search-result-active').get(0);
            let selected_item_index = selected_item ? $('.window-search .search-result').index(selected_item) : -1;
            let new_selected_item_index = selected_item_index;
            let new_selected_item;

            // if up arrow is pressed
            if(e.which === 38){
                new_selected_item_index = selected_item_index - 1;
                if(new_selected_item_index < 0)
                    new_selected_item_index = $('.window-search .search-result').length - 1;
            }
            // if down arrow is pressed
            else if(e.which === 40){
                new_selected_item_index = selected_item_index + 1;
                if(new_selected_item_index >= $('.window-search .search-result').length)
                    new_selected_item_index = 0;
            }
            new_selected_item = $('.window-search .search-result').get(new_selected_item_index);
            $(selected_item).removeClass('search-result-active');
            $(new_selected_item).addClass('search-result-active');
            new_selected_item.scrollIntoView(false);
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
    // if the Esc key is pressed on a Search Window, close the Search Window
    //-----------------------------------------------------------------------
    else if( e.which === 27 && $('.window-search').length > 0){
        $('.window-search').close();
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
        let $selected_items = $(window.active_element).closest(`.item-container`).find(`.item-selected`);
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
                    await window.delete_item(element);
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
        let $selected_items = $(window.active_element).closest(`.item-container`).find(`.item-selected[data-path^="${window.trash_path + '/'}"]`);
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
                    await window.delete_item(element);
                }
                const trash = await puter.fs.stat(window.trash_path);
                if(window.socket){
                    window.socket.emit('trash.is_empty', {is_empty: trash.is_empty});
                }

                if(trash.is_empty){
                    $(`[data-app="trash"]`).find('.taskbar-icon > img').attr('src', window.icons['trash.svg']);
                    $(`.item[data-path="${html_encode(window.trash_path)}" i]`).find('.item-icon > img').attr('src', window.icons['trash.svg']);
                    $(`.window[data-path="${html_encode(window.trash_path)}"]`).find('.window-head-icon').attr('src', window.icons['trash.svg']);
                }
            }
        }
        // regular delete?
        else{
            $selected_items = $(window.active_element).closest('.item-container').find('.item-selected');
            if($selected_items.length > 0){
                // Only delete the items if we're not renaming one.
                if ($selected_items.children('.item-name-editor-active').length === 0) {
                    window.move_items($selected_items, window.trash_path);
                }
            }
        }
        return false;
    }

    //-----------------------------------------------------------------------
    // A letter or number is pressed and there is no context menu open: search items by name
    //-----------------------------------------------------------------------
    if(!e.ctrlKey && !e.metaKey && !$(focused_el).is('input') && !$(focused_el).is('textarea') && $('.context-menu').length === 0){
        if(window.keypress_item_seach_term !== '')
            clearTimeout(window.keypress_item_seach_buffer_timeout);

        window.keypress_item_seach_buffer_timeout = setTimeout(()=>{
            window.keypress_item_seach_term = '';
        }, 700);

        window.keypress_item_seach_term += e.key.toLocaleLowerCase();

        let matches= [];
        const selected_items = $(window.active_item_container).find(`.item-selected`).not('.item-disabled').first();

        // if one item is selected and the selected item matches the search term, don't continue search and select this item again
        if(selected_items.length === 1 && $(selected_items).attr('data-name').toLowerCase().startsWith(window.keypress_item_seach_term)){
            return false;
        }

        // search for matches
        let haystack = $(window.active_item_container).find(`.item`).not('.item-disabled');
        for(let j=0; j < haystack.length; j++){
            if($(haystack[j]).attr('data-name').toLowerCase().startsWith(window.keypress_item_seach_term)){
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
            $(window.active_item_container).find(`.item-selected`).removeClass('item-selected');
            // select matching item
            $(matches[0]).not('.item-disabled').addClass('item-selected');
            matches[0].scrollIntoView(false);
            window.update_explorer_footer_selected_items_count($(window.active_element).closest('.window'));
        }

        return false;
    }
    //-----------------------------------------------------------------------
    // A letter or number is pressed and there is a context menu open: search items by name
    //-----------------------------------------------------------------------
    else if(!e.ctrlKey && !e.metaKey && !$(focused_el).is('input') && !$(focused_el).is('textarea') && $('.context-menu').length > 0){
        if(window.keypress_item_seach_term !== '')
            clearTimeout(window.keypress_item_seach_buffer_timeout);

        window.keypress_item_seach_buffer_timeout = setTimeout(()=>{
            window.keypress_item_seach_term = '';
        }, 700);

        window.keypress_item_seach_term += e.key.toLocaleLowerCase();

        let matches= [];
        const selected_items = $('.context-menu').find(`.context-menu-item-active`).first();

        // if one item is selected and the selected item matches the search term, don't continue search and select this item again
        if(selected_items.length === 1 && $(selected_items).text().toLowerCase().startsWith(window.keypress_item_seach_term)){
            return false;
        }

        // search for matches
        let haystack = $('.context-menu-active').find(`.context-menu-item > .contextmenu-label`);
        for(let j=0; j < haystack.length; j++){
            if($(haystack[j]).text().toLowerCase().startsWith(window.keypress_item_seach_term)){
                matches.push(haystack[j].closest('.context-menu-item'));
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
            // update_explorer_footer_selected_items_count($(window.active_element).closest('.window'));
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
        let $parent_container = $(window.active_element).closest('.item-container');
        if($parent_container.length === 0)
            $parent_container = $(window.active_element).find('.item-container');

        if($parent_container.attr('data-multiselectable') === 'false')
            return false;

        if($parent_container){
            $($parent_container).find('.item').not('.item-disabled').addClass('item-selected');
            window.update_explorer_footer_selected_items_count($parent_container.closest('.window'));
        }

        return false;
    }
    //-----------------------------------------------------------------------------
    // Close Window
    // ctrl + w, will close the active window
    //-----------------------------------------------------------------------------
    if(e.ctrlKey && e.which === 87){
        let $parent_window = $(window.active_element).closest('.window');
        if($parent_window.length === 0)
            $parent_window = $(window.active_element).find('.window');


        if($parent_window !== null){
            $($parent_window).close();
        }
    }

    //-----------------------------------------------------------------------------
    // Copy
    // ctrl/command + c, will copy selected items on the active element to the clipboard
    //-----------------------------------------------------------------------------
    if((e.ctrlKey || e.metaKey) && e.which === 67 &&
        $(window.mouseover_window).attr('data-is_dir') !== 'false' &&
        $(window.mouseover_window).attr('data-path') !== window.trash_path &&
        !$(focused_el).is('input') &&
        !$(focused_el).is('textarea')){
        let $selected_items;

        let parent_container = $(window.active_element).closest('.item-container');
        if(parent_container.length === 0)
            parent_container = $(window.active_element).find('.item-container');

        if(parent_container !== null){
            $selected_items = $(parent_container).find('.item-selected');
            if($selected_items.length > 0){
                window.clipboard = [];
                window.clipboard_op = 'copy';
                $selected_items.each(function() {
                    // error if trash is being copied
                    if($(this).attr('data-path') === window.trash_path){
                        return;
                    }
                    // add to clipboard
                    window.clipboard.push({path: $(this).attr('data-path'), uid: $(this).attr('data-uid'), metadata: $(this).attr('data-metadata')});
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
        let parent_container = $(window.active_element).closest('.item-container');
        if(parent_container.length === 0)
            parent_container = $(window.active_element).find('.item-container');

        if(parent_container !== null){
            $selected_items = $(parent_container).find('.item-selected');
            if($selected_items.length > 0){
                window.clipboard = [];
                window.clipboard_op = 'move';
                $selected_items.each(function() {
                    window.clipboard.push($(this).attr('data-path'));
                })
            }
        }
        return false;
    }
    //-----------------------------------------------------------------------
    // Enter key on a search window result
    //-----------------------------------------------------------------------
    if(e.which === 13 && $('.window-search').length > 0
        // prevent firing twice, because this will be fired on both keyup and keydown
        && e.type === 'keydown'){
        $('.window-search .search-result-active').trigger('click');

        return false;
    }
    //-----------------------------------------------------------------------
    // Open
    // Enter key on a selected item will open it
    //-----------------------------------------------------------------------
    if(e.which === 13 && !$(focused_el).is('input') && !$(focused_el).is('textarea') && (Date.now() - window.last_enter_pressed_to_rename_ts) >200
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
                $(".popover-launcher").remove();
                // taskbar item inactive
                $('.taskbar-item[data-name="Start"]').removeClass('has-open-popover');
            });

            return false;
        }
        // ---------------------------------------------
        // if this is a selected context menu item, open it
        // ---------------------------------------------
        else if($('.context-menu-active .context-menu-item-active').length > 0 && (e.which === 13)){
            let selected_item = $('.context-menu-active .context-menu-item-active').get(0);
            $(selected_item).removeClass('context-menu-item-active');
            $(selected_item).addClass('context-menu-item-active-blurred');
            $(selected_item).trigger('mouseover', {keyboard: true});
            $(selected_item).trigger('click', {keyboard: true});
            if($('.context-menu[data-is-submenu="true"]').length > 0){
                let selected_item = $('.context-menu[data-is-submenu="true"] .context-menu-item').get(0);
                window.select_ctxmenu_item(selected_item);
            }

            return false;
        }
        // ---------------------------------------------
        // if this is a selected item, open it
        // ---------------------------------------------
        else if(window.active_item_container){
            $selected_items = $(window.active_item_container).find('.item-selected');
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
        if(window.clipboard.length === 0)
            return;

        let parent_container = determine_active_container_parent();

        if(parent_container){
            target_el = parent_container;
            target_path = $(parent_container).attr('data-path');
            // don't allow pasting in Trash
            if((target_path === window.trash_path || target_path.startsWith(window.trash_path + '/')) && window.clipboard_op !== 'move')
                return;
            // execute clipboard operation
            if(window.clipboard_op === 'copy')
                window.copy_clipboard_items(target_path);
            else if(window.clipboard_op === 'move')
                window.move_clipboard_items(target_el, target_path);
        }
        return false;
    }
    //-----------------------------------------------------------------------------
    // Undo
    // ctrl/command + z, will undo last action
    //-----------------------------------------------------------------------------
    if((e.ctrlKey || e.metaKey) && e.which === 90){
        window.undo_last_action();
        return false;
    }
});