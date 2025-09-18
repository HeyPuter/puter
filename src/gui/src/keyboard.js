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
            // constants
            const max_rows = $('body').hasClass('device-desktop') ? 5 : 4; // number of columns in the grid
            const all_apps = $('.launch-popover .start-app-card:visible');
            const recents = $('.launch-popover .launch-apps-recent .start-app-card:visible');
            const recommended = $('.launch-popover .launch-apps-recommended .start-app-card:visible');
            const search = $('.launch-popover .launch-search');
            const selected_element = $('.launch-popover .start-app-card.launch-app-selected');

            // helper functions for grid navigation

            // get item at row/col in section (recents or recommended)
            function item(row, col, section) {
                let apps = (section === 'recents') ? recents : recommended;
                const idx = row * max_rows + (col - 1);
                if (idx < 0 || idx >= apps.length) return null;
                return apps.get(idx);
            }

            // get row/col of item in all_apps
            function coord(it) {
                if (!it || it.length === 0) return null;
                const index = all_apps.index(it);
                if (index < 0) return null;
                // row is 0-based; col is 1-based to match item(row,col)
                return { row: Math.floor(index / max_rows), col: (index % max_rows) + 1 };
            }

            // select an item
            function select(el) {
                // clear previous
                all_apps.removeClass('launch-app-selected');
                if (!el) return;
                // add to new
                $(el).addClass('launch-app-selected');
                // ensure visible
                if (el.scrollIntoView) {
                    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                }
            }

            // helpers for section-local positioning and row/column counts

            // number of rows in a given section
            function rows(section) {
                const len = (section === 'recents' ? recents : recommended).length;
                return Math.ceil(len / max_rows);
            }

            // number of columns in a given row of a section
            function columns(section, row) {
                const len = (section === 'recents' ? recents : recommended).length;
                const full_rows = Math.floor(len / max_rows);
                const remainder = len % max_rows;
                if (row < full_rows) return max_rows;
                if (row === full_rows) return remainder === 0 ? max_rows : remainder;
                return 0;
            }

            // get local row/col/index of element in section
            function coords_local(section, el) {
                const list = (section === 'recents' ? recents : recommended);
                const idx = list.index(el);
                if (idx < 0) return null;
                return { index: idx, row: Math.floor(idx / max_rows), col: (idx % max_rows) + 1 };
            }

            const selected = coord(selected_element);

            // states
            const search_focused = search.is(':focus');
            const selected_grid = (selected && selected_element.parent().hasClass('launch-apps-recent')) ? 'recents' : 'recommended';
            

            if (e.which === 38) { // up
                if (selected_element.length === 0) return false;
                if (selected_grid === 'recents') {
                    const pos = coords_local('recents', selected_element);
                    if (!pos) return false;
                    if (pos.row === 0) {
                        // move to search
                        search.focus();
                        all_apps.removeClass('launch-app-selected');
                    } else {
                        const targetCol = Math.min(pos.col, columns('recents', pos.row - 1));
                        select(item(pos.row - 1, targetCol, 'recents'));
                    }
                } else { // recommended
                    const pos = coords_local('recommended', selected_element);
                    if (!pos) return false;
                    if (pos.row === 0) {
                        if (recents.length > 0) {
                            const lastRow = rows('recents') - 1;
                            const targetCol = Math.min(pos.col, columns('recents', lastRow));
                            select(item(lastRow, targetCol, 'recents'));
                        } else {
                            // focus search if no recents exist
                            search.focus();
                            all_apps.removeClass('launch-app-selected');
                        }
                    } else {
                        const targetCol = Math.min(pos.col, columns('recommended', pos.row - 1));
                        select(item(pos.row - 1, targetCol, 'recommended'));
                    }
                }
            } else if (e.which === 40) { // down
                // select first item if none selected
                if (selected_element.length === 0) {
                    // unfocus search
                    search.blur();
                    if (recents.length > 0) {
                        select(item(0, 1, 'recents'));
                    } else if (recommended.length > 0) {
                        select(item(0, 1, 'recommended'));
                    }
                } else {
                    if (selected_grid === 'recents') {
                        const pos = coords_local('recents', selected_element);
                        if (!pos) return false;
                        const rc = rows('recents');
                        if (pos.row + 1 < rc) {
                            const tgt = Math.min(pos.col, columns('recents', pos.row + 1));
                            select(item(pos.row + 1, tgt, 'recents'));
                        } else if (recommended.length > 0) {
                            const tgt = Math.min(pos.col, columns('recommended', 0));
                            select(item(0, tgt, 'recommended'));
                        }
                    } else { // recommended
                        const pos = coords_local('recommended', selected_element);
                        if (!pos) return false;
                        const rc = rows('recommended');
                        if (pos.row + 1 < rc) {
                            const tgt = Math.min(pos.col, columns('recommended', pos.row + 1));
                            select(item(pos.row + 1, tgt, 'recommended'));
                        }
                    }
                }
            } else if (e.which === 37) { // left
                if (selected_element.length === 0) return false;
                const pos = coords_local(selected_grid, selected_element);
                if (!pos) return false;
                const count = columns(selected_grid, pos.row);
                const next = pos.col > 1 ? pos.col - 1 : count;
                select(item(pos.row, next, selected_grid));
            } else if (e.which === 39) { // right
                if (selected_element.length === 0) return false;
                const pos = coords_local(selected_grid, selected_element);
                if (!pos) return false;
                const count = columns(selected_grid, pos.row);
                const next = pos.col < count ? pos.col + 1 : 1;
                select(item(pos.row, next, selected_grid));
            }
            return false; 
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
        else if(!$(focused_el).is('input, textarea') && [37,38,39,40].includes(e.which)){
            function getActiveItem(){
                let selected = $(window.active_item_container).find('.item-selected');
                if (selected.length === 1){
                    return selected.get(0);
                }
                if (selected.length > 1 && window.latest_selected_item){
                    return window.latest_selected_item;
                }
                if (window.active_element && $(window.active_element).hasClass('item')){
                    return window.active_element;
                }
                return $(window.active_item_container).find('.item').get(0);
            }

            function findNeighbor(current, direction) {
                const ox = current.el.getBoundingClientRect().left;
                const oy = current.el.getBoundingClientRect().top;

                // NOTE: using center points is more natural than origin points but requires items to take empty space like margin in order to accurately find center points.
                // const cx = current.centerX;
                // const cy = current.centerY;

                const isVertical = direction === 'up' || direction === 'down';
                const axisThreshold = 30; // allowable offset on perpendicular axis

                let candidates = grid.filter(i => i !== current);
                candidates = candidates.filter(i => {
                    const irect = i.el.getBoundingClientRect();
                    if (isVertical) {
                        return Math.abs(i.left - ox) < axisThreshold &&
                            (direction === 'up' ? irect.top < oy : irect.top > oy);
                    } else {
                        return Math.abs(i.top - oy) < axisThreshold &&
                            (direction === 'left' ? irect.left < ox : irect.left > ox);
                    }
                });

                // allows wrapping
                if (candidates.length === 0) {
                    candidates = grid.filter(i => i !== current);
                    if (isVertical) {
                        candidates = candidates.filter(i => Math.abs(i.left - ox) < axisThreshold);
                        candidates.sort((a, b) => direction === 'up'
                            ? b.top - a.top
                            : a.top - b.top);
                    } else {
                        candidates = candidates.filter(i => Math.abs(i.top - oy) < axisThreshold);
                        candidates.sort((a, b) => direction === 'left'
                            ? b.left - a.left
                            : a.left - b.left);
                    }
                    return candidates[0];
                }
                // Sort remaining by Euclidean distance
                candidates.sort((a, b) => {
                    const da = Math.hypot(a.left - ox, a.top - oy);
                    const db = Math.hypot(b.left - ox, b.top - oy);
                    
                    if (da !== db) return da - db;

                    // vertically prefer item with greater origin Y
                    if (isVertical) return a.top - b.top;

                    // horizontally prefer item with greater origin X
                    return a.left - b.left;
                });
                return candidates[0];
            }

            // disable default crtl/meta behaviour from browsers
            if (e.ctrlKey || e.metaKey){
                e.preventDefault();
                e.stopPropagation();
            }

            // select first item if none are already selected
            const selected = $(window.active_item_container).find('.item-selected');
            if (selected.length === 0){
                const first = $(window.active_item_container).find('.item').get(0);
                if (first) {
                    $(first).addClass('item-selected');
                    window.active_element = first;
                    window.latest_selected_item = first;
                    first.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                }
                return;
            }

            // virtual grid layout to determine item layout and next items
            const items = Array.from($(window.active_item_container).find('.item'));
            const grid = items.map(item => {
                const rect = item.getBoundingClientRect();
                return {
                    el: item,
                    top: rect.top,
                    left: rect.left,
                    centerX: rect.left + rect.width / 2,
                    centerY: rect.top + rect.height / 2,
                };
            });

            if (!selected) return;
            const key = e.which;
            const dir = {37:'left', 38:'up', 39:'right', 40:'down'}[key];
            if (!dir) return;

            const currentEl = getActiveItem();
            const current = grid.find(i => i.el === currentEl);
            const next = findNeighbor(current, dir);

            // apply new selection(s)
            if (next) {
                window.active_element = next.el;
                window.latest_selected_item = next.el;

                if (!e.shiftKey){
                    // Normal navigation — clear previous selection
                    $(window.active_item_container).find('.item').removeClass('item-selected');
                    $(next.el).addClass('item-selected');
                } else{
                    // Shift + arrow: add to selection
                    $(next.el).addClass('item-selected');
                }
                next.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
                const trash = await puter.fs.stat({path: window.trash_path, consistency: 'eventual'});
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