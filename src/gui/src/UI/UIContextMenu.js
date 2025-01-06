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


/**
 * menu-aim is a jQuery plugin for dropdown menus that can differentiate
 * between a user trying hover over a dropdown item vs trying to navigate into
 * a submenu's contents.
 *
 * menu-aim assumes that you have are using a menu with submenus that expand
 * to the menu's right. It will fire events when the user's mouse enters a new
 * dropdown item *and* when that item is being intentionally hovered over.
 *
 * __________________________
 * | Monkeys  >|   Gorilla  |
 * | Gorillas >|   Content  |
 * | Chimps   >|   Here     |
 * |___________|____________|
 *
 * In the above example, "Gorillas" is selected and its submenu content is
 * being shown on the right. Imagine that the user's cursor is hovering over
 * "Gorillas." When they move their mouse into the "Gorilla Content" area, they
 * may briefly hover over "Chimps." This shouldn't close the "Gorilla Content"
 * area.
 *
 * This problem is normally solved using timeouts and delays. menu-aim tries to
 * solve this by detecting the direction of the user's mouse movement. This can
 * make for quicker transitions when navigating up and down the menu. The
 * experience is hopefully similar to amazon.com/'s "Shop by Department"
 * dropdown.
 *
 * Use like so:
 *
 *      $("#menu").menuAim({
 *          activate: $.noop,  // fired on row activation
 *          deactivate: $.noop  // fired on row deactivation
 *      });
 *
 *  ...to receive events when a menu's row has been purposefully (de)activated.
 *
 * The following options can be passed to menuAim. All functions execute with
 * the relevant row's HTML element as the execution context ('this'):
 *
 *      .menuAim({
 *          // Function to call when a row is purposefully activated. Use this
 *          // to show a submenu's content for the activated row.
 *          activate: function() {},
 *
 *          // Function to call when a row is deactivated.
 *          deactivate: function() {},
 *
 *          // Function to call when mouse enters a menu row. Entering a row
 *          // does not mean the row has been activated, as the user may be
 *          // mousing over to a submenu.
 *          enter: function() {},
 *
 *          // Function to call when mouse exits a menu row.
 *          exit: function() {},
 *
 *          // Selector for identifying which elements in the menu are rows
 *          // that can trigger the above events. Defaults to "> li".
 *          rowSelector: "> li",
 *
 *          // You may have some menu rows that aren't submenus and therefore
 *          // shouldn't ever need to "activate." If so, filter submenu rows w/
 *          // this selector. Defaults to "*" (all elements).
 *          submenuSelector: "*",
 *
 *          // Direction the submenu opens relative to the main menu. Can be
 *          // left, right, above, or below. Defaults to "right".
 *          submenuDirection: "right"
 *      });
 *
 * https://github.com/kamens/jQuery-menu-aim
*/
(function ($) {
    $.fn.menuAim = function (opts) {
        // Initialize menu-aim for all elements in jQuery collection
        this.each(function () {
            init.call(this, opts);
        });

        return this;
    };

    function init(opts) {
        var $menu = $(this),
            activeRow = null,
            mouseLocs = [],
            lastDelayLoc = null,
            timeoutId = null,
            options = $.extend({
                rowSelector: "> li",
                submenuSelector: "*",
                submenuDirection: $.noop,
                tolerance: 75,  // bigger = more forgivey when entering submenu
                enter: $.noop,
                exit: $.noop,
                activate: $.noop,
                deactivate: $.noop,
                exitMenu: $.noop
            }, opts);

        var MOUSE_LOCS_TRACKED = 3,  // number of past mouse locations to track
            DELAY = 300;  // ms delay when user appears to be entering submenu

        /**
         * Keep track of the last few locations of the mouse.
         */
        var mousemoveDocument = function (e) {
            mouseLocs.push({ x: e.pageX, y: e.pageY });

            if (mouseLocs.length > MOUSE_LOCS_TRACKED) {
                mouseLocs.shift();
            }
        };

        /**
         * Cancel possible row activations when leaving the menu entirely
         */
        var mouseleaveMenu = function () {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }

            // If exitMenu is supplied and returns true, deactivate the
            // currently active row on menu exit.
            if (options.exitMenu(this)) {
                if (activeRow) {
                    options.deactivate(activeRow);
                }

                activeRow = null;
            }
        };

        /**
         * Trigger a possible row activation whenever entering a new row.
         */
        var mouseenterRow = function (e, data) {
            if (timeoutId) {
                // Cancel any previous activation delays
                clearTimeout(timeoutId);
            }

            options.enter(this);
            possiblyActivate(this, e, data);
        },
            mouseleaveRow = function (e) {
                // if doesn't have submenu, remove active class and timer
                if(!$(e.target).hasClass('has-open-context-menu-submenu') && 
                    $(e.target).hasClass('context-menu-item-submenu'))
                {
                    $(e.target).removeClass('context-menu-item-active');
                    // remove timeout
                    clearTimeout(timeoutId);
                    activeRow = null;
                }

                options.exit(this);
            };

        /*
         * Immediately activate a row if the user clicks on it.
         */
        var clickRow = function () {
            activate(this);
        };

        /**
         * Activate a menu row.
         */
        var activate = function (row, e, data) {
            if(mouseLocs[mouseLocs.length - 1]?.x !== undefined && mouseLocs[mouseLocs.length - 1]?.y !== undefined){
                row.pageX = mouseLocs[mouseLocs.length - 1].x;
                row.pageY = mouseLocs[mouseLocs.length - 1].y;
            }

            if (row == activeRow && !data?.keyboard) {
                return;
            }

            if (activeRow) {
                options.deactivate(activeRow);
            }


            options.activate(row, e, data);
            activeRow = row;
        };

        /**
         * Possibly activate a menu row. If mouse movement indicates that we
         * shouldn't activate yet because user may be trying to enter
         * a submenu's content, then delay and check again later.
         */
        var possiblyActivate = function (row, e, data) {
            var delay = activationDelay();

            if (delay) {
                timeoutId = setTimeout(function () {
                    possiblyActivate(row, e, data);
                }, delay);
            } else {
                activate(row, e, data);
            }
        };

        /**
         * Return the amount of time that should be used as a delay before the
         * currently hovered row is activated.
         *
         * Returns 0 if the activation should happen immediately. Otherwise,
         * returns the number of milliseconds that should be delayed before
         * checking again to see if the row should be activated.
         */
        var activationDelay = function () {
            if (!activeRow || !$(activeRow).is(options.submenuSelector)) {
                // If there is no other submenu row already active, then
                // go ahead and activate immediately.
                return 0;
            }

            var offset = $menu.offset(),
                upperLeft = {
                    x: offset.left,
                    y: offset.top - options.tolerance
                },
                upperRight = {
                    x: offset.left + $menu.outerWidth(),
                    y: upperLeft.y
                },
                lowerLeft = {
                    x: offset.left,
                    y: offset.top + $menu.outerHeight() + options.tolerance
                },
                lowerRight = {
                    x: offset.left + $menu.outerWidth(),
                    y: lowerLeft.y
                },
                loc = mouseLocs[mouseLocs.length - 1],
                prevLoc = mouseLocs[0];

            if (!loc) {
                return 0;
            }

            if (!prevLoc) {
                prevLoc = loc;
            }

            if (prevLoc.x < offset.left || prevLoc.x > lowerRight.x ||
                prevLoc.y < offset.top || prevLoc.y > lowerRight.y) {
                // If the previous mouse location was outside of the entire
                // menu's bounds, immediately activate.
                return 0;
            }

            if (lastDelayLoc &&
                loc.x == lastDelayLoc.x && loc.y == lastDelayLoc.y) {
                // If the mouse hasn't moved since the last time we checked
                // for activation status, immediately activate.
                return 0;
            }

            // Detect if the user is moving towards the currently activated
            // submenu.
            //
            // If the mouse is heading relatively clearly towards
            // the submenu's content, we should wait and give the user more
            // time before activating a new row. If the mouse is heading
            // elsewhere, we can immediately activate a new row.
            //
            // We detect this by calculating the slope formed between the
            // current mouse location and the upper/lower right points of
            // the menu. We do the same for the previous mouse location.
            // If the current mouse location's slopes are
            // increasing/decreasing appropriately compared to the
            // previous's, we know the user is moving toward the submenu.
            //
            // Note that since the y-axis increases as the cursor moves
            // down the screen, we are looking for the slope between the
            // cursor and the upper right corner to decrease over time, not
            // increase (somewhat counterintuitively).
            function slope(a, b) {
                return (b.y - a.y) / (b.x - a.x);
            };

            var decreasingCorner = upperRight,
                increasingCorner = lowerRight;

            // Our expectations for decreasing or increasing slope values
            // depends on which direction the submenu opens relative to the
            // main menu. By default, if the menu opens on the right, we
            // expect the slope between the cursor and the upper right
            // corner to decrease over time, as explained above. If the
            // submenu opens in a different direction, we change our slope
            // expectations.
            if (options.submenuDirection() == "left") {
                decreasingCorner = lowerLeft;
                increasingCorner = upperLeft;
            } else if (options.submenuDirection() == "below") {
                decreasingCorner = lowerRight;
                increasingCorner = lowerLeft;
            } else if (options.submenuDirection() == "above") {
                decreasingCorner = upperLeft;
                increasingCorner = upperRight;
            }

            var decreasingSlope = slope(loc, decreasingCorner),
                increasingSlope = slope(loc, increasingCorner),
                prevDecreasingSlope = slope(prevLoc, decreasingCorner),
                prevIncreasingSlope = slope(prevLoc, increasingCorner);

            if (decreasingSlope < prevDecreasingSlope &&
                increasingSlope > prevIncreasingSlope) {
                // Mouse is moving from previous location towards the
                // currently activated submenu. Delay before activating a
                // new menu row, because user may be moving into submenu.
                lastDelayLoc = loc;
                return DELAY;
            }

            lastDelayLoc = null;
            return 0;
        };

        $menu.on('mouseenter', function(e, data) {
            if($menu.find('.context-menu-item-active').length === 0 && $menu.find('.has-open-context-menu-submenu').length === 0)
                activeRow = null;
        })
        /**
         * Hook up initial menu events
         */
        $menu
            .mouseleave(mouseleaveMenu)
            .find(options.rowSelector)
            .mouseenter(mouseenterRow)
            .mouseleave(mouseleaveRow)
            .click(clickRow);

        $(document).mousemove(mousemoveDocument);

    };
})(jQuery);

