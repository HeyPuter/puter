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
class UploadProgressTracker {
    constructor () {
        this.progress_ = 0;
        this.total_ = 0;
        this.done_ = false;

        this.listeners_ = [];
    }

    set_total (v) {
        this.total_ = v;
    }

    set (value) {
        if ( value < this.progress_ ) {
            // TODO: provide a logger for a warning
            return;
        }
        const delta = value - this.progress_;
        this.add(delta);
    }

    add (amount) {
        if ( this.done_ ) {
            return; // TODO: warn
        }

        this.progress_ += amount;

        for ( const lis of this.listeners_ ) {
            lis(amount);
        }

        this.check_if_done_();
    }

    sub (callback) {
        if ( this.done_ ) {
            return;
        }

        const listeners = this.listeners_;

        listeners.push(callback);

        const det = {
            detach: () => {
                const idx = listeners.indexOf(callback);
                if ( idx !== -1 ) {
                    listeners.splice(idx, 1);
                }
            }
        }

        return det;
    }

    check_if_done_ () {
        if ( this.progress_ === this.total_ ) {
            this.done_ = true;
            // clear listeners so they get GC'd
            this.listeners_ = [];
        }
    }
}

module.exports = {
    UploadProgressTracker,
};