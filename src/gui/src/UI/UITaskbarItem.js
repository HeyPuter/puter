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

import UIContextMenu from './UIContextMenu.js';
import path from '../lib/path.js';
import launch_app from "../helpers/launch_app.js"

let tray_item_id = 1;

function UITaskbarItem(options){
    let h = ``;
    tray_item_id++;
    options.sortable = options.sortable ?? true;
    options.open_windows_count = options.open_windows_count ?? 0;
    options.lock_keep_in_taskbar = options.lock_keep_in_taskbar ?? false;
    options.append_to_taskbar = options.append_to_taskbar ?? true;
    options.before_trash = options.before_trash ?? false;

    const element_id = window.global_element_id++;

    h += `<div  class = "taskbar-item ${options.sortable ? 'taskbar-item-sortable' : ''} disable-user-select"
                id = "taskbar-item-${tray_item_id}"
                data-taskbar-item-id = "${tray_item_id}"
                data-element-id = "${html_encode(element_id)}"
                data-name = "${html_encode(options.name)}"
                data-app = "${html_encode(options.app)}"
                data-keep-in-taskbar = "${html_encode(options.keep_in_taskbar ?? 'false')}"
                data-open-windows="${(options.open_windows_count)}"
                title = "${html_encode(options.name)}"
                style= "${options.style ? html_encode(options.style) : ''}"
            >`;
        let icon = options.icon ? options.icon : window.icons['app.svg'];
        if(options.app === 'explorer')
            icon = window.icons['folders.svg'];

        // taskbar icon
        h += `<div class="taskbar-icon">`;
            h += `<img src="${html_encode(icon)}" style="${options.group === 'apps' ? 'filter:none;' : ''}">`;
        h += `</div>`;

        // active indicator
        if(options.app !== 'apps')
            h += `<span class="active-taskbar-indicator"></span>`;
    h += `</div>`;

    if(options.append_to_taskbar) {
        if (options.before_trash){
            $('.taskbar-item[data-app="trash"]').before(h);
        }else{
            $('.taskbar').append(h);
        }
    }else{
        $('body').prepend(h);
    }

    const el_taskbar_item = document.querySelector(`#taskbar-item-${tray_item_id}`);

    // fade in the taskbar item
    $(el_taskbar_item).show(50);

    $(el_taskbar_item).on("click", function(e){
        e.preventDefault();
        e.stopPropagation();
        
        // if this is for the launcher popover, and it's mobile, and has-open-popover, close the popover
        if( $(el_taskbar_item).attr('data-name') === 'Start'
             && (isMobile.phone || isMobile.tablet) && $(el_taskbar_item).hasClass('has-open-popover')){
            $('.popover').remove();
            return;
        }

        // If this item has an open context menu, don't do anything
        if($(el_taskbar_item).hasClass('has-open-contextmenu'))
            return;

        el_taskbar_item.querySelector("img").animate(
            [
              { transform: 'translateY(0) scale(1)' },
              { transform: 'translateY(-5px) scale(1.2)' },
              { transform: 'translateY(0) scale(1)' }
            ],
            {
              duration: 300,
              easing: 'ease-out',
            }
          );   

        if(options.onClick === undefined || options.onClick(el_taskbar_item) === false){
            // re-show each window in this app group
            $(`.window[data-app="${options.app}"]`).showWindow();
        }
    })

    $(el_taskbar_item).on('contextmenu taphold', function(e){
        // seems like the only way to stop sortable is to destroy it
        if(options.sortable) {
            $('.taskbar').sortable('destroy');
        }

        e.preventDefault();
        e.stopPropagation();

        // If context menu is disabled on this item, return
        if(options.disable_context_menu)
            return;

        // don't allow context menu to open if it's already open
        if($(el_taskbar_item).hasClass('has-open-contextmenu'))
            return;

        const menu_items =[];
        const open_windows = parseInt($(el_taskbar_item).attr('data-open-windows'));        
        // -------------------------------------------
        // List of open windows belonging to this app
        // -------------------------------------------
        $(`.window[data-app="${options.app}"]`).each(function(){
            menu_items.push({
                html: $(this).find(`.window-head-title`).html(),
                val: $(this).attr('data-id'),
                onClick: function(e){
                    $(`.window[data-id="${e.value}"]`).showWindow();
                }
            })
        })
        // -------------------------------------------
        // divider
        // -------------------------------------------
        if(menu_items.length > 0)
            menu_items.push('-');
        //------------------------------------------
        // New Window
        //------------------------------------------
        if(options.app && options.app !== 'trash'){
            menu_items.push({
                html: 'New Window',
                val: $(this).attr('data-id'),
                onClick: function(){
                    // is trash?
                    launch_app({
                        name: options.app,
                        maximized: (isMobile.phone || isMobile.tablet),
                    })
                }
            })
        }
        //------------------------------------------
        // Open Trash
        //------------------------------------------
        else if(options.app && options.app === 'trash'){
            menu_items.push({
                html: 'Open Trash',
                val: $(this).attr('data-id'),
                onClick: function(){
                    launch_app({
                        name: options.app,
                        path: window.trash_path,
                        maximized: (isMobile.phone || isMobile.tablet),
                    })
                }
            })
        }
        //------------------------------------------
        // Empty Trash
        //------------------------------------------
        if(options.app && options.app === 'trash'){
            // divider
            menu_items.push('-');

            // Empty Trash menu item
            menu_items.push({
                html: i18n('empty_trash'),
                val: $(this).attr('data-id'),
                onClick: async function(){
                    window.empty_trash();
                }
            })
        }
        //------------------------------------------
        // Remove from Taskbar
        //------------------------------------------
        if(options.keep_in_taskbar && !options.lock_keep_in_taskbar){
            menu_items.push({
                html: i18n('remove_from_taskbar'),
                val: $(this).attr('data-id'),
                onClick: function(){
                    $(el_taskbar_item).attr('data-keep-in-taskbar', 'false');
                    if($(el_taskbar_item).attr('data-open-windows') === '0'){
                        window.remove_taskbar_item(el_taskbar_item);
                    }
                    window.update_taskbar();
                    options.keep_in_taskbar = false;
                }
            })
        }
        //------------------------------------------
        // Keep in Taskbar
        //------------------------------------------
        else if(!options.keep_in_taskbar){
            menu_items.push({
                html: i18n('keep_in_taskbar'),
                val: $(this).attr('data-id'),
                onClick: function(){
                    $(el_taskbar_item).attr('data-keep-in-taskbar', 'true');
                    window.update_taskbar();
                    options.keep_in_taskbar = true;
                }
            })  
        }

        if(open_windows > 0){
            // -------------------------------------------
            // divider
            // -------------------------------------------
            menu_items.push('-');
            // -------------------------------------------
            // Show All Windows
            // -------------------------------------------
            menu_items.push({
                html: i18n('show_all_windows'),
                onClick: function(){
                    $(`.window[data-app="${options.app}"]`).showWindow();
                }
            })
            // -------------------------------------------
            // Hide All Windows
            // -------------------------------------------
            menu_items.push({
                html: i18n('hide_all_windows'),
                onClick: function(){
                    if(open_windows > 0)
                        $(`.window[data-app="${options.app}"]`).hideWindow();
                }
            })
            // -------------------------------------------
            // Close All Windows
            // -------------------------------------------
            menu_items.push({
                html: i18n('close_all_windows'),
                onClick: function(){
                    $(`.window[data-app="${options.app}"]`).close();
                }
            })
        }
        const pos = el_taskbar_item.getBoundingClientRect();
        UIContextMenu({
            parent_element: el_taskbar_item,
            position: {top: pos.top - 15, left: pos.left+5},
            items: menu_items
        });

        return false;
    });

    $( el_taskbar_item ).tooltip({
        items: ".taskbar:not(.children-have-open-contextmenu) .taskbar-item",
        position: {
            my: "center bottom-20",
            at: "center top",
            using: function( position, feedback ) {
              $( this ).css( position );
              $( "<div>" )
                .addClass( "arrow" )
                .addClass( feedback.vertical )
                .addClass( feedback.horizontal )
                .appendTo( this );
            }
        }    
    });

    // --------------------------------------------------------
    // Droppable
    // --------------------------------------------------------
    $(el_taskbar_item).droppable({
        accept: '.item',
        // 'pointer' is very important because of active window tracking is based on the position of cursor.
        tolerance: 'pointer',
        drop: async function( event, ui ) {
            // Check if hovering over an item that is VISIBILE
            if($(event.target).closest('.window').attr('data-id') !== $(window.mouseover_window).attr('data-id'))
                return;

            // If ctrl is pressed and source is Trashed, cancel whole operation
            if(event.ctrlKey && path.dirname($(ui.draggable).attr('data-path')) === window.trash_path)
                return;

            const items_to_move = []
            
            // First item
            items_to_move.push(ui.draggable); 
            
            // All subsequent items
            const cloned_items = document.getElementsByClassName('item-selected-clone');
            for(let i =0; i<cloned_items.length; i++){
                const source_item = document.getElementById('item-' + $(cloned_items[i]).attr('data-id'));
                if(source_item !== null)
                    items_to_move.push(source_item);
            }

            // --------------------------------------------------------
            // If `options.onItemsDrop` is set, call it with the items to move
            //--------------------------------------------------------
            if(options.onItemsDrop && typeof options.onItemsDrop === 'function'){
                options.onItemsDrop(items_to_move);
                return;
            }
            // --------------------------------------------------------
            // If dropped on an app, open the app with the dropped item as an argument
            //--------------------------------------------------------
            else if(options.app){
                // an array that hold the items to sign
                const items_to_sign = [];

                // prepare items to sign
                for(let i=0; i < items_to_move.length; i++){
                    items_to_sign.push({
                        name: $(items_to_move[i]).attr('data-name'), 
                        uid: $(items_to_move[i]).attr('data-uid'), 
                        action: 'write', 
                        path: $(items_to_move[i]).attr('data-path')
                    });
                }

                // open each item
                for (let i = 0; i < items_to_sign.length; i++) {
                    const item = items_to_sign[i];
                    launch_app({
                        name: options.app, 
                        file_path: item.path,
                        // app_obj: open_item_meta.suggested_apps[0],
                        window_title: item.name,
                        file_uid: item.uid,
                        // file_signature: item,
                    });
                }

                // deselect dragged item
                for(let i=0; i < items_to_move.length; i++)
                    $(items_to_move[i]).removeClass('item-selected');
            }

            // Unselect directory/app if item is dropped
            if(options.is_dir || options.app){
                $(el_taskbar_item).removeClass('active');
                $(el_taskbar_item).tooltip('close');
                $('.ui-draggable-dragging .item-name, .item-selected-clone .item-name').css('opacity', 'initial')
                $('.item-container').removeClass('item-container-transparent-border')
            }

            // Re-enable droppable on all item-container
            $('.item-container').droppable('enable')

            return false;
        },
        over: function(event, ui){
            // Check hovering over an item that is VISIBILE
            const $event_parent_win = $(event.target).closest('.window')
            if( $event_parent_win.length > 0 && $event_parent_win.attr('data-id') !== $(window.mouseover_window).attr('data-id'))
                return;
            // Don't do anything if the dragged item is NOT a UIItem
            if(!$(ui.draggable).hasClass('item'))
                return;
            // If this is a directory or an app, and an item was dragged over it, highlight it.
            if(options.is_dir || options.app){
                $(el_taskbar_item).addClass('active');
                // show tooltip of this item
                $(el_taskbar_item).tooltip().mouseover();
                // make item name partially transparent
                $('.ui-draggable-dragging .item-name, .item-selected-clone .item-name').css('opacity', 0.1)
                // remove all item-container active borders
                $('.item-container').addClass('item-container-transparent-border')
            }
            // Disable all window bodies 
            $('.item-container').droppable( 'disable' )
        },
        out: function(event, ui){
            // Don't do anything if the dragged item is NOT a UIItem
            if(!$(ui.draggable).hasClass('item'))
                return;

            // Unselect directory/app if item is dragged out
            if(options.is_dir || options.app){
                $(el_taskbar_item).removeClass('active');
                $(el_taskbar_item).tooltip('close');
                $('.ui-draggable-dragging .item-name, .item-selected-clone .item-name').css('opacity', 'initial')
                $('.item-container').removeClass('item-container-transparent-border')
            }
            $('.item-container').droppable( 'enable' )    
        }
    });

    return el_taskbar_item;
}

export default UITaskbarItem