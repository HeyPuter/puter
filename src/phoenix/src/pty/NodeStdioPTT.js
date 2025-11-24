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
import { ReadableStream, WritableStream } from 'stream/web';
import { signals } from '../ansi-shell/signals.js';

const writestream_node_to_web = node_stream => {
    return node_stream;
    // return new WritableStream({
    //     write: chunk => {
    //         node_stream.write(chunk);
    //     }
    // });
};

export class NodeStdioPTT {
    constructor () {
        // this.in = process.stdin;
        // this.out = process.stdout;
        // this.err = process.stderr;

        // this.in = ReadableStream.from(process.stdin).getReader();

        let readController;
        const readableStream = new ReadableStream({
            start: controller => {
                readController = controller;
            },
        });
        this.in = readableStream.getReader();
        process.stdin.setRawMode(true);
        process.stdin.on('data', chunk => {
            const input = new Uint8Array(chunk);
            readController.enqueue(input);
        });

        this.out = writestream_node_to_web(process.stdout);
        this.err = writestream_node_to_web(process.stderr);

        this.ioctl_listeners = {};

        process.stdout.on('resize', () => {
            this.emit('ioctl.set', {
                data: {
                    windowSize: {
                        rows: process.stdout.rows,
                        cols: process.stdout.columns,
                    },
                },
            });
        });

        process.stdin.on('end', () => {
            globalThis.force_eot = true;
            readController.enqueue(new Uint8Array([4]));
        });
    }

    on (name, listener) {
        if ( ! this.ioctl_listeners.hasOwnProperty(name) ) {
            this.ioctl_listeners[name] = [];
        }
        this.ioctl_listeners[name].push(listener);

        // Hack: Pretend the window got resized, so that listeners get notified of the current size.
        if ( name === 'ioctl.set' ) {
            process.stdout.emit('resize');
        }
    }

    emit (name, evt) {
        if ( ! this.ioctl_listeners.hasOwnProperty(name) ) return;
        for ( const listener of this.ioctl_listeners[name] ) {
            listener(evt);
        }
    }
}
