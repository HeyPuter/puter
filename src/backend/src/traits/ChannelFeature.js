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

// name: 'Channel' does not behave the same as Golang's channel construct; it
//   behaves more like an EventEmitter.
class Channel {
    constructor () {
        this.listeners_ = [];
    }

    // compare(EventService): EventService has an 'on' method,
    //   but it accepts a 'selector' argument to narrow the scope of events
    on (callback) {
        // wet: EventService also creates an object like this
        const det = {
            detach: () => {
                const idx = this.listeners_.indexOf(callback);
                if ( idx !== -1 ) {
                    this.listeners_.splice(idx, 1);
                }
            }
        };

        this.listeners_.push(callback);

        return det;
    }

    emit (...a) {
        for ( const lis of this.listeners_ ) {
            lis(...a);
        }
    }
}

class ChannelFeature {
    install_in_instance (instance) {
        const channels = instance._get_merged_static_array('CHANNELS');

        instance.channels = {};
        for ( const name of channels ) {
            instance.channels[name] = new Channel(name);
        }
    }
}

module.exports = {
    ChannelFeature,
};
