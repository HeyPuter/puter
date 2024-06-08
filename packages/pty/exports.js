/*
 * Copyright (C) 2024  Puter Technologies Inc.
 *
 * This file is part of Phoenix Shell.
 *
 * Phoenix Shell is free software: you can redistribute it and/or modify
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
import { libs } from '@heyputer/puter-js-common';
const { TeePromise, raceCase } = libs.promise;

const encoder = new TextEncoder();

const CHAR_LF = '\n'.charCodeAt(0);
const CHAR_CR = '\r'.charCodeAt(0);

const DONE = Symbol('done');

class Channel {
    constructor () {
        this.chunks_ = [];

        globalThis.chnl = this;

        const events = ['write','consume','change'];
        for ( const event of events ) {
            this[`on_${event}_`] = [];
            this[`emit_${event}_`] = () => {
                for ( const listener of this[`on_${event}_`] ) {
                    listener();
                }
            };
        }

        this.on('write', () => { this.emit_change_(); });
        this.on('consume', () => { this.emit_change_(); });
    }

    on (event, listener) {
        this[`on_${event}_`].push(listener);
    }

    off (event, listener) {
        const index = this[`on_${event}_`].indexOf(listener);
        if ( index !== -1 ) {
            this[`on_${event}_`].splice(index, 1);
        }
    }

    get () {
        const cancel = new TeePromise();
        const data = new TeePromise();
        const done = new TeePromise();

        let called = 0;

        const on_data = () => {
            if ( this.chunks_.length > 0 ) {
                if ( called > 0 ) {
                    throw new Error('called more than once');
                }
                called++;
                const chunk = this.chunks_.shift();
                ( chunk === DONE ? done : data ).resolve(chunk);
                this.off('write', on_data);
                this.emit_consume_();
            }
        };

        this.on('write', on_data);
        on_data();

        const to_return = {
            cancel: () => {
                this.off('write', on_data);
                cancel.resolve();
            },
            promise: raceCase({
                cancel,
                data,
                done,
            }),
        };

        return to_return;
    }

    write (chunk) {
        this.chunks_.push(chunk);
        this.emit_write_();
    }

    pushback (...chunks) {
        for ( let i = chunks.length - 1; i >= 0; i-- ) {
            this.chunks_.unshift(chunks[i]);

        }
        this.emit_write_();
    }

    is_empty () {
        return this.chunks_.length === 0;
    }
}

export class BetterReader {
    constructor ({ delegate }) {
        this.delegate = delegate;
        this.chunks_ = [];
        this.channel_ = new Channel();

        this._init();
    }

    _init () {
        let working = Promise.resolve();
        this.channel_.on('consume', async () => {
            await working;
            working = new TeePromise();
            if ( this.channel_.is_empty() ) {
                await this.intake_();
            }
            working.resolve();
        });
        this.intake_();
    }

    async intake_ () {
        const { value, done } = await this.delegate.read();
        if ( done ) {
            this.channel_.write(DONE);
            return;
        }
        this.channel_.write(value);
    }


    _create_cancel_response () {
        return {
            chunk: null,
            n_read: 0,
            debug_meta: {
                source: 'delegate',
                returning: 'cancelled',
                this_value_should_not_be_used: true,
            },
        };
    }

    read_and_get_info (opt_buffer, cancel_state) {
        if ( ! opt_buffer ) {
            const { promise, cancel } = this.channel_.get();
            return {
                cancel,
                promise: promise.then(([which, chunk]) => {
                    if ( which !== 'data' ) {
                        return { done: true, value: null };
                    }
                    return { value: chunk };
                }),

            };
        }

        const final_promise = new TeePromise();
        let current_cancel_ = () => {};

        (async () => {
            let n_read = 0;
            const chunks = [];
            while ( n_read < opt_buffer.length ) {
                const { promise, cancel } = this.channel_.get();
                current_cancel_ = cancel;

                let [which, chunk] = await promise;
                if ( which === 'done' ) {
                    break;
                }
                if ( which === 'cancel' ) {
                    this.channel_.pushback(...chunks);
                    return
                }
                if ( n_read + chunk.length > opt_buffer.length ) {
                    const diff = opt_buffer.length - n_read;
                    this.channel_.pushback(chunk.subarray(diff));
                    chunk = chunk.subarray(0, diff);
                }
                chunks.push(chunk);
                opt_buffer.set(chunk, n_read);
                n_read += chunk.length;
            }

            final_promise.resolve({ n_read });
        })();

        return {
            cancel: () => {
                current_cancel_();
            },
            promise: final_promise,
        };
    }

    read_with_cancel (opt_buffer) {
        const o = this.read_and_get_info(opt_buffer);
        const { cancel, promise } = o;
        // const promise = (async () => {
        //     const { chunk, n_read } = await this.read_and_get_info(opt_buffer, cancel_state);
        //     return opt_buffer ? n_read : chunk;
        // })();
        return {
            cancel,
            promise,
        };
    }

    async read (opt_buffer) {
        const { chunk, n_read } = await this.read_and_get_info(opt_buffer).promise;
        return opt_buffer ? n_read : chunk;
    }

    async getChunk_() {
        if ( this.chunks_.length === 0 ) {
            // Wait for either a delegate read to happen, or for a chunk to be added to the buffer from a cancelled read.
            const delegate_read = this.delegate.read();
            const [which, result] = await raceCase({
                delegate: delegate_read,
                buffer_not_empty: this.waitUntilDataAvailable(),
            });
            if (which === 'delegate') {
                return result;
            }

            // There's a chunk in the buffer now, so we can use the regular path.
            // But first, make sure that once the delegate read completes, we save the chunk.
            this.chunks_.push(result);
        }

        const len = this.getTotalBytesReady_();
        const merged = new Uint8Array(len);
        let offset = 0;
        for ( const item of this.chunks_ ) {
            merged.set(item, offset);
            offset += item.length;
        }

        this.chunks_ = [];

        return merged;
    }

    getTotalBytesReady_ () {
        return this.chunks_.reduce((sum, chunk) => {
            return sum + chunk.value.length
        }, 0);
    }

    canRead() {
        return this.getTotalBytesReady_() > 0;
    }

    async waitUntilDataAvailable() {
        let resolve_promise;
        let reject_promise;
        const promise = new Promise((resolve, reject) => {
            resolve_promise = resolve;
            reject_promise = reject;
        });

        const check = () => {
            if (this.canRead()) {
                resolve_promise();
            } else {
                setTimeout(check, 0);
            }
        };
        setTimeout(check, 0);

        await promise;
    }
}

/**
 * PTT: pseudo-terminal target; called "slave" in POSIX
 */
