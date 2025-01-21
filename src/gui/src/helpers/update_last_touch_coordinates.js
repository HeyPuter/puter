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
 * Updates the last touch coordinates based on the event type.
 * If the event is 'touchstart', it takes the coordinates from the touch object.
 * If the event is 'mousedown', it takes the coordinates directly from the event object.
 *
 * @param {Event} e - The event object containing information about the touch or mouse event.
 */
const update_last_touch_coordinates = (e)=>{
    if(e.type == 'touchstart'){
        var touch = e.originalEvent.touches[0] || e.originalEvent.changedTouches[0];
        window.last_touch_x = touch.pageX;
        window.last_touch_y = touch.pageY;
    } else if (e.type == 'mousedown') {
        window.last_touch_x = e.clientX;
        window.last_touch_y = e.clientY;
    }
}

export default update_last_touch_coordinates;