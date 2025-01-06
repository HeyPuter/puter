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

import UIWindowShare from './UIWindowShare.js';
import UIWindowPublishWebsite from './UIWindowPublishWebsite.js';
import UIWindowItemProperties from './UIWindowItemProperties.js';
import UIWindowSaveAccount from './UIWindowSaveAccount.js';
import UIPopover from './UIPopover.js';
import UIWindowEmailConfirmationRequired from './UIWindowEmailConfirmationRequired.js';
import UIContextMenu from './UIContextMenu.js'
import UIAlert from './UIAlert.js'
import path from "../lib/path.js"
import truncate_filename from '../helpers/truncate_filename.js';
import launch_app from "../helpers/launch_app.js"
import open_item from "../helpers/open_item.js"

function UIItem(options){
    const matching_appendto_count = $(options.appendTo).length;
    if(matching_appendto_count > 1){
        $(options.appendTo).each(function(){
            const opts = options;
            opts.appendTo = this;
            UIItem(opts);
        })
        return;
    }else if(matching_appendto_count === 0){
        return;
    }

    const item_id = window.global_element_id++;
    let last_mousedown_ts = 999999999999999;
    let rename_cancelled = false;

    // set options defaults
    options.disabled = options.disabled ?? false;
    options.visible = options.visible ?? 'visible'; // one of 'visible', 'revealed', 'hidden'
    options.is_dir = options.is_dir ?? false;
    options.is_selected = options.is_selected ?? false;
    options.is_shared = options.is_shared ?? false;
    options.is_shortcut = options.is_shortcut ?? 0;
    options.is_trash = options.is_trash ?? false;
    options.metadata = options.metadata ?? '';
    options.multiselectable = (options.multiselectable === undefined || options.multiselectable === true) ? true : false;
    options.shortcut_to = options.shortcut_to ?? '';
    options.shortcut_to_path = options.shortcut_to_path ?? '';
    options.immutable = (options.immutable === false || options.immutable === 0 || options.immutable === undefined ? 0 : 1);
    options.sort_container_after_append = (options.sort_container_after_append !== undefined ? options.sort_container_after_append : false);
    const is_shared_with_me = (options.path !== '/'+window.user.username && !options.path.startsWith('/'+window.user.username+'/'));

    let website_url = window.determine_website_url(options.path);

    // do a quick check to see if the target parent has any file type restrictions
    const appendto_allowed_file_types = $(options.appendTo).attr('data-allowed_file_types')
    if(!window.check_fsentry_against_allowed_file_types_string({is_dir: options.is_dir, name:options.name, type:options.type}, appendto_allowed_file_types))
        options.disabled = true;

    // --------------------------------------------------------
    // HTML for Item
    // --------------------------------------------------------
    let h = '';
    h += `<div  id="item-${item_id}" 
                class="item${options.is_selected ? ' item-selected':''} ${options.disabled ? 'item-disabled':''} item-${options.visible}" 
                data-id="${item_id}" 
                data-name="${html_encode(options.name)}" 
                data-metadata="${html_encode(options.metadata)}" 
                data-uid="${options.uid}" 
                data-is_dir="${options.is_dir ? 1 : 0}" 
                data-is_trash="${options.is_trash ? 1 : 0}"
                data-has_website="${options.has_website ? 1 : 0 }" 
                data-website_url = "${website_url ? html_encode(website_url) : ''}"
                data-immutable="${options.immutable}" 
                data-is_shortcut = "${options.is_shortcut}"
                data-shortcut_to = "${html_encode(options.shortcut_to)}"
                data-shortcut_to_path = "${html_encode(options.shortcut_to_path)}"
                data-sortable = "${options.sortable ?? 'true'}"
                data-sort_by = "${html_encode(options.sort_by) ?? 'name'}"
                data-size = "${options.size ?? ''}"
                data-type = "${html_encode(options.type) ?? ''}"
                data-modified = "${options.modified ?? ''}"
                data-associated_app_name = "${html_encode(options.associated_app_name) ?? ''}"
                data-path="${html_encode(options.path)}">`;

        // spinner
        h += `<div class="item-spinner">`;
        h += `</div>`;
        // modified
        h += `<div class="item-attr item-attr--modified">`;
            h += `<span>${options.modified === 0 ? '-' : timeago.format(options.modified*1000)}</span>`;
        h += `</div>`;
        // size
        h += `<div class="item-attr item-attr--size">`;
            h += `<span>${options.size ? window.byte_format(options.size) : '-'}</span>`;
        h += `</div>`;
        // type
        h += `<div class="item-attr item-attr--type">`;
            if(options.is_dir)
                h += `<span>${i18n('folder')}</span>`;
            else
                h += `<span>${options.type ? html_encode(options.type) : '-'}</span>`;
        h += `</div>`;


        // icon
        h += `<div class="item-icon">`;
            h += `<img src="${html_encode(options.icon.image)}" class="item-icon-${options.icon.type}" data-item-id="${item_id}">`;
        h += `</div>`;
        // badges
        h += `<div class="item-badges">`;
            // website badge
            h += `<img  class="item-badge item-has-website-badge long-hover" 
                        style="${options.has_website ? 'display:block;' : ''}" 
                        src="${html_encode(window.icons['world.svg'])}" 
                        data-item-id="${item_id}"
                    >`;
            // link badge
            h += `<img  class="item-badge item-has-website-url-badge" 
                        style="${website_url ? 'display:block;' : ''}" 
                        src="${html_encode(window.icons['link.svg'])}" 
                        data-item-id="${item_id}"
                    >`;

            // shared badge
            h += `<img  class="item-badge item-badge-has-permission" 
                        style="display: ${ is_shared_with_me ? 'block' : 'none'};
                            background-color: #ffffff;
                            padding: 2px;" src="${html_encode(window.icons['shared.svg'])}" 
                        data-item-id="${item_id}"
                        title="A user has shared this item with you.">`;
            // owner-shared badge
            h += `<img  class="item-badge item-is-shared" 
                        style="background-color: #ffffff; padding: 2px; ${!is_shared_with_me && options.is_shared ? 'display:block;' : ''}" 
                        src="${html_encode(window.icons['owner-shared.svg'])}" 
                        data-item-id="${item_id}"
                        data-item-uid="${options.uid}"
                        data-item-path="${html_encode(options.path)}"
                        title="You have shared this item with at least one other user."
                    >`;
            // shortcut badge
            h += `<img  class="item-badge item-shortcut" 
                        style="background-color: #ffffff; padding: 2px; ${options.is_shortcut !== 0 ? 'display:block;' : ''}" 
                        src="${html_encode(window.icons['shortcut.svg'])}" 
                        data-item-id="${item_id}"
                        title="Shortcut"
                    >`;

        h += `</div>`;

        // name
        h += `<pre class="item-name" data-item-id="${item_id}" title="${html_encode(options.name)}">${options.is_trash ? i18n('trash') : html_encode(truncate_filename(options.name))}</pre>`
        // name editor
        h += `<textarea class="item-name-editor hide-scrollbar" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" data-gramm_editor="false">${html_encode(options.name)}</textarea>`
    h += `</div>`;

    // append to options.appendTo
    $(options.appendTo).append(h);

    // updte item_container
    const item_container = $(options.appendTo).closest('.item-container');
    window.toggle_empty_folder_message(item_container);

    // get all the elements needed
    const el_item = document.getElementById(`item-${item_id}`);
    const el_item_name = document.querySelector(`#item-${item_id} > .item-name`);
    const el_item_icon = document.querySelector(`#item-${item_id} .item-icon`);
    const el_item_name_editor = document.querySelector(`#item-${item_id} > .item-name-editor`);
    const is_trashed = $(el_item).attr('data-path').startsWith(window.trash_path + '/');

    // update parent window's explorer item count if applicable
    if(options.appendTo !== undefined){
        let el_window = options.appendTo;
        if(!$(el_window).hasClass('.window'))
            el_window = $(el_window).closest('.window');

        window.update_explorer_footer_item_count(el_window);
    }

    // manual positioning
    if( !window.is_auto_arrange_enabled &&
        options.position && 
        // item is on the desktop (must be desktop itself and not a window, hence the '.desktop' class check)
        $(el_item).closest('.item-container.desktop').attr('data-path') === window.desktop_path
    ){
        el_item.style.position = 'absolute';
        el_item.style.left = options.position.left + 'px';
        el_item.style.top = options.position.top + 'px';
    }

    // --------------------------------------------------------
    // Dragster
    // allow dragging of local files on this window, if it's is_dir
    // --------------------------------------------------------
    if(options.is_dir){
        $(el_item).dragster({
            enter: function () {
                $(el_item).not('.item-disabled').addClass('item-selected');
            },
            leave: function () {
                $(el_item).removeClass('item-selected');
            },
            drop: function (dragsterEvent, event) {
                const e = event.originalEvent;        
                $(el_item).removeClass('item-selected');
                // if files were dropped...
                if(e.dataTransfer?.items?.length > 0){
                    window.upload_items( e.dataTransfer.items, $(el_item).attr('data-path'))
                }

                e.stopPropagation();
                e.preventDefault();
                return false;
            }
        });
    }

    // --------------------------------------------------------
    // Draggable
    // --------------------------------------------------------
    let longer_hover_timeout;
    let last_window_dragged_over;

    $(el_item).draggable({
        appendTo: "body",
        helper: "clone",
        revert: "invalid",
        //containment: "document",
        zIndex: 10000,
        scroll:false,
        distance: 5,
        revertDuration: 100,
        start: function(event, ui) {
            // select this item and its helper
            $(el_item).addClass('item-selected');
            $('.ui-draggable-dragging').addClass('item-selected');
            //clone other selected items
            $(el_item)
                .siblings('.item-selected')
                .clone()
                .addClass('item-selected-clone')
                .css('position', 'absolute')
                .appendTo('body')
                .hide();

            // Bring item and clones to front
            $('.item-selected-clone, .ui-draggable-dragging').css('z-index', 99999);

            // count badge
            const item_count = $('.item-selected-clone').length;
            if(item_count > 0){
                $('body').append(`<span class="draggable-count-badge">${item_count + 1}</span>`);
            }

            // Disable all droppable UIItems that are not a dir/app to avoid accidental cancellation
            // on Items that are not droppables. In general if an item is dropped on another, if the
            // target is not a dir, the source needs to be dropped on the target's container.
            $(`.item[data-is_dir="0"][data-associated_app_name=""]:not(.item-selected)`).droppable('disable');

            // Disable pointer events on all app iframes. This is needed because as soon as
            // a dragging event enters the iframe the event is delegated to iframe which makes the item
            // stuck at the edge of the iframe not allowing us to move items freely across the screen
            $('.window-app-iframe').css('pointer-events', 'none')

            // reset longer hover timeout and last window dragged over
            longer_hover_timeout = null;
            last_window_dragged_over = null;
        },
        drag: function(event, ui) {     
            // Only show drag helpers if the item has been moved more than 5px
            if( Math.abs(ui.originalPosition.top - ui.offset.top) > 5
            ||
            Math.abs(ui.originalPosition.left - ui.offset.left) > 5 ){
                $('.ui-draggable-dragging').show();
                $('.item-selected-clone').show();
                $('.draggable-count-badge').show();
            }  
      
            const other_selected_items = $('.item-selected-clone');
            const item_count = other_selected_items.length + 1;

            // Move count badge with mouse
            $('.draggable-count-badge').css({
                top: event.pageY,
                left: event.pageX + 10,
            })

            // Move other selected items
            for(let i=0; i < item_count - 1; i++){
                $(other_selected_items[i]).css({
                    'left': ui.position.left + 3 * (i+1),
                    'top': ui.position.top + 3 * (i+1),
                    'z-index': 999 - (i),
                    'opacity': 0.5 - i*0.1,
                })
            }

            // remove all item-container active borders
            $('.item-container').removeClass('item-container-active');

            // if item has changed container, remove timeout for window focus and reset last target
            if(longer_hover_timeout && last_window_dragged_over !== window.mouseover_window){
                clearTimeout(longer_hover_timeout);
                longer_hover_timeout = null;
                last_window_dragged_over = window.mouseover_window;
            }

            // if item hover for more than 1.2s, focus the window
            if(!longer_hover_timeout){
                longer_hover_timeout = setTimeout(() => {
                    $(last_window_dragged_over).focusWindow();
                }, 1200);
            }

            // Highlight item container to help user see more clearly where the item is going to be dropped
            if($(window.mouseover_item_container).closest('.window').is(window.mouseover_window) && 
                // do not highlight if the target is the same as the item being moved
                $(el_item).attr('data-path') !== $(window.mouseover_item_container).attr('data-path') &&
                // do not highlight if item is being moved to where it already is
                $(el_item).attr('data-path') !== $(window.mouseover_item_container).attr('data-path')){

                // highlight item container
                $(window.mouseover_item_container).addClass('item-container-active');
            }

            // send drag event to iframe if mouse is inside iframe
            if(window.mouseover_window){
                const $app_iframe = $(window.mouseover_window).find('.window-app-iframe');
                if(!$(window.mouseover_window).hasClass('window-disabled') && $app_iframe.length > 0){
                    var rect = $app_iframe.get(0).getBoundingClientRect();
                    // if mouse is inside iframe, send drag message to iframe
                    if(window.mouseX > rect.left && window.mouseX < rect.right && window.mouseY > rect.top && window.mouseY < rect.bottom){
                        $app_iframe.get(0).contentWindow.postMessage({msg: "drag", x: (window.mouseX - rect.left), y: (window.mouseY - rect.top)}, '*');
                    }
                }
            }
        },
        stop: function(event, ui){
            // Allow rearranging only if item is on desktop, not trash container, auto arrange is disabled and item is not dropped into another item
            if($(el_item).closest('.item-container').attr('data-path') === window.desktop_path && 
                !window.is_auto_arrange_enabled && $(el_item).attr('data-path') !== window.trash_path && !ui.helper.data('dropped') &&
                // Item must be dropped on the Desktop and not on the taskbar
                window.mouseover_window === undefined && ui.position.top <= window.desktop_height - window.taskbar_height - 15){
    
                el_item.style.position = 'absolute';
                el_item.style.left = ui.position.left + 'px';
                el_item.style.top = ui.position.top + 'px';
                $('.ui-draggable-dragging').remove();
                window.desktop_item_positions[$(el_item).attr('data-uid')] = ui.position;
                window.save_desktop_item_positions()
            }

            $('.item-selected-clone').remove();
            $('.draggable-count-badge').remove();
            // re-enable all droppable UIItems that are not a dir
            $(`.item[data-is_dir='0']:not(.item-selected)`).droppable('enable');
            // remove active item-container border highlights
            $('.item-container').removeClass('item-container-active');
            // reset longer hover timeout and last window dragged over
            clearTimeout(longer_hover_timeout);
            last_window_dragged_over = null;
        }
    });

    // --------------------------------------------------------
    // Droppable
    // --------------------------------------------------------
    $(el_item).droppable({
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

            // Adding a flag to know whether item is rearraged or dropped
            ui.helper.data('dropped', true);

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
            // If dropped on an app, open the app with the dropped 
            // items as argument
            //--------------------------------------------------------
            if(options.associated_app_name){
                // an array that hold the items to sign
                const items_to_open = [];

                // prepare items to sign
                for(let i=0; i < items_to_move.length; i++){
                    items_to_open.push({
                        name: $(items_to_move[i]).attr('data-name'),
                        uid: $(items_to_move[i]).attr('data-uid'), 
                        action: 'write', 
                        path: $(items_to_move[i]).attr('data-path')
                    });
                }

                // open each item
                for (let i = 0; i < items_to_open.length; i++) {
                    const item = items_to_open[i];
                    launch_app({
                        name: options.associated_app_name, 
                        file_path: item.path,
                        // app_obj: open_item_meta.suggested_apps[0],
                        window_title: item.name,
                        file_uid: item.uid,
                        file_signature: item,
                    });
                }

                // deselect dragged item
                for(let i=0; i < items_to_move.length; i++)
                    $(items_to_move[i]).removeClass('item-selected');
            }
            //--------------------------------------------------------
            // If dropped on a directory, move items to that directory
            //--------------------------------------------------------
            else{
                // If ctrl key is down, copy items. Except if target or source is Trash
                if(event.ctrlKey){
                    if(options.is_dir && $(el_item).attr('data-path') !== window.trash_path )
                        window.copy_items(items_to_move, $(el_item).attr('data-path'))
                    else if(!options.is_dir)
                        window.copy_items(items_to_move, path.dirname($(el_item).attr('data-path')));
                }
                // If alt key is down, create shortcut items
                else if(event.altKey && window.feature_flags.create_shortcut){
                    items_to_move.forEach((item_to_move) => {
                        window.create_shortcut(
                            path.basename($(item_to_move).attr('data-path')), 
                            $(item_to_move).attr('data-is_dir') === '1', 
                            options.is_dir ? $(el_item).attr('data-path') : path.dirname($(el_item).attr('data-path')), 
                            null, 
                            $(item_to_move).attr('data-shortcut_to') === '' ? $(item_to_move).attr('data-uid') : $(item_to_move).attr('data-shortcut_to'),
                            $(item_to_move).attr('data-shortcut_to_path') === '' ? $(item_to_move).attr('data-path') : $(item_to_move).attr('data-shortcut_to_path'),
                        );
                    });
                }
                // Otherwise, move items
                else if(options.is_dir){
                    if($(el_item).closest('.item-container').attr('data-path') === window.desktop_path){
                        delete window.desktop_item_positions[$(el_item).attr('data-uid')];
                        window.save_desktop_item_positions()
                    }
                    window.move_items(items_to_move, $(el_item).attr('data-shortcut_to_path') !== '' ? $(el_item).attr('data-shortcut_to_path') : $(el_item).attr('data-path'));
                }
            }

            // Re-enable droppable on all 'item-container's
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
            if(options.is_dir || options.associated_app_name){
                $(el_item).addClass('item-selected');
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
            if(options.is_dir || options.associated_app_name){
                $(el_item).removeClass('item-selected');
                $('.ui-draggable-dragging .item-name, .item-selected-clone .item-name').css('opacity', 'initial')
                $('.item-container').removeClass('item-container-transparent-border')
            }
            $('.item-container').droppable( 'enable' )    
        }
    });

    // --------------------------------------------------------
    // Double Click/Single Tap on Item
    // --------------------------------------------------------
    if(isMobile.phone || isMobile.tablet){
        $(el_item).on('click', async function (e) {
            // if item is disabled, do not allow any action
            if($(el_item).hasClass('item-disabled'))
                return false;

            if($(e.target).hasClass('item-name-editor'))
                return false;
    
            open_item({
                item: el_item, 
                maximized: true,
            });
        });
    
    }else{
        $(el_item).on('dblclick', async function (e) {
            // if item is disabled, do not allow any action
            if($(el_item).hasClass('item-disabled'))
                return false;

            if($(e.target).hasClass('item-name-editor'))
                return false;
    
            open_item({
                item: el_item, 
                new_window: e.metaKey || e.ctrlKey,
            });
        });
    }
    
    // --------------------------------------------------------
    // Mousedown
    // --------------------------------------------------------
    $(el_item).on('mousedown', function (e) {
        // if item is disabled, do not allow any action
        if($(el_item).hasClass('item-disabled'))
            return false;
        
        // if link badge is clicked, don't continue
        if($(e.target).hasClass('item-has-website-url-badge'))
            return false;

        // get the parent window
        const $el_parent_window = $(el_item).closest('.window');

        // first see if this is a ContextMenu call on multiple items
        if(e.which === 3 && $(el_item).hasClass('item-selected') && $(el_item).siblings('.item-selected').length > 0){
            $(".context-menu").remove();
            return false;
        }

        // unselect other items if neither CTRL nor Command key are held
        // or
        // if parent is not multiselectable
        if((!e.ctrlKey && !e.metaKey && !$(this).hasClass('item-selected')) || ($el_parent_window.length>0 && $el_parent_window.attr('data-multiselectable') !== 'true')){
            $(this).closest('.item-container').find('.item-selected').removeClass('item-selected');
        }
        if((e.ctrlKey || e.metaKey) && $(this).hasClass('item-selected')){
            $(this).removeClass('item-selected')
        }
        else{
            $(this).addClass('item-selected')
        }
        window.update_explorer_footer_selected_items_count($el_parent_window)
    });
    // --------------------------------------------------------
    // Click
    // --------------------------------------------------------
    $(el_item).on('click', function (e) {
        // if item is disabled, do not allow any action
        if($(el_item).hasClass('item-disabled'))
            return false;

        skip_a_rename_click = false;
        const $el_parent_window = $(el_item).closest('.window');
        
        // do not unselect other items if:
        // CTRL/Command key is pressed or clicking an item that is already selected
        if(!e.ctrlKey && !e.metaKey){
            $(this).closest('.item-container').find('.item-selected').not(this).removeClass('item-selected');
            window.update_explorer_footer_selected_items_count($el_parent_window)
        }
        //----------------------------------------------------------------
        // On an OpenFileDialog?
        //----------------------------------------------------------------
        if($el_parent_window.attr('data-is_openFileDialog') === 'true'){
            if(!options.is_dir)
                $el_parent_window.find('.openfiledialog-open-btn').removeClass('disabled');
            else
                $el_parent_window.find('.openfiledialog-open-btn').addClass('disabled');
        }
        //----------------------------------------------------------------
        // On a SaveFileDialog?
        //----------------------------------------------------------------
        if($el_parent_window.attr('data-is_saveFileDialog') === 'true' && !options.is_dir){
            $el_parent_window.find('.savefiledialog-filename').val($(el_item).attr('data-name'));
            $el_parent_window.find('.savefiledialog-save-btn').removeClass('disabled');
        }
    });

    $(document).on('click', function(e){
        if(!$(e.target).hasClass('item') && !$(e.target).hasClass('item-name') && !$(e.target).hasClass('item-icon')){
            skip_a_rename_click = true;
        }

        if($(e.target).parents('.item').data('id') !== item_id){
            skip_a_rename_click = true;
        }
    })

    // --------------------------------------------------------
    // Rename
    // --------------------------------------------------------
    function rename(){
        if(rename_cancelled){
            rename_cancelled = false;
            return;
        }

        const old_name = $(el_item).attr('data-name');
        const old_path = $(el_item).attr('data-path');
        const new_name = $(el_item_name_editor).val();

        // Don't send a rename request if:
        // the new name is the same as the old one, 
        // or it's empty,
        // or editable was not even active at all
        if(old_name === new_name || !new_name || new_name === '.' || new_name === '..' || !$(el_item_name_editor).hasClass('item-name-editor-active')){
            if(new_name === '.'){
                UIAlert(`The name "." is not allowed, because it is a reserved name. Please choose another name.`);
            }
            else if(new_name === '..'){
                UIAlert(`The name ".." is not allowed, because it is a reserved name. Please choose another name.`)
            }

            $(el_item_name).html(html_encode(truncate_filename(options.name)));
            $(el_item_name).show();
            $(el_item_name_editor).val($(el_item).attr('data-name'));
            $(el_item_name_editor).hide();
            return;
        }
        // deactivate item name editable
        $(el_item_name_editor).removeClass('item-name-editor-active');

        // Perform rename request
        window.rename_file(options, new_name, old_name, old_path, el_item, el_item_name, el_item_icon, el_item_name_editor, website_url);
    }
    
    // --------------------------------------------------------
    // Rename if enter pressed on Item Name Editor
    // --------------------------------------------------------
    $(el_item_name_editor).on('keypress',function(e) {
        // If name editor is not active don't continue
        if(!$(el_item_name_editor).is(":visible"))
            return;

        // Enter key = rename
        if(e.which === 13) {
            e.stopPropagation();
            e.preventDefault();
            $(el_item_name_editor).blur();
            $(el_item).addClass('item-selected');
            window.last_enter_pressed_to_rename_ts = Date.now();
            window.update_explorer_footer_selected_items_count($(el_item).closest('.item-container'));
            return false;
        }
    })

    // --------------------------------------------------------
    // Cancel and undo if escape pressed on Item Name Editor
    // --------------------------------------------------------
    $(el_item_name_editor).on('keyup',function(e) {
        if(!$(el_item_name_editor).is(":visible"))
            return;

        // Escape = undo rename
        else if(e.which === 27){
            e.stopPropagation();
            e.preventDefault();
            rename_cancelled = true;
            $(el_item_name_editor).hide();
            $(el_item_name_editor).val(options.name);
            $(el_item_name).show();
        }
    });

    $(el_item_name_editor).on('focusout',function(e) {
        e.stopPropagation();
        e.preventDefault();
        rename();
    });

    /************************************************
     *  Takes care of 'click to edit item name'
     ************************************************/
    let skip_a_rename_click = true;
    $(el_item_name).on('click', function(e){
        if( !skip_a_rename_click && e.which !== 3 && $(el_item_name).parent('.item-selected').length > 0){
            last_mousedown_ts = Date.now();       
            setTimeout(() => {
                if(!skip_a_rename_click && (Date.now() - last_mousedown_ts) > 400){
                    if (!e.ctrlKey && !e.metaKey)
                        window.activate_item_name_editor(el_item)
                    last_mousedown_ts = 0
                }else{
                    last_mousedown_ts = Date.now() + 500;
                    skip_a_rename_click= false;
                }
            }, 500);
        }
        skip_a_rename_click = false;
    })
    $(el_item_name).on('dblclick', function(e){
        skip_a_rename_click = true;
    })

    // --------------------------------------------------------
    // ContextMenu
    // --------------------------------------------------------
    $(el_item).bind("contextmenu taphold", async function (event) {
        // if item is disabled, do not allow any action
        if($(el_item).hasClass('item-disabled'))
            return false;

        // if on website link badge, don't continue
        if($(event.target).hasClass('item-has-website-url-badge'))
            return false;

        // dimiss taphold on regular devices
        if(event.type==='taphold' && !isMobile.phone && !isMobile.tablet)
            return;

        // if editing item name, preserve native context menu
        if(event.target === el_item_name_editor)
            return;

        event.preventDefault();
        let menu_items;
        const $selected_items = $(el_item).closest('.item-container').find('.item-selected').not(el_item).addBack();
        // -------------------------------------------------------
        // Multiple items selected
        // -------------------------------------------------------
        if($selected_items.length > 1){
            const are_trashed = $selected_items.attr('data-path').startsWith(window.trash_path + '/');
            menu_items = []
            // -------------------------------------------
            // Restore
            // -------------------------------------------
            if(are_trashed){
                menu_items.push({
                    html: i18n('restore'),
                    onClick: function(){
                        $selected_items.each(function() {
                            const ell = this;
                            let metadata = $(ell).attr('data-metadata') === '' ? {} : JSON.parse($(ell).attr('data-metadata'))
                            window.move_items([ell], path.dirname(metadata.original_path));
                        })
                    }
                });
                // -------------------------------------------
                // -
                // -------------------------------------------
                menu_items.push('-');
            }
            if(!are_trashed){
                menu_items.push({
                    html: 'Share With…',
                    onClick: async function(){
                        if(window.user.is_temp && 
                            !await UIWindowSaveAccount({
                                send_confirmation_code: true,
                                message: 'Please create an account to proceed.',
                                window_options: {
                                    backdrop: true,
                                    close_on_backdrop_click: false,
                                }                                
                            }))
                            return;
                        else if(!window.user.email_confirmed && !await UIWindowEmailConfirmationRequired())
                            return;

                        let items = [];
                        $selected_items.each(function() {
                            const ell = this;
                            items.push({uid: $(ell).attr('data-uid'), path: $(ell).attr('data-path'), icon: $(ell).find('.item-icon img').attr('src'), name: $(ell).attr('data-name')});
                        })
                        UIWindowShare(items);
                    }
                })
                // -------------------------------------------
                // -
                // -------------------------------------------
                menu_items.push({ is_divider: true });

                // -------------------------------------------
                // Donwload
                // -------------------------------------------
                menu_items.push({
                    html: i18n('download'),
                    onClick: async function(){
                        let items = [];
                        for (let index = 0; index < $selected_items.length; index++) {
                            items.push($selected_items[index]);
                        }

                        window.zipItems(items, path.dirname($(el_item).attr('data-path')), true);
                    }
                });
                // -------------------------------------------
                // Zip
                // -------------------------------------------
                menu_items.push({
                    html: i18n('zip'),
                    onClick: async function(){
                        let items = [];
                        for (let index = 0; index < $selected_items.length; index++) {
                            items.push($selected_items[index]);
                        }

                        window.zipItems(items, path.dirname($(el_item).attr('data-path')), false);
                    }
                });
                // -------------------------------------------
                // -
                // -------------------------------------------
                menu_items.push('-');
            }
            // -------------------------------------------
            // Cut
            // -------------------------------------------
            menu_items.push({
                html: i18n('cut'),
                onClick: function(){
                    window.clipboard_op= 'move';
                    window.clipboard = [];
                    $selected_items.each(function() {
                        const ell = this;
                        window.clipboard.push($(ell).attr('data-path'));
                    })
                }
            });
            // -------------------------------------------
            // Copy
            // -------------------------------------------
            if(!are_trashed){
                menu_items.push({
                    html: i18n('copy'),
                    onClick: function(){
                        window.clipboard_op= 'copy';
                        window.clipboard = [];
                        $selected_items.each(function() {
                            const ell = this;
                            window.clipboard.push({path: $(ell).attr('data-path')});
                        })
                    }
                });
            }
            // -------------------------------------------
            // -
            // -------------------------------------------
            menu_items.push('-');
            // -------------------------------------------
            // Delete Permanently
            // -------------------------------------------
            if(are_trashed){
                menu_items.push({
                    html: i18n('delete_permanently'),
                    onClick: async function(){
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

                            // update other clients
                            if(window.socket){
                                window.socket.emit('trash.is_empty', {is_empty: trash.is_empty});
                            }

                            if(trash.is_empty){
                                $(`.item[data-path="${html_encode(window.trash_path)}" i], .item[data-shortcut_to_path="${window.trash_path}" i]`).find('.item-icon > img').attr('src', window.icons['trash.svg']);
                                $(`.window[data-path="${html_encode(window.trash_path)}"]`).find('.window-head-icon').attr('src', window.icons['trash.svg']);
                            }            
                        }
                    }
                });
            }
            // -------------------------------------------
            // Create Shortcut
            // -------------------------------------------
            if(!are_trashed && window.feature_flags.create_shortcut){
                menu_items.push({
                    html: i18n('create_shortcut'),
                    onClick: async function(){
                        $selected_items.each(function() {
                            let base_dir = path.dirname($(this).attr('data-path'));
                            // Trash on Desktop is a special case
                            if($(this).attr('data-path') && $(this).closest('.item-container').attr('data-path') === window.desktop_path){
                                base_dir = window.desktop_path;
                            }
                            // create shortcut
                            window.create_shortcut(
                                path.basename($(this).attr('data-path')), 
                                $(this).attr('data-is_dir') === '1', 
                                base_dir, 
                                $(this).closest('.item-container'), 
                                $(this).attr('data-shortcut_to') === '' ? $(this).attr('data-uid') : $(this).attr('data-shortcut_to'),
                                $(this).attr('data-shortcut_to_path') === '' ? $(this).attr('data-path') : $(this).attr('data-shortcut_to_path'),
                            );
                        })
                    }
                });
            }
            // -------------------------------------------
            // Delete
            // -------------------------------------------
            if(!are_trashed){
                menu_items.push({
                    html: i18n('delete'),
                    onClick: async function(){
                        window.move_items($selected_items, window.trash_path);
                    }
                });
            }

        }

        // -------------------------------------------------------
        // One item selected
        // -------------------------------------------------------   
        else{
            const is_trash = $(el_item).attr('data-path') === window.trash_path || $(el_item).attr('data-shortcut_to_path') === window.trash_path;
            menu_items = [];
            // -------------------------------------------
            // Open
            // -------------------------------------------
            if(!is_trashed){
                menu_items.push({
                    html: i18n('open'),
                    onClick: function(){
                        open_item({item: el_item});
                    }
                });

                // -------------------------------------------
                // -
                // -------------------------------------------
                if(options.associated_app_name || is_trash)
                    menu_items.push('-');
            }
            // -------------------------------------------
            // Open With
            // -------------------------------------------
            if(!is_trashed && !is_trash  && (options.associated_app_name === null || options.associated_app_name === undefined)){
                let items = [];
                if(!options.suggested_apps || options.suggested_apps.length === 0){
                    // try to find suitable apps
                    const suitable_apps = await window.suggest_apps_for_fsentry({
                        uid: options.uid,
                        path: options.path,
                    });
                    if(suitable_apps && suitable_apps.length > 0){
                        options.suggested_apps = suitable_apps;
                    }
                }

                if(options.suggested_apps && options.suggested_apps.length > 0){
                    for (let index = 0; index < options.suggested_apps.length; index++) {
                        const suggested_app = options.suggested_apps[index];
                        if ( ! suggested_app ) {
                            console.warn(`suggested_app is null`, options.suggested_apps, index);
                            continue;
                        }
                        items.push({
                            html: suggested_app.title,
                            icon: `<img src="${html_encode(suggested_app.icon ?? window.icons['app.svg'])}" style="width:16px; height: 16px; margin-bottom: -4px;">`,
                            onClick: async function(){
                                var extension = path.extname($(el_item).attr('data-path')).toLowerCase();
                                if(
                                    window.user_preferences[`default_apps${extension}`] !== suggested_app.name
                                    && 
                                    (
                                        (!window.user_preferences[`default_apps${extension}`] && index > 0)
                                        || 
                                        (window.user_preferences[`default_apps${extension}`])
                                    )
                                ){
                                    const alert_resp = await UIAlert({
                                        message: `${i18n('change_always_open_with')} ` + html_encode(suggested_app.title) + '?',
                                        body_icon: suggested_app.icon,
                                        buttons:[
                                            {
                                                label: i18n('yes'),
                                                type: 'primary',
                                                value: 'yes'
                                            },
                                            {
                                                label: i18n('no')
                                            },
                                        ]
                                    })
                                    if((alert_resp) === 'yes'){
                                        window.user_preferences['default_apps' + extension] = suggested_app.name;
                                        window.mutate_user_preferences(window.user_preferences);
                                    }
                                }
                                launch_app({
                                    name: suggested_app.name,
                                    file_path: $(el_item).attr('data-path'),
                                    window_title: $(el_item).attr('data-name'),
                                    file_uid: $(el_item).attr('data-uid'),
                                });
                            }
                        })
                    }
                }else{                    
                    items.push({
                        html: 'No suitable apps found',
                        disabled: true,
                    });
                }
                // add all suitable apps
                menu_items.push({
                    html: i18n('open_with'),
                    items: items,
                });

                // -------------------------------------------
                // -- separator --
                // -------------------------------------------
                menu_items.push('-');
            }

            // -------------------------------------------
            // Open in New Window
            // (only if the item is on a window)
            // -------------------------------------------
            if($(el_item).closest('.window-body').length > 0 && options.is_dir){
                menu_items.push({
                    html: i18n('open_in_new_window'),
                    onClick: function(){
                        if(options.is_dir){
                            open_item({item: el_item, new_window: true})
                        }
                    }
                });
                // -------------------------------------------
                // -- separator --
                // -------------------------------------------
                if(!is_trash && !is_trashed && options.is_dir)
                    menu_items.push('-');
            }
            // -------------------------------------------
            // Share With…
            // -------------------------------------------
            if(!is_trashed && !is_trash){
                menu_items.push({
                    html: 'Share With…',
                    onClick: async function(){
                        if(window.user.is_temp && 
                            !await UIWindowSaveAccount({
                                send_confirmation_code: true,
                                message: 'Please create an account to proceed.',
                                window_options: {
                                    backdrop: true,
                                    close_on_backdrop_click: false,
                                }                                
                            }))
                            return;
                        else if(!window.user.email_confirmed && !await UIWindowEmailConfirmationRequired())
                            return;

                        UIWindowShare([{uid: $(el_item).attr('data-uid'), path: $(el_item).attr('data-path'), name: $(el_item).attr('data-name'), icon: $(el_item_icon).find('img').attr('src')}]);
                    }
                });
            }

            // -------------------------------------------
            // Publish As Website
            // -------------------------------------------
            if(!is_trashed && !is_trash && options.is_dir){
                menu_items.push({
                    html: i18n('publish_as_website'),
                    disabled: !options.is_dir,
                    onClick: async function () {
                        if(window.require_email_verification_to_publish_website){
                            if(window.user.is_temp && 
                                !await UIWindowSaveAccount({
                                    send_confirmation_code: true,
                                    message: 'Please create an account to proceed.',
                                    window_options: {
                                        backdrop: true,
                                        close_on_backdrop_click: false,
                                    }                                
                                }))
                                return;
                            else if(!window.user.email_confirmed && !await UIWindowEmailConfirmationRequired())
                                return;
                        }
                        UIWindowPublishWebsite(options.uid, $(el_item).attr('data-name'), $(el_item).attr('data-path'));
                    }
                });

            }
            // -------------------------------------------
            // Deploy As App
            // -------------------------------------------
            if(!is_trashed && !is_trash && options.is_dir){
                menu_items.push({
                    html: i18n('deploy_as_app'),
                    disabled: !options.is_dir,
                    onClick: async function () {
                        launch_app({
                            name: 'dev-center',
                            file_path: $(el_item).attr('data-path'),
                            file_uid: $(el_item).attr('data-uid'),
                            params: {
                                source_path: options.path,
                            }
                        })
                    }
                });

                menu_items.push('-');
            }

            // -------------------------------------------
            // Empty Trash
            // -------------------------------------------
            if(is_trash){
                menu_items.push({
                    html: i18n('empty_trash'),
                    onClick: async function(){
                        window.empty_trash();
                    }
                });
            }
            // -------------------------------------------
            // Download
            // -------------------------------------------
            if(!is_trash && !is_trashed && (options.associated_app_name === null || options.associated_app_name === undefined)){
                menu_items.push({
                    html: i18n('download'),
                    disabled: options.is_dir && !window.feature_flags.download_directory,
                    onClick: async function(){
                        if(options.is_dir)
                            window.zipItems(el_item, path.dirname($(el_item).attr('data-path')), true);
                        else
                            window.trigger_download([options.path]);
                    }
                });                
            }
            // -------------------------------------------
            // Zip
            // -------------------------------------------
            if(!is_trash && !is_trashed && !$(el_item).attr('data-path').endsWith('.zip')){
                menu_items.push({
                    html: i18n('zip'),
                    onClick: function(){
                        window.zipItems(el_item, path.dirname($(el_item).attr('data-path')), false);
                    }
                })
            }
            // -------------------------------------------
            // Unzip
            // -------------------------------------------
            if(!is_trash && !is_trashed && $(el_item).attr('data-path').endsWith('.zip')){
                menu_items.push({
                    html: i18n('unzip'),
                    onClick: async function(){
                        let filePath = $(el_item).attr('data-path');
                        window.unzipItem(filePath)
                    }
                })
            }
            // -------------------------------------------
            // Restore
            // -------------------------------------------
            if(is_trashed){
                menu_items.push({
                    html: i18n('restore'),
                    onClick: async function(){
                        let metadata = $(el_item).attr('data-metadata') === '' ? {} : JSON.parse($(el_item).attr('data-metadata'))
                        window.move_items([el_item], path.dirname(metadata.original_path));
                    }
                });
            }
            // -------------------------------------------
            // -
            // -------------------------------------------
            if(!is_trash && (options.associated_app_name === null || options.associated_app_name === undefined))
                menu_items.push('-');
            // -------------------------------------------
            // Cut
            // -------------------------------------------
            if($(el_item).attr('data-immutable') === '0' && !is_shared_with_me){
                menu_items.push({
                    html: i18n('cut'),
                    onClick: function(){
                        window.clipboard_op= 'move';
                        window.clipboard= [options.path];
                    }
                });
            }
            // -------------------------------------------
            // Copy
            // -------------------------------------------
            if(!is_trashed && !is_trash){
                menu_items.push({
                    html: i18n('copy'),
                    onClick: function(){
                        window.clipboard_op= 'copy';
                        window.clipboard= [{path: options.path}];
                    }
                });
            }
            // -------------------------------------------
            // Paste Into Folder
            // -------------------------------------------
            if($(el_item).attr('data-is_dir') === '1' && !is_trashed && !is_trash){
                menu_items.push({
                    html: i18n('paste_into_folder'),
                    disabled: window.clipboard.length > 0 ? false : true,
                    onClick: function(){
                        if(window.clipboard_op === 'copy')
                            window.copy_clipboard_items($(el_item).attr('data-path'), null);
                        else if(window.clipboard_op === 'move')
                            window.move_clipboard_items(null, $(el_item).attr('data-path'))
                    }
                })
            }
            // -------------------------------------------
            // -
            // -------------------------------------------
            if($(el_item).attr('data-immutable') === '0' && !is_trash){
                menu_items.push('-')
            }
            // -------------------------------------------
            // Create Shortcut
            // -------------------------------------------
            if(!is_trashed && window.feature_flags.create_shortcut){
                menu_items.push({
                    html: i18n('create_shortcut'),
                    onClick: async function(){
                        let base_dir = path.dirname($(el_item).attr('data-path'));
                        // Trash on Desktop is a special case
                        if($(el_item).attr('data-path') && $(el_item).closest('.item-container').attr('data-path') === window.desktop_path){
                            base_dir = window.desktop_path;
                        }

                        window.create_shortcut(
                            path.basename($(el_item).attr('data-path')), 
                            options.is_dir, 
                            base_dir, 
                            options.appendTo, 
                            options.shortcut_to === '' ? options.uid : options.shortcut_to,
                            options.shortcut_to_path === '' ? options.path : options.shortcut_to_path,
                        );
                    }
                });
            }
            // -------------------------------------------
            // Delete
            // -------------------------------------------
            if($(el_item).attr('data-immutable') === '0' && !is_trashed && !is_shared_with_me){
                menu_items.push({
                    html: i18n('delete'),
                    onClick: async function(){
                        window.move_items([el_item], window.trash_path);
                    }
                });
            }
            // -------------------------------------------
            // Delete Permanently
            // -------------------------------------------
            if(is_trashed){
                menu_items.push({
                    html: i18n('delete_permanently'),
                    onClick: async function(){
                        const alert_resp = await UIAlert({
                            message: i18n('confirm_delete_single_item'),
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
                            await window.delete_item(el_item);
                            // check if trash is empty
                            const trash = await puter.fs.stat(window.trash_path);
                            // update other clients
                            if(window.socket){
                                window.socket.emit('trash.is_empty', {is_empty: trash.is_empty});
                            }
                            // update this client
                            if(trash.is_empty){
                                $(`.item[data-path="${html_encode(window.trash_path)}" i], .item[data-shortcut_to_path="${html_encode(window.trash_path)}" i]`).find('.item-icon > img').attr('src', window.icons['trash.svg']);
                                $(`.window[data-path="${window.trash_path}"]`).find('.window-head-icon').attr('src', window.icons['trash.svg']);
                            }            
                        }
                    }
                });
            }
            // -------------------------------------------
            // Rename
            // -------------------------------------------
            if($(el_item).attr('data-immutable') === '0' && !is_trashed && !is_trash){
                menu_items.push({
                    html: i18n('rename'),
                    onClick: function(){
                        window.activate_item_name_editor(el_item)
                    }
                });
            }
            // -------------------------------------------
            // -
            // -------------------------------------------
            menu_items.push('-');
            // -------------------------------------------
            // Properties
            // -------------------------------------------
            menu_items.push({
                html: i18n('properties'),
                onClick: function(){
                    let window_height = 500;
                    let window_width = 450;

                    let left = $(el_item).position().left + $(el_item).width();
                    left = left > (window.innerWidth - window_width)? (window.innerWidth - window_width) : left;

                    let top = $(el_item).position().top + $(el_item).height();
                    top = top > (window.innerHeight - (window_height + window.taskbar_height + window.toolbar_height))? (window.innerHeight - (window_height + window.taskbar_height + window.toolbar_height)) : top;

                    UIWindowItemProperties(
                        $(el_item).attr('data-name'), 
                        $(el_item).attr('data-path'), 
                        $(el_item).attr('data-uid'),
                        left,
                        top,
                        window_width,
                        window_height,
                    );
                }
            });
        }     
        
        // Create ContextMenu
        UIContextMenu({
            parent_element: ($(options.appendTo).hasClass('desktop') ? undefined : options.appendTo),
            items: menu_items
        });

        return false
    })

    // --------------------------------------------------------
    // Resize Item Name Editor on every keystroke
    // --------------------------------------------------------
    $(el_item_name_editor).on('input keypress focus', function(){
        const val = $(el_item_name_editor).val();
        $('.item-name-shadow').html(html_encode(val));
        if(val !== ''){
            const w = $('.item-name-shadow').width();
            const h = $('.item-name-shadow').height();
            $(el_item_name_editor).width(w + 4)
            $(el_item_name_editor).height(h + 2)
        }
    })

    if(options.sort_container_after_append){
        window.sort_items(options.appendTo, $(el_item).closest('.item-container').attr('data-sort_by'), $(el_item).closest('.item-container').attr('data-sort_order'));
    }
    if(options.editable){
        window.activate_item_name_editor(el_item)
    }
}

