/*
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

import UITaskbarItem from './UITaskbarItem.js';
import launch_app from '../helpers/launchApp.js';
import { appIconSrc } from '../helpers/appIcon.js';

const TASKBAR_POSITIONS = ['left', 'bottom', 'right'];

async function UITaskbar (options) {
    window.global_element_id++;

    options = options ?? {};
    options.content = options.content ?? '';

    let taskbar_position;

    // if first visit ever, set taskbar position to left
    if ( window.first_visit_ever ) {
        puter.kv.set('taskbar_position', 'left').catch(err => console.warn('Could not save taskbar_position:', err));
        taskbar_position = 'left';
    } else {
        taskbar_position = await puter.kv.get('taskbar_position').catch(() => null);
        // if this is not first visit, set taskbar position to bottom since it's from a user that
        // used puter before customizing taskbar position was added and the taskbar position was set to bottom
        // Unknown values are discarded too: this ends up in markup and stored values may be poisoned.
        if ( ! TASKBAR_POSITIONS.includes(taskbar_position) ) {
            taskbar_position = 'bottom'; // default position
            puter.kv.set('taskbar_position', taskbar_position).catch(err => console.warn('Could not save taskbar_position:', err));
        }
    }

    // Force bottom position on mobile devices
    if ( isMobile.phone || isMobile.tablet ) {
        taskbar_position = 'bottom';
    }

    // Set global taskbar position
    window.taskbar_position = taskbar_position;

    let h = '';
    h += `<div id="ui-taskbar_${window.global_element_id}" class="taskbar taskbar-position-${taskbar_position}" style="height:${window.taskbar_height}px;">`;
    h += '<div class="taskbar-sortable" style="display: flex; justify-content: center; z-index: 99999;"></div>';
    h += '</div>';

    if ( taskbar_position === 'left' || taskbar_position === 'right' ) {
        $('.desktop').addClass(`desktop-taskbar-position-${taskbar_position}`);
    }

    $('.desktop').append(h);

    //---------------------------------------------
    // add `Explorer` to the taskbar
    //---------------------------------------------
    UITaskbarItem({
        icon: window.icons['folders.svg'],
        app: 'explorer',
        name: 'Explorer',
        sortable: false,
        keep_in_taskbar: true,
        lock_keep_in_taskbar: true,
        onClick: function () {
            let open_window_count = parseInt($('.taskbar-item[data-app="explorer"]').attr('data-open-windows'));
            if ( open_window_count === 0 ) {
                launch_app({ name: 'explorer', path: window.home_path });
            } else {
                return false;
            }
        },
    });

    //---------------------------------------------
    // add separator before trash
    //---------------------------------------------
    UITaskbarItem({
        icon: '', // No icon for separator
        name: 'separator',
        app: 'separator',
        sortable: false,
        keep_in_taskbar: true,
        lock_keep_in_taskbar: true,
        disable_context_menu: true,
        style: 'pointer-events: none;', // Make it non-interactive
        onClick: function () {
            // Separator is non-interactive
            return false;
        },
    });

    //---------------------------------------------
    // Add other useful apps to the taskbar
    //---------------------------------------------
    if ( window.user.taskbar_items && window.user.taskbar_items.length > 0 ) {
        for ( let index = 0; index < window.user.taskbar_items.length; index++ ) {
            const app_info = window.user.taskbar_items[index];
            const icon = appIconSrc(app_info);
            // add taskbar item for each app
            UITaskbarItem({
                icon: icon.src,
                iconFallback: icon.fallback,
                app: app_info.name,
                name: app_info.title,
                keep_in_taskbar: true,
                onClick: function () {
                    let open_window_count = parseInt($(`.taskbar-item[data-app="${app_info.name}"]`).attr('data-open-windows'));
                    if ( open_window_count === 0 ) {
                        launch_app({
                            name: app_info.name,
                        });
                    } else {
                        return false;
                    }
                },
            });
        }
    }

    //---------------------------------------------
    // add `Trash` to the taskbar
    //---------------------------------------------
    const trash = await puter.fs.stat({ path: window.trash_path, consistency: 'eventual' });
    if ( window.socket ) {
        window.socket.emit('trash.is_empty', { is_empty: trash.is_empty });
    }

    UITaskbarItem({
        icon: trash.is_empty ? window.icons['trash.svg'] : window.icons['trash-full.svg'],
        app: 'trash',
        name: `${i18n('trash')}`,
        sortable: false,
        keep_in_taskbar: true,
        lock_keep_in_taskbar: true,
        onClick: function () {
            let open_windows = $(`.window[data-path="${html_encode(window.trash_path)}"]`);
            if ( open_windows.length === 0 ) {
                launch_app({ name: 'explorer', path: window.trash_path });
            } else {
                open_windows.focusWindow();
            }
        },
        onItemsDrop: function (items) {
            window.move_items(items, window.trash_path);
        },
    });

    //---------------------------------------------
    // add separator before trash
    //---------------------------------------------
    UITaskbarItem({
        icon: '', // No icon for separator
        name: 'separator',
        app: 'separator',
        sortable: false,
        keep_in_taskbar: true,
        lock_keep_in_taskbar: true,
        disable_context_menu: true,
        style: 'pointer-events: none;', // Make it non-interactive
        onClick: function () {
            // Separator is non-interactive
            return false;
        },
    });

    window.make_taskbar_sortable();
}

//-------------------------------------------
// Taskbar is sortable
//-------------------------------------------
window.make_taskbar_sortable = function () {
    const position = window.taskbar_position || 'bottom';
    const axis = position === 'bottom' ? 'x' : 'y';

    $('.taskbar-sortable').sortable({
        axis: axis,
        items: '.taskbar-item-sortable:not(.has-open-contextmenu):not([data-app="separator"])',
        cancel: '.has-open-contextmenu',
        placeholder: 'taskbar-item-sortable-placeholder',
        helper: 'clone',
        distance: 5,
        revert: 10,
        update: function (event, ui) {
            // only update the DB if the sorted item is pinned
            if ( $(ui.item).attr('data-keep-in-taskbar') === 'true' ) {
                window.update_taskbar();
            }
        },
    });
};

// Function to update taskbar position
window.update_taskbar_position = async function (new_position) {
    // Prevent position changes on mobile devices - always keep bottom
    if ( isMobile.phone || isMobile.tablet ) {
        return;
    }

    if ( ! TASKBAR_POSITIONS.includes(new_position) ) {
        return;
    }

    // Store the new position
    puter.kv.set('taskbar_position', new_position).catch(err => console.warn('Could not save taskbar_position:', err));
    window.taskbar_position = new_position;

    // Remove old position classes and add new one
    $('.taskbar').removeClass('taskbar-position-left taskbar-position-bottom taskbar-position-right');
    $('.taskbar').addClass(`taskbar-position-${new_position}`);

    // update desktop class, if left or right, add `desktop-taskbar-position-left` or `desktop-taskbar-position-right`
    $('.desktop').removeClass('desktop-taskbar-position-left');
    $('.desktop').removeClass('desktop-taskbar-position-right');
    $('.desktop').addClass(`desktop-taskbar-position-${new_position}`);

    // Update desktop height/width calculations based on new position
    window.update_desktop_dimensions_for_taskbar();

    // Update window positions if needed (for maximized windows)
    $('.window[data-is_maximized="1"]').each(function () {
        const el_window = this;
        window.update_maximized_window_for_taskbar(el_window);
    });

    // Re-initialize sortable with correct axis
    $('.taskbar-sortable').sortable('destroy');
    window.make_taskbar_sortable();

    // Adjust taskbar item sizes for the new position
    setTimeout(() => {
        window.adjust_taskbar_item_sizes();
    }, 10);

    // Reinitialize all taskbar item tooltips with new position
    $('.taskbar-item').each(function () {
        const $item = $(this);
        // Destroy existing tooltip
        if ( $item.data('ui-tooltip') ) {
            $item.tooltip('destroy');
        }

        // Helper function to get tooltip position based on taskbar position
        function getTooltipPosition () {
            const taskbarPosition = window.taskbar_position || 'bottom';

            if ( taskbarPosition === 'bottom' ) {
                return {
                    my: 'center bottom-20',
                    at: 'center top',
                };
            } else if ( taskbarPosition === 'top' ) {
                return {
                    my: 'center top+20',
                    at: 'center bottom',
                };
            } else if ( taskbarPosition === 'left' ) {
                return {
                    my: 'left+20 center',
                    at: 'right center',
                };
            } else if ( taskbarPosition === 'right' ) {
                return {
                    my: 'right-20 center',
                    at: 'left center',
                };
            }
            return {
                my: 'center bottom-20',
                at: 'center top',
            }; // fallback
        }

        const tooltipPosition = getTooltipPosition();

        // Reinitialize tooltip with new position
        $item.tooltip({
            items: ".taskbar:not(.children-have-open-contextmenu) .taskbar-item:not([data-app='separator'])",
            position: {
                my: tooltipPosition.my,
                at: tooltipPosition.at,
                using: function ( position, feedback ) {
                    $(this).css( position);
                    $('<div>')
                        .addClass( 'arrow')
                        .addClass( feedback.vertical)
                        .addClass( feedback.horizontal)
                        .appendTo( this);
                },
            },
        });
    });
};

// Function to update desktop dimensions based on taskbar position
window.update_desktop_dimensions_for_taskbar = function () {
    const position = window.taskbar_position || 'bottom';

    if ( position === 'bottom' ) {
        $('.desktop').css({
            'height': `calc(100vh - ${window.taskbar_height + window.toolbar_height}px)`,
            'width': '100%',
            'left': '0',
            'top': `${window.toolbar_height}px`,
        });
    } else if ( position === 'left' ) {
        $('.desktop').css({
            'height': `calc(100vh - ${window.toolbar_height}px)`,
            'width': `calc(100% - ${window.taskbar_height}px)`,
            'left': `${window.taskbar_height}px`,
            'top': `${window.toolbar_height}px`,
        });
    } else if ( position === 'right' ) {
        $('.desktop').css({
            'height': `calc(100vh - ${window.toolbar_height}px)`,
            'width': `calc(100% - ${window.taskbar_height}px)`,
            'left': '0',
            'top': `${window.toolbar_height}px`,
        });
    }
};

//-------------------------------------------
// Dynamic taskbar item resizing for left/right positions
//-------------------------------------------
window.adjust_taskbar_item_sizes = function () {
    const position = window.taskbar_position || 'bottom';

    // Only apply to left and right positions
    if ( position !== 'left' && position !== 'right' ) {
        // Reset to default sizes for bottom position
        $('.taskbar .taskbar-item').css({
            'width': '40px',
            'height': '40px',
            'min-width': '40px',
            'min-height': '40px',
        });
        $('.taskbar-icon').css('height', '40px');
        return;
    }

    const taskbar = $('.taskbar')[0];
    const taskbarItems = $('.taskbar .taskbar-item:visible');

    if ( !taskbar || taskbarItems.length === 0 ) return;

    // Get available height (minus padding)
    const totalItemsNeeded = taskbarItems.length;
    const taskbarHeight = taskbar.clientHeight;
    const paddingTop = 20; // from CSS
    const paddingBottom = 20; // from CSS
    const availableHeight = taskbarHeight - paddingTop - paddingBottom - 180;

    // Calculate space needed with default sizes
    const defaultItemSize = 40;
    const defaultMargin = 5;
    const spaceNeededDefault = (totalItemsNeeded * defaultItemSize) + ((totalItemsNeeded - 1) * defaultMargin);

    if ( spaceNeededDefault <= availableHeight ) {
        // No overflow, use default sizes
        taskbarItems.css({
            'width': '40px',
            'height': '40px',
            'min-width': '40px',
            'min-height': '40px',
            'padding': '6px 5px 10px 5px', // default padding
        });
        $('.taskbar-icon').css('height', `${defaultItemSize }px`);
        $('.taskbar-icon').css('width', '40px');
        $('.taskbar-icon > img').css('width', 'auto');
        $('.taskbar-icon > img').css('margin', 'auto');
        $('.taskbar-icon > img').css('display', 'block');

        // Reset margins to default
        taskbarItems.css('margin-bottom', '5px');
        taskbarItems.last().css('margin-bottom', '0px');
    } else {
        // Overflow detected, calculate smaller sizes
        // Reserve some margin space (minimum 2px between items)
        const minMargin = 2;
        const marginSpace = (totalItemsNeeded - 1) * minMargin;
        const availableForItems = availableHeight - marginSpace;
        const newItemSize = Math.floor(availableForItems / totalItemsNeeded);

        // Ensure minimum size of 20px
        const finalItemSize = Math.max(20, newItemSize);

        // Calculate proportional padding based on size ratio
        const sizeRatio = finalItemSize / defaultItemSize;
        const paddingTop = Math.max(1, Math.floor(6 * sizeRatio));
        const paddingRight = Math.max(1, Math.floor(5 * sizeRatio));
        const paddingBottom = Math.max(1, Math.floor(10 * sizeRatio));
        const paddingLeft = Math.max(1, Math.floor(5 * sizeRatio));

        // Apply new sizes and padding
        taskbarItems.css({
            'width': '40px',
            'height': `${finalItemSize }px`,
            'min-width': '40px',
            'min-height': `${finalItemSize }px`,
            'padding': `${paddingTop}px ${paddingRight}px ${paddingBottom}px ${paddingLeft}px`,
        });
        $('.taskbar-icon').css('height', `${finalItemSize }px`);
        $('.taskbar-icon').css('width', '40px');
        $('.taskbar-icon > img').css('width', 'auto');
        $('.taskbar-icon > img').css('margin', 'auto');
        $('.taskbar-icon > img').css('display', 'block');
        // Adjust margins
        taskbarItems.css('margin-bottom', `${minMargin }px`);
        taskbarItems.last().css('margin-bottom', '0px');
    }
};

// Hook into existing taskbar functionality
$(document).ready(function () {
    // Watch for taskbar item changes
    const observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
            if ( mutation.type === 'childList' || mutation.type === 'attributes' ) {
                // Delay to ensure DOM updates are complete
                setTimeout(() => {
                    window.adjust_taskbar_item_sizes();
                }, 10);
            }
        });
    });

    // Start observing when taskbar is available
    const checkTaskbar = setInterval(() => {
        const taskbar = document.querySelector('.taskbar-sortable');
        if ( taskbar ) {
            observer.observe(taskbar, {
                childList: true,
                attributes: true,
                subtree: true,
            });
            clearInterval(checkTaskbar);

            // Initial call
            setTimeout(() => {
                window.adjust_taskbar_item_sizes();
            }, 100);
        }
    }, 100);

    // Also watch for window resize events
    window.addEventListener('resize', () => {
        setTimeout(() => {
            window.adjust_taskbar_item_sizes();
        }, 10);
    });
});

export default UITaskbar;