/**
 * Creates and manages a context menu UI component with support for nested submenus.
 * The menu supports keyboard navigation, touch events, and intelligent submenu positioning.
 * 
 * @param {Object} options - Configuration options for the context menu
 * @param {Array<Object|string>} options.items - Array of menu items or dividers ('-')
 * @param {string} options.items[].html - HTML content for the menu item
 * @param {string} [options.items[].html_active] - HTML content when item is active/hovered
 * @param {string} [options.items[].icon] - Icon for the menu item
 * @param {string} [options.items[].icon_active] - Icon when item is active/hovered
 * @param {boolean} [options.items[].disabled] - Whether the item is disabled
 * @param {boolean} [options.items[].checked] - Whether to show a checkmark
 * @param {Function} [options.items[].onClick] - Click handler with event parameter
 * @param {Function} [options.items[].action] - Alternative click handler without event parameter
 * @param {Array<Object>} [options.items[].items] - Nested submenu items
 * @param {string} [options.id] - Unique identifier for the menu
 * @param {Object} [options.position] - Custom positioning for the menu
 * @param {number} options.position.top - Top position in pixels
 * @param {number} options.position.left - Left position in pixels
 * @param {boolean|number} [options.delay] - Animation delay for menu appearance
 *                                          true/1/undefined = 50ms fade
 *                                          false = no animation
 *                                          number = custom fade duration
 * @param {Object} [options.css] - Additional CSS properties to apply to menu
 * @param {HTMLElement} [options.parent_element] - Parent element for the menu
 * @param {string} [options.parent_id] - ID of parent menu for nested menus
 * @param {boolean} [options.is_submenu] - Whether this is a nested submenu, default: false
 * @param {Function} [options.onClose] - Callback function when menu closes
 * 
 * @example
 * // Basic usage with simple items
 * UIContextMenu({
 *   items: [
 *     { html: 'Copy', icon: '📋', onClick: () => console.log('Copy clicked') },
 *     '-', // divider
 *     { html: 'Paste', icon: '📌', disabled: true }
 *   ]
 * });
 * 
 * @example
 * // Usage with nested submenus and custom positioning
 * UIContextMenu({
 *   position: { top: 100, left: 200 },
 *   items: [
 *     { 
 *       html: 'File',
 *       items: [
 *         { html: 'New', icon: '📄' },
 *         { html: 'Open', icon: '📂' }
 *       ]
 *     },
 *     { 
 *       html: 'Edit',
 *       items: [
 *         { html: 'Cut', icon: '✂️' },
 *         { html: 'Copy', icon: '📋' }
 *       ]
 *     }
 *   ]
 * });
 * 
 * @example
 * // Usage with menu controller
 * const menu = UIContextMenu({
 *   items: [{ html: 'Close', onClick: () => menu.cancel() }]
 * });
 * menu.onClose = () => console.log('Menu closed');
 * 
 * @fires ctxmenu-will-open - Dispatched on window before menu opens
 * @listens mousemove - Tracks mouse position for submenu positioning
 * @listens click - Handles menu item selection
 * @listens contextmenu - Prevents default context menu
 * @listens mouseenter - Handles submenu activation
 * @listens mouseleave - Handles menu item deactivation
 * 
 * @requires jQuery
 * @requires jQuery-menu-aim
 */

