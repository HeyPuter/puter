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
const { TeePromise } = require('@heyputer/putility').libs.promise;

class RWLock {
    static TYPE_READ = Symbol('read');
    static TYPE_WRITE = Symbol('write');

    constructor () {
        this.queue = [];

        this.readers_ = 0;
        this.writer_ = false;

        this.on_empty_ = () => {};

        this.mode = this.constructor.TYPE_READ;
    }
    get effective_mode () {
        if ( this.readers_ > 0 ) return this.constructor.TYPE_READ;
        if ( this.writer_ ) return this.constructor.TYPE_WRITE;
        return undefined;
    }
    push_ (item) {
        if ( this.readers_ === 0 && ! this.writer_ ) {
            this.mode = item.type;
        }
        this.queue.push(item);
        this.check_queue_();
    }
    check_queue_ () {
        // console.log('check_queue_', {
        //     readers_: this.readers_,
        //     writer_: this.writer_,
        //     queue: this.queue.map(item => item.type),
        // });
        if ( this.queue.length === 0 ) {
            if ( this.readers_ === 0 && ! this.writer_ ) {
                this.on_empty_();
            }
            return;
        }

        const peek = () => this.queue[0];

        if ( this.readers_ === 0 && ! this.writer_ ) {
            this.mode = peek().type;
        }

        if ( this.mode === this.constructor.TYPE_READ ) {
            while ( peek()?.type === this.constructor.TYPE_READ ) {
                const item = this.queue.shift();
                this.readers_++;
                (async () => {
                    await item.p_unlock;
                    this.readers_--;
                    this.check_queue_();
                })();
                item.p_operation.resolve();
            }
            return;
        }

        if ( this.writer_ ) return;

        const item = this.queue.shift();
        this.writer_ = true;
        (async () => {
            await item.p_unlock;
            this.writer_ = false;
            this.check_queue_();
        })();
        item.p_operation.resolve();
    }
    async rlock () {
        const p_read = new TeePromise();
        const p_unlock = new TeePromise();
        const handle = {
            unlock: () => {
                p_unlock.resolve();
            }
        };

        this.push_({
            type: this.constructor.TYPE_READ,
            p_operation: p_read,
            p_unlock,
        });
        await p_read;

        return handle;
    }

    async wlock () {
        const p_write = new TeePromise();
        const p_unlock = new TeePromise();
        const handle = {
            unlock: () => {
                p_unlock.resolve();
            }
        };

        this.push_({
            type: this.constructor.TYPE_WRITE,
            p_operation: p_write,
            p_unlock,
        });
        await p_write;

        return handle;
    }

}

module.exports = {
    RWLock,
};