export class PTT {
    constructor(pty) {
        this.readableStream = new ReadableStream({
            start: controller => {
                this.readController = controller;
            }
        });
        this.writableStream = new WritableStream({
            start: controller => {
                this.writeController = controller;
            },
            write: chunk => {
                if (typeof chunk === 'string') {
                    chunk = encoder.encode(chunk);
                }
                if ( pty.outputModeflags?.outputNLCR ) {
                    chunk = pty.LF_to_CRLF(chunk);
                }
                pty.readController.enqueue(chunk);
            }
        });
        this.out = this.writableStream.getWriter();
        this.in = this.readableStream.getReader();
    }
}

/**
 * PTY: pseudo-terminal
 *
 * This implements the PTY device driver.
 */
export class PTY {
    constructor () {
        this.outputModeflags = {
            outputNLCR: true
        };
        this.readableStream = new ReadableStream({
            start: controller => {
                this.readController = controller;
            }
        });
        this.writableStream = new WritableStream({
            start: controller => {
                this.writeController = controller;
            },
            write: chunk => {
                if ( typeof chunk === 'string' ) {
                    chunk = encoder.encode(chunk);
                }
                for ( const target of this.targets ) {
                    target.readController.enqueue(chunk);
                }
            }
        });
        this.out = this.writableStream.getWriter();
        this.in = this.readableStream.getReader();
        this.targets = [];
    }

    getPTT () {
        const target = new PTT(this);
        this.targets.push(target);
        return target;
    }

    LF_to_CRLF (input) {
        let lfCount = 0;
        for (let i = 0; i < input.length; i++) {
            if (input[i] === 0x0A) {
                lfCount++;
            }
        }

        const output = new Uint8Array(input.length + lfCount);

        let outputIndex = 0;
        for (let i = 0; i < input.length; i++) {
            // If LF is encountered, insert CR (0x0D) before LF (0x0A)
            if (input[i] === 0x0A) {
                output[outputIndex++] = 0x0D;
            }
            output[outputIndex++] = input[i];
        }

        return output;
    }
}
