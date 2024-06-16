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

function UIContextMenu(options){
    $('.window-active .window-app-iframe').css('pointer-events', 'none');

    const menu_id = window.global_element_id++;
    let h = '';
    h += `<div 
                id="context-menu-${menu_id}" 
                data-is-submenu="${options.is_submenu ? 'true' : 'false'}"
                data-element-id="${menu_id}"
                data-id="${options.id ?? ''}"
                ${options.parent_id ? `data-parent-id="${options.parent_id}"` : ``}
                ${!options.parent_id && options.parent_element ? `data-parent-id="${$(options.parent_element).attr('data-element-id')}"` : ``}
                class="context-menu context-menu-active ${options.is_submenu ? 'context-menu-submenu-open' : ''}"
            >`;
            
        for(let i=0; i < options.items.length; i++){
            // item
            if(!options.items[i].is_divider && options.items[i] !== '-'){
                // single item
                if(options.items[i].items === undefined){
                    h += `<li data-action="${i}" 
                            class="context-menu-item ${options.items[i].disabled ? ' context-menu-item-disabled' : ''}"
                            >`;
                        // icon
                        if(options.items[i].checked === true){
                            h += `<span class="context-menu-item-icon">✓</span>`;
                            h += `<span class="context-menu-item-icon-active">✓</span>`;
                        }else{
                            h += `<span class="context-menu-item-icon">${options.items[i].icon ?? ''}</span>`;
                            h += `<span class="context-menu-item-icon-active">${options.items[i].icon_active ?? (options.items[i].icon ?? '')}</span>`;
                        }
                        // label
                        h += `<span class="contextmenu-label">${options.items[i].html}</span>`;
                        h += `<span class="contextmenu-label-active">${options.items[i].html_active ?? options.items[i].html}</span>`;

                    h += `</li>`;
                }
                // submenu
                else{
                    h += `<li data-action="${i}" 
                              data-menu-id="${menu_id}-${i}"
                              data-has-submenu="true"
                              data-parent-element-id="${menu_id}"
                              class="context-menu-item-submenu context-menu-item${options.items[i].disabled ? ' context-menu-item-disabled' : ''}"
                            >`;
                        // icon
                        h += `<span class="context-menu-item-icon">${options.items[i].icon ?? ''}</span>`;
                        h += `<span class="context-menu-item-icon-active">${options.items[i].icon_active ?? (options.items[i].icon ?? '')}</span>`;
                        // label
                        h += `${html_encode(options.items[i].html)}`;
                        // arrow
                        h += `<img class="submenu-arrow" src="${html_encode(window.icons['chevron-right.svg'])}"><img class="submenu-arrow submenu-arrow-active" src="${html_encode(window.icons['chevron-right-active.svg'])}">`;
                    h += `</li>`;
                }
            }
            // divider
            else if(options.items[i].is_divider || options.items[i] === '-')
                h += `<li class="context-menu-divider"><hr></li>`;
        }
    h += `</div>`
    $('body').append(h)

    const contextMenu = document.getElementById(`context-menu-${menu_id}`);
    const menu_width = $(contextMenu).width();
    const menu_height = $(contextMenu).outerHeight();
    let start_x, start_y;
    //--------------------------------
    // Auto position
    //--------------------------------
    if(!options.position){
        if(isMobile.phone || isMobile.tablet){
            start_x = window.last_touch_x;
            start_y = window.last_touch_y;

        }else{
            start_x = window.mouseX;
            start_y = window.mouseY;
        }
    }
    //--------------------------------
    // custom position
    //--------------------------------
    else{
        start_x = options.position.left;
        start_y = options.position.top;
    }

    // X position
    let x_pos;
    if( start_x + menu_width > window.innerWidth){
        x_pos = start_x - menu_width;
        // if this is a child menu, the width of parent must be also considered
        if(options.parent_id){
            x_pos -= $(`.context-menu[data-element-id="${options.parent_id}"]`).width() + 30;
        }
    }else
        x_pos = start_x

    // Y position
    let y_pos;
    // is the menu going to go out of the window from the bottom?
    if( (start_y + menu_height) > (window.innerHeight - window.taskbar_height - 10))
        y_pos = window.innerHeight - menu_height - window.taskbar_height - 10;
    else
        y_pos = start_y;

    // In the right position (the mouse)
    $(contextMenu).css({
        top: y_pos + "px",
        left: x_pos + "px"
    });

    // Some times we need to apply custom CSS to the context menu
    // This is different from the option flags for positioning and other basic styling
    // This is for more advanced styling , like adding a border radius or a shadow that don't merit a new option
    // Option flags should be reserved for essential styling that may have logic and sanitization attached to them
    if(options.css){
        $(contextMenu).css(options.css);
    }

    // Show ContextMenu
    if ( options?.delay === false) {
        $(contextMenu).show(0);
    } else if(options?.delay === true || options?.delay === 1 || options?.delay === undefined) {
        $(contextMenu).fadeIn(80).show(0);
    } else {
        $(contextMenu).fadeIn(options?.delay).show(0);
    }

    // mark other context menus as inactive
    $('.context-menu').not(contextMenu).removeClass('context-menu-active');

    let cancel_options_ = null;
    const fade_remove = (item) => {
        $(`#context-menu-${menu_id}, .context-menu[data-element-id="${$(item).closest('.context-menu').attr('data-parent-id')}"]`).fadeOut(200, function(){
            $(contextMenu).remove();
        });
    };
    const remove = () => {
        $(contextMenu).remove();
    };

    // An item is clicked
    $(`#context-menu-${menu_id} > li:not(.context-menu-item-disabled)`).on('click', function (e) {
        
        // onClick
        if(options.items[$(this).attr("data-action")].onClick && typeof options.items[$(this).attr("data-action")].onClick === 'function'){
            let event = e;
            event.value = options.items[$(this).attr("data-action")]['val'] ?? undefined;
            options.items[$(this).attr("data-action")].onClick(event);
        }
        // "action" - onClick without un-clonable pointer event
        else if(options.items[$(this).attr("data-action")].action && typeof options.items[$(this).attr("data-action")].action === 'function'){
            options.items[$(this).attr("data-action")].action();
        }
        // close menu and, if exists, its parent
        if(!$(this).hasClass('context-menu-item-submenu')){
            fade_remove(this);
        }
        return false;
    });

    // This will hold the timer for the submenu delay:
    // There is a delay in opening the submenu, this is to make sure that if the mouse is 
    // just passing over the item, the submenu doesn't open immediately.
    let submenu_delay_timer;

    // Initialize the menuAim plugin (../libs/jquery.menu-aim.js)
    $(contextMenu).menuAim({
        submenuSelector: ".context-menu-item-submenu",
        submenuDirection: function(){
            // If not submenu
            if(!options.is_submenu){
                // if submenu's left postiton is greater than main menu's left position
                if($(contextMenu).offset().left + 2 * $(contextMenu).width() + 15 < window.innerWidth ){     
                    return "right";
                } else {
                    return "left";
                }
            }
        },
        // activates item when mouse enters depending on mouse position and direction
        activate: function (e) {
            //activate items
            let item = $(e).closest('.context-menu-item');
            // mark other items as inactive
            $(contextMenu).find('.context-menu-item').removeClass('context-menu-item-active');
            // mark this item as active
            $(item).addClass('context-menu-item-active');
            // close any submenu that doesn't belong to this item
            $(`.context-menu[data-parent-id="${menu_id}"]`).remove();
            // mark this context menu as active
            $(contextMenu).addClass('context-menu-active');

            submenu_delay_timer = setTimeout(() => {
                // activate submenu
                // open submenu if applicable
                if($(e).hasClass('context-menu-item-submenu')){
                    let item_rect_box = e.getBoundingClientRect();
                    // open submenu only if it's not already open
                    if($(`.context-menu[data-id="${menu_id}-${$(e).attr('data-action')}"]`).length === 0){
                        // close other submenus
                        $(`.context-menu[parent-element-id="${menu_id}"]`).remove();

                        // Calculate the position for the submenu
                        let submenu_x_pos, submenu_y_pos;
                        if (isMobile.phone || isMobile.tablet) {
                            submenu_y_pos = y_pos;
                            submenu_x_pos = x_pos;
                        } else {
                            submenu_y_pos = item_rect_box.top - 5; 
                            submenu_x_pos = x_pos + item_rect_box.width + 15;
                        }

                        // open the new submenu
                        UIContextMenu({ 
                            items: options.items[parseInt($(e).attr('data-action'))].items,
                            parent_id: menu_id,
                            is_submenu: true,
                            id: menu_id + '-' + $(e).attr('data-action'),
                            position:{
                                top: submenu_y_pos,
                                left: submenu_x_pos,
                            } 
                        })
                    }
                }
            }, 300);
        },
        //deactivates row when mouse leaves
        deactivate: function (e) {
            // disable submenu delay timer
            clearTimeout(submenu_delay_timer);
            //deactivate submenu
            if($(e).hasClass('context-menu-item-submenu')){
                $(`.context-menu[data-id="${menu_id}-${$(e).attr('data-action')}"]`).remove();
            }
        }
    });
    
    // Useful in cases such as where a menu item is over a window, this prevents from the mousedown event
    // reaching the window underneath
    $(`#context-menu-${menu_id} > li:not(.context-menu-item-disabled)`).on('mousedown', function (e) {
        e.preventDefault();
        e.stopPropagation();
        return false;
    })

    // Disable parent scroll
    if(options.parent_element){
        $(options.parent_element).css('overflow', 'hidden');
        $(options.parent_element).parent().addClass('children-have-open-contextmenu');
        $(options.parent_element).addClass('has-open-contextmenu');
    }

    $(contextMenu).on("remove", function () {
        if(submenu_delay_timer) clearTimeout(submenu_delay_timer);
        if ( options.onClose ) options.onClose(cancel_options_);
        // when removing, make parent scrollable again
        if(options.parent_element){
            $(options.parent_element).parent().removeClass('children-have-open-contextmenu');

            // if the parent element is not a window, make it scrollable again
            if (!$(options.parent_element).hasClass('window-body')) {
                $(options.parent_element).css('overflow', 'scroll');
            }
            
            $(options.parent_element).removeClass('has-open-contextmenu');
            if($(options.parent_element).hasClass('taskbar-item')){
                window.make_taskbar_sortable()
            }
        }
    })
    $(contextMenu).on("contextmenu", function (e) {
        e.preventDefault();
        e.stopPropagation();
        return false;
    })

    return {
        cancel: (cancel_options) => {
            cancel_options_ = cancel_options;
            if ( cancel_options.fade === false ) {
                remove();
            } else {
                fade_remove();
            }
        },
        set onClose (fn) {
            options.onClose = fn;
        }
    };
}

window.select_ctxmenu_item = function ($ctxmenu_item){
    // remove active class from other items
    $($ctxmenu_item).siblings('.context-menu-item').removeClass('context-menu-item-active');
    // add active class to the selected item
    $($ctxmenu_item).addClass('context-menu-item-active');
}

export default UIContextMenu;


