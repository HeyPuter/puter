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
export class HistoryManager {
    constructor ({ enableLogging = false } = {}) {
        this.items = [];
        this.index_ = 0;
        this.listeners_ = {};
        this.enableLogging_ = enableLogging;
    }

    log (...a) {
        // TODO: Command line option for configuring logging
        if ( this.enableLogging_ ) {
            console.log('[HistoryManager]', ...a);
        }
    }

    get index () {
        return this.index_;
    }

    set index (v) {
        this.log('setting index', v);
        this.index_ = v;
    }

    get () {
        return this.items[this.index];
    }

    // Save, overwriting the current history item
    save (data, { opt_debug } = {}) {
        this.log('saving', data, 'at', this.index, ...(opt_debug ? [ 'from', opt_debug ] : []));
        this.items[this.index] = data;

        if ( this.listeners_.hasOwnProperty('add') ) {
            for ( const listener of this.listeners_.add ) {
                listener(data);
            }
        }
    }

    append (data) {
        if (
            this.items.length !== 0 &&
            this.index !== this.items.length
        ) {
            this.log('POP');
            // remove last item
            this.items.pop();
        }
        this.index = this.items.length;
        this.save(data, { opt_debug: 'append' });
        this.index++;
    }

    on (topic, listener) {
        if ( ! this.listeners_.hasOwnProperty(topic) ) {
            this.listeners_[topic] = [];
        }
        this.listeners_[topic].push(listener);
    }
}