// Create item-name-shadow
// This element has the exact styling as item name editor and allows us
// to measure the width and height of the item name editor and automatically
// resize it to fit the text.
$('body').append(`<span class="item-name-shadow"></span>`);

$(document).on('click', '.item-has-website-url-badge', async function(e){
    e.stopPropagation();
    e.preventDefault();
    const website_url = $(this).closest('.item').attr('data-website_url');
    if(website_url){
        window.open(website_url, '_blank');
    }  
    return false;
})

$(document).on('mousedown', '.item-has-website-url-badge', async function(e){
    console.log('mousedown')
    e.stopPropagation();
    e.preventDefault();
    return false;   
})

$(document).on('contextmenu', '.item-has-website-url-badge', async function(e){
    e.stopPropagation();
    e.preventDefault();
    
    // close other context menus
    const $ctxmenus = $(".context-menu");
    $ctxmenus.fadeOut(200, function(){
        $ctxmenus.remove();
    });

    UIContextMenu({
        parent_element: this,
        items: [
            // Open
            {
                html: `${i18n('open_in_new_tab')} <img src="${window.icons['launch.svg']}" style="width:10px; height:10px; margin-left: 5px;">` ,
                html_active: `${i18n('open_in_new_tab')} <img src="${window.icons['launch-white.svg']}" style="width:10px; height:10px; margin-left: 5px;">` ,
                onClick: function(){
                    const website_url = $(e.target).closest('.item').attr('data-website_url');
                    if(website_url){
                        window.open(website_url, '_blank');
                    }  
                }
            },
            // Copy Link
            {
                html: i18n('copy_link'),
                onClick: async function(){
                    const website_url = $(e.target).closest('.item').attr('data-website_url');
                    if(website_url){
                        await window.copy_to_clipboard(website_url);
                    }  
                }
            },
        ]
    });
    
    return false;
})

