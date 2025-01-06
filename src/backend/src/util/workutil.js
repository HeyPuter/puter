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
class WorkList {
    constructor () {
        this.locked_ = false;
        this.items = [];
    }
    
    list () {
        return [...this.items];
    }
    
    clear_invalid () {
        const new_items = [];
        for ( const item of this.items ) {
            if ( item.invalid ) continue;
            new_items.push(item);
        }
        this.items = new_items;
    }
    
    push (item) {
        if ( this.locked_ ) {
            throw new Error(
                'work items were already locked in; what are you doing?'
            );
        }
        this.items.push(item);
    }
    
    lockin () {
        this.locked_ = true;
    }
}

module.exports = {
    WorkList,
};
