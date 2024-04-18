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
import { raceCase } from '../../src/promise.js';

const encoder = new TextEncoder();

const CHAR_LF = '\n'.charCodeAt(0);
const CHAR_CR = '\r'.charCodeAt(0);

export class BetterReader {
    constructor ({ delegate }) {
        this.delegate = delegate;
        this.chunks_ = [];
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

    async read_and_get_info (opt_buffer, cancel_state) {
        if ( ! opt_buffer && this.chunks_.length === 0 ) {
            const chunk = await this.delegate.read();
            if ( cancel_state?.cancelled ) {
                // push the chunk back onto the queue
                this.chunks_.push(chunk.value);
                return this._create_cancel_response();
            }
            return {
                chunk,
                debug_meta: { source: 'delegate' },
            };
        }

        const chunk = await this.getChunk_();
        if ( cancel_state?.cancelled ) {
            // push the chunk back onto the queue
            this.chunks_.push(chunk);
            return this._create_cancel_response();
        }

        if ( ! opt_buffer ) {
            return { chunk, debug_meta: { source: 'stored chunks', returning: 'chunk' } };
        }

        if ( ! chunk ) {
            return { n_read: 0, debug_meta: { source: 'nothing', returning: 'byte count' } };
        }

        this.chunks_.push(chunk);

        while ( this.getTotalBytesReady_() < opt_buffer.length ) {
            const read_chunk = await this.getChunk_();
            if ( cancel_state?.cancelled ) {
                // push the chunk back onto the queue
                this.chunks_.push(read_chunk);
                return this._create_cancel_response();
            }
            if ( ! read_chunk ) {
                break;
            }
            this.chunks_.push(read_chunk);
        }

        let offset = 0;
        while ( this.chunks_.length > 0 && offset < opt_buffer.length ) {
            let item = this.chunks_.shift();
            if ( item === undefined ) {
                break;
            }
            if ( offset + item.length > opt_buffer.length ) {
                const diff = opt_buffer.length - offset;
                this.chunks_.unshift(item.subarray(diff));
                item = item.subarray(0, diff);
            }
            opt_buffer.set(item, offset);
            offset += item.length;
        }

        return {
            n_read: offset,
            debug_meta: { source: 'stored chunks', returning: 'byte count' },
        };
    }

    read_with_cancel (opt_buffer) {
        const cancel_state = { cancelled: false };
        const promise = (async () => {
            const { chunk, n_read } = await this.read_and_get_info(opt_buffer, cancel_state);
            return opt_buffer ? n_read : chunk;
        })();
        return {
            canceller: () => {
                cancel_state.cancelled = true;
            },
            promise,
        };
    }

    async read (opt_buffer) {
        const { chunk, n_read } = await this.read_and_get_info(opt_buffer);
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
                return result.value;
            }
            // There's a chunk in the buffer now, so we can use the regular path.
            // But first, make sure that once the delegate read completes, we save the chunk.
            delegate_read.then((chunk) => {
                this.chunks_.push(chunk.value);
            })
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
        return this.chunks_.reduce((sum, chunk) => sum + chunk.length, 0);
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