$(document).on('click', '.item-has-website-badge', async function(e){
    puter.fs.stat({
        uid: $(this).closest('.item').attr('data-uid'),
        returnSubdomains: true,
        returnPermissions: false,
        returnVersions: false,
        success: function (fsentry){
            if(fsentry.subdomains)
                window.open(fsentry.subdomains[0].address, '_blank');
        }
    })
})

$(document).on('long-hover', '.item-has-website-badge', function(e){
    puter.fs.stat({
        uid: $(this).closest('.item').attr('data-uid'),
        returnSubdomains: true,
        returnPermissions: false,
        returnVersions: false,
        success: function (fsentry){
            var box = e.target.getBoundingClientRect();

            var body = document.body;
            var docEl = document.documentElement;
        
            var scrollTop = window.pageYOffset || docEl.scrollTop || body.scrollTop;
            var scrollLeft = window.pageXOffset || docEl.scrollLeft || body.scrollLeft;
        
            var clientTop = docEl.clientTop || body.clientTop || 0;
            var clientLeft = docEl.clientLeft || body.clientLeft || 0;
        
            var top  = box.top +  scrollTop - clientTop;
            var left = box.left + scrollLeft - clientLeft;
        
        
            if(fsentry.subdomains){
                let h = `<div class="allow-user-select website-badge-popover-content">`;
                h += `<div class="website-badge-popover-title">Associated website${ fsentry.subdomains.length > 1 ? 's':''}</div>`;
                fsentry.subdomains.forEach(subdomain => {
                    h += `
                    <a class="website-badge-popover-link" href="${subdomain.address}" style="font-size:13px;" target="_blank">${subdomain.address.replace('https://', '')}</a>
                    <br>`;
                });

                h += `</div>`;

                // close other website popovers
                $('.website-badge-popover-content').closest('.popover').remove();

                // show a UIPopover with the website
                UIPopover({
                    target: e.target,
                    content:h,
                    snapToElement: e.target,
                    parent_element: e.target,
                    top: top - 30,
                    left: left + 20,
                })
            }
        }
    })
})