function UIContextMenu(options){
    $('.window-active .window-app-iframe').css('pointer-events', 'none');

    const menu_id = window.global_element_id++;

    // Dispatch 'ctxmenu-will-open' event 
    window.dispatchEvent(new CustomEvent('ctxmenu-will-open', { detail: { options: options} }));

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
                        h += `<span class="contextmenu-label">${html_encode(options.items[i].html)}</span>`;
                        h += `<span class="contextmenu-label-active">${html_encode(options.items[i].html_active ?? options.items[i].html)}</span>`;
                        // arrow
                        h += `<img class="submenu-arrow" src="${html_encode(window.icons['chevron-right.svg'])}"><img class="submenu-arrow submenu-arrow-active" src="${html_encode(window.icons['chevron-right-active.svg'])}">`;
                    h += `</li>`;
                }
            }
            // divider
            else if(options.items[i].is_divider || options.items[i] === '-')
                h += `<li class="context-menu-item context-menu-divider"><hr></li>`;
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
        // if this is a child menu, the width of parent must also be considered
        if(options.parent_id && $(`.context-menu[data-element-id="${options.parent_id}"]`).length > 0){
            x_pos -= $(`.context-menu[data-element-id="${options.parent_id}"]`).width() + 30;
        }
    }else{
        x_pos = start_x
    }

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
        $(contextMenu).fadeIn(50).show(0);
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
    $(document).on('click', `#context-menu-${menu_id} > li:not(.context-menu-item-disabled)`, function (e) {
        
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

    // Initialize the menuAim plugin
    $(contextMenu).menuAim({
        rowSelector: ".context-menu-item",
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
        enter: function (e) {
            // activate items
            // this.activate(e);
        },
        // activates item when mouse enters depending on mouse position and direction
        activate: function (e, event, data) {
            // make sure last recorded mouse position is the same as the current one before activating
            // this is because switching contexts from iframe to window can cause the mouse position to be off
            if(!data?.keyboard && (e.pageX !== window.mouseX || e.pageY !== window.mouseY)){
                return;
            }
            // activate items
            let item = $(e).closest('.context-menu-item');
            // mark other menu items as inactive
            $(contextMenu).find('.context-menu-item').removeClass('context-menu-item-active');
            // mark this menu item as active
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
                        // add `has-open-context-menu-submenu` class to the parent menu item
                        $(e).addClass('has-open-context-menu-submenu');

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
        // deactivates row when mouse leaves
        deactivate: function (e) {
            // disable submenu delay timer to cancel submenu opening
            clearTimeout(submenu_delay_timer);
            // close submenu
            if($(e).hasClass('has-open-context-menu-submenu')){
                $(`.context-menu[data-id="${menu_id}-${$(e).attr('data-action')}"]`).remove();
                // remove `has-open-context-menu-submenu` class from the parent menu item
                $(e).removeClass('has-open-context-menu-submenu');
            }
        },
        exit: function (e) {
            clearTimeout(submenu_delay_timer);
            $(e.target).removeClass('context-menu-item-active');
        },
    });
    
    // disabled item mousedown event
    $(`#context-menu-${menu_id} > li.context-menu-item-disabled`).on('mousedown', function (e) {
        e.preventDefault();
        e.stopPropagation();
        return false;
    })

    // Useful in cases such as where a menu item is over a window, this prevents the mousedown event from
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

            // make parent scrollable again
            $(options.parent_element).css('overflow', 'scroll');
            
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

    $(contextMenu).on("mouseleave", function (e) {
        $(contextMenu).find('.context-menu-item').removeClass('context-menu-item-active');
        clearTimeout(submenu_delay_timer);
    })

    $(contextMenu).on("mouseenter", function (e) {
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
    // remove `has-open-context-menu-submenu` class from other items
    $($ctxmenu_item).siblings('.context-menu-item').removeClass('has-open-context-menu-submenu');
    // add active class to the selected item
    $($ctxmenu_item).addClass('context-menu-item-active');
}

$(document).on('mouseleave', '.context-menu', function(){
    // when mouse leaves the context menu, remove active class from all items
    $(this).find('.context-menu-item').removeClass('context-menu-item-active');
})

$(document).on('mouseenter', '.context-menu', function(e){
    // when mouse enters the context menu, convert all items with submenu to active
    $(this).find('.has-open-context-menu-submenu').each(function(){
        $(this).addClass('context-menu-item-active');
    })
})

$(document).on('mouseenter', '.context-menu-item', function(e, data){
})

$(document).on('mouseenter', '.context-menu-divider', function(e){
    // unselect all items
    $(this).siblings('.context-menu-item:not(.has-open-context-menu-submenu)').removeClass('context-menu-item-active');
})

export default UIContextMenu;