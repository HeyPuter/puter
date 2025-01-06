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
/**
 * Holds an observable value.
 */
export default class ValueHolder {
    constructor (initial_value) {
        this.value_ = null;
        this.listeners_ = [];

        Object.defineProperty(this, 'value', {
            set: this.set_.bind(this),
            get: this.get_.bind(this),
        });

        if (initial_value !== undefined) {
            this.set(initial_value);
        }
    }

    static adapt (value) {
        if (value instanceof ValueHolder) {
            return value;
        } else {
            return new ValueHolder(value);
        }
    }

    set (value) {
        this.value = value;
    }

    get () {
        return this.value;
    }

    sub (listener) {
        this.listeners_.push(listener);
    }

    set_ (value) {
        const old_value = this.value_;
        this.value_ = value;
        const more = {
            holder: this,
            old_value,
        };
        this.listeners_.forEach(listener => listener(value, more));
    }

    get_ () {
        return this.value_;
    }

    map (fn) {
        const holder = new ValueHolder();
        this.sub((value, more) => holder.set(fn(value, more)));
        return holder;
    }
}
