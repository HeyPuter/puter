/*
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
class MultiDetachable {
    constructor() {
        this.delegates = [];
        this.detached_ = false;
    }
    
    add (delegate) {
        if ( this.detached_ ) {
            delegate.detach();
            return;
        }

        this.delegates.push(delegate);
    }
    
    detach () {
        this.detached_ = true;
        for ( const delegate of this.delegates ) {
            delegate.detach();
        }
    }
}

class AlsoDetachable {
    constructor () {
        this.also = () => {};
    }

    also (also) {
        this.also = also;
        return this;
    }
    
    detach () {
        this.detach_();
        this.also();
    }
}

// TODO: this doesn't work, but I don't know why yet.
class RemoveFromArrayDetachable extends AlsoDetachable {
    constructor (array, element) {
        super();
        this.array = array;
        this.element = element;
    }
    
    detach_ () {
        for ( let i=0; i < 10; i++ ) console.log('THIS DOES GET CALLED');
        const index = this.array.indexOf(this.element);
        if ( index !== -1 ) {
            this.array.splice(index, 1);
        }
    }
}

module.exports = {
    MultiDetachable,
    RemoveFromArrayDetachable,
};
