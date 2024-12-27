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
class Getter {
    static adapt (v) {
        if ( typeof v === 'function' ) return v;
        return () => v;
    }
}

const LinearByCountGetter = ({ initial, slope, pre = false }) => {
    let value = initial;
    return () => {
        if ( pre ) value += slope;
        let v = value;
        if ( ! pre ) value += slope;
        return v;
    }
}

const ConstantGetter = ({ initial }) => () => initial;

// bind function for parameterized functions
const Bind = (fn, important_parameters) => {
    return (given_parameters) => {
        return fn({
            ...given_parameters,
            ...important_parameters,
        });
    }
}

/**
 * SwitchByCountGetter
 *
 * @example
 * const getter = SwitchByCountGetter({
 *   initial: 0,
 *   body: {
 *     0: Bind(LinearByCountGetter, { slop: 1 }),
 *     5: ConstantGetter,
 *   }
 * }); // 0, 1, 2, 3, 4, 4, 4, ...
 */
const SwitchByCountGetter = ({ initial, body }) => {
    let value = initial ?? 0;
    let count = 0;
    let getter;
    if ( ! body.hasOwnProperty(count) ) {
        throw new Error('body of SwitchByCountGetter must have an entry for count 0');
    }
    return () => {
        if ( body.hasOwnProperty(count) ) {
            getter = body[count]({ initial: value });
            console.log('getter is', getter)
        }
        value = getter();
        count++;
        return value;
    }
}

class StreamReducer {
    constructor (initial) {
        this.value = initial;
    }

    put (v) {
        this._put(v);
    }

    get () {
        return this._get();
    }

    _put (v) {
        throw new Error('Not implemented');
    }

    _get () {
        return this.value;
    }
}

class EWMA extends StreamReducer {
    constructor ({ initial, alpha }) {
        super(initial ?? 0);
        console.log('VALL', this.value)
        this.alpha = Getter.adapt(alpha);
    }

    _put (v) {
        this.value = this.alpha() * v + (1 - this.alpha()) * this.value;
    }
}

class MovingMode extends StreamReducer {
    constructor ({ initial, window_size }) {
        super(initial ?? 0);
        this.window_size = window_size ?? 30;
        this.window = [];
    }

    _put (v) {
        this.window.push(v);
        if ( this.window.length > this.window_size ) {
            this.window.shift();
        }
        this.value = this._get_mode();
    }

    _get_mode () {
        let counts = {};
        for ( let v of this.window ) {
            if ( ! counts.hasOwnProperty(v) ) counts[v] = 0;
            counts[v]++;
        }
        let max = 0;
        let mode = null;
        for ( let v in counts ) {
            if ( counts[v] > max ) {
                max = counts[v];
                mode = v;
            }
        }
        return mode;
    }
}

class TimeWindow {
    constructor ({ window_duration, reducer }) {
        this.window_duration = window_duration;
        this.reducer = reducer;
        this.entries_ = [];
    }

    add (value) {
        this.remove_stale_entries_();

        const timestamp = Date.now();
        this.entries_.push({
            timestamp,
            value,
        });
    }

    get () {
        this.remove_stale_entries_();

        const values = this.entries_.map(entry => entry.value);
        if ( ! this.reducer ) return values;

        return this.reducer(values);
    }

    get_entries () {
        return [...this.entries_];
    }

    remove_stale_entries_ () {
        let i = 0;
        const current_ts = Date.now();
        for ( ; i < this.entries_.length ; i++ ) {
            const entry = this.entries_[i];
            // as soon as an entry is in the window we can break,
            // since entries will always be in ascending order by timestamp
            if ( current_ts - entry.timestamp < this.window_duration ) {
                break;
            }
        }

        this.entries_ = this.entries_.slice(i);
    }
}

const normalize = ({
    high_value,
}, value) => {
    const k = -1 * (1 / high_value);
    return 1 - Math.pow(Math.E, k * value);
};

module.exports = {
    Getter,
    LinearByCountGetter,
    SwitchByCountGetter,
    ConstantGetter,
    Bind,
    StreamReducer,
    EWMA,
    MovingMode,
    TimeWindow,
    normalize,
}
