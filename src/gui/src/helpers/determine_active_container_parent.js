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

const determine_active_container_parent = function(){
    // the container is either an ancestor of active element...
    let parent_container = $(window.active_element).closest('.item-container');
    // ... or a descendant of it...
    if(parent_container.length === 0){
        parent_container = $(window.active_element).find('.item-container');
    }
    // ... or siblings or cousins
    if(parent_container.length === 0){
        parent_container = $(window.active_element).closest('.window').find('.item-container');
    }
    // ... or the active element itself (if it's a container)
    if(parent_container.length === 0 && window.active_element && $(window.active_element).hasClass('item-container')){
        parent_container = $(window.active_element);
    }
    // ... or if there is no active element, the selected item that is not blurred
    if(parent_container.length === 0 && window.active_item_container){
        parent_container = window.active_item_container;
    }

    return parent_container;
}

export default determine_active_container_parent;