$(document).on('click', '.website-badge-popover-link', function(e){
    // remove the parent popover
    $(e.target).closest('.popover').remove();
})

// removes item(s)
$.fn.removeItems = async function(options) {
    options = options || {};
    $(this).each(async function() {
        const parent_container = $(this).closest('.item-container');
        $(this).remove();
        window.toggle_empty_folder_message(parent_container);
    });

    return this;
}

window.activate_item_name_editor= function(el_item){
    // files in trash cannot be renamed, the user should be notified with an Alert.
    if($(el_item).attr('data-immutable') !== '0'){
        return;
    }
    // files in trash cannot be renamed, user should be notified with an Alert.
    else if(path.dirname($(el_item).attr('data-path')) === window.trash_path){
        UIAlert(i18n('items_in_trash_cannot_be_renamed'));
        return;
    }

    const el_item_name = $(el_item).find('.item-name');
    const el_item_name_editor = $(el_item).find('.item-name-editor').get(0);

    $(el_item_name).hide();
    $(el_item_name_editor).show();
    $(el_item_name_editor).focus();
    $(el_item_name_editor).addClass('item-name-editor-active');

    // html-decode the content of the item name editor, this is necessary because the item name is html-encoded when displayed
    // but the item name editor is not html-encoded. If we remove this line, the item name editor will display the html-encoded
    // version of the item name after a successful name edit.
    $(el_item_name_editor).val(html_decode($(el_item_name_editor).val()));

    // select all text before extension
    const item_name = $(el_item).attr('data-name');
    const is_dir = parseInt($(el_item).attr('data-is_dir'));
    const extname = path.extname('/'+item_name);
    if(extname !== '' && !is_dir)
        el_item_name_editor.setSelectionRange(0, item_name.length - extname.length)
    else
        $(el_item_name_editor).select();
}

export default UIItem;
