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

const update_mouse_position = function (x, y) {
    window.mouseX = x;
    window.mouseY = y;

    // mouse in top-left corner of screen
    if ( (window.mouseX < 150 && window.mouseY < window.toolbar_height + 20) || (window.mouseX < 20 && window.mouseY < 150) )
    {
        window.current_active_snap_zone = 'nw';
    }
    // mouse in left edge of screen
    else if ( window.mouseX < 20 && window.mouseY >= 150 && window.mouseY < window.desktop_height - 150 )
    {
        window.current_active_snap_zone = 'w';
    }
    // mouse in bottom-left corner of screen
    else if ( window.mouseX < 20 && window.mouseY > window.desktop_height - 150 )
    {
        window.current_active_snap_zone = 'sw';
    }
    // mouse in right edge of screen
    else if ( window.mouseX > window.desktop_width - 20 && window.mouseY >= 150 && window.mouseY < window.desktop_height - 150 )
    {
        window.current_active_snap_zone = 'e';
    }
    // mouse in top-right corner of screen
    else if ( (window.mouseX > window.desktop_width - 150 && window.mouseY < window.toolbar_height + 20) || (window.mouseX > window.desktop_width - 20 && window.mouseY < 150) )
    {
        window.current_active_snap_zone = 'ne';
    }
    // mouse in bottom-right corner of screen
    else if ( window.mouseX > window.desktop_width - 20 && window.mouseY >= window.desktop_height - 150 )
    {
        window.current_active_snap_zone = 'se';
    }
    // mouse in top edge of screen
    else if ( window.mouseY < window.toolbar_height + 20 && window.mouseX >= 150 && window.mouseX < window.desktop_width - 150 )
    {
        window.current_active_snap_zone = 'n';
    }
    // not in any snap zone
    else
    {
        window.current_active_snap_zone = undefined;
    }

    // mouseover_window
    var windows = document.getElementsByClassName('window');
    let active_win;
    if ( windows.length > 0 ) {
        let highest_window_zindex = 0;
        for ( let i = 0; i < windows.length; i++ ) {
            const rect = windows[i].getBoundingClientRect();
            if ( window.mouseX > rect.x && window.mouseX < (rect.x + rect.width) && window.mouseY > rect.y && window.mouseY < (rect.y + rect.height) ) {
                if ( parseInt($(windows[i]).css('z-index')) >= highest_window_zindex ) {
                    active_win = windows[i];
                    highest_window_zindex = parseInt($(windows[i]).css('z-index'));
                }
            }
        }
    }
    window.mouseover_window = active_win;

    // mouseover_item_container
    var item_containers = document.getElementsByClassName('item-container');
    let active_ic;
    if ( item_containers.length > 0 ) {
        let highest_window_zindex = 0;
        for ( let i = 0; i < item_containers.length; i++ ) {
            const rect = item_containers[i].getBoundingClientRect();
            if ( window.mouseX > rect.x && window.mouseX < (rect.x + rect.width) && window.mouseY > rect.y && window.mouseY < (rect.y + rect.height) ) {
                let active_container_zindex = parseInt($(item_containers[i]).closest('.window').css('z-index'));
                if ( !isNaN(active_container_zindex) && active_container_zindex >= highest_window_zindex ) {
                    active_ic = item_containers[i];
                    highest_window_zindex = active_container_zindex;
                }
            }
        }
    }
    window.mouseover_item_container = active_ic;

};

export default update_mouse_position;