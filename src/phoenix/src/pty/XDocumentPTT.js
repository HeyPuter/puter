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
import { BetterReader } from "dev-pty";

const encoder = new TextEncoder();

export class XDocumentPTT {
    static IOCTL = {
        TIOCGWINSZ: {
            id: 104,
        },
    }
    constructor(terminalConnection, opts = {}) {
        for ( const k in XDocumentPTT.IOCTL ) {
            this[k] = async () => {
                return await new Promise((resolve, reject) => {
                    terminalConnection.postMessage({
                        $: 'ioctl.request',
                        requestCode: XDocumentPTT.IOCTL[k].id,
                    });
                    this.once('ioctl.set', evt => {
                        resolve(evt);
                    });
                });
            };
        }

        this.termios = new Proxy({}, {
            set (target, k, v) {
                terminalConnection.postMessage({
                    $: 'chtermios',
                    termios: {
                        [k]: v,
                    }
                });
                return Reflect.set(target, k, v);
            }
        });

        this.ioctl_listeners = {};

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
                terminalConnection.postMessage({
                    $: 'stdout',
                    data: chunk,
                });
            }
        });
        this.out = this.writableStream.getWriter();
        if ( ! opts.disableReader ) {
            this.in = this.readableStream.getReader();
            this.in = new BetterReader({ delegate: this.in });
        }

        terminalConnection.on('message', message => {
            if (message.$ === 'ioctl.set') {
                this.emit('ioctl.set', message);
                return;
            }
            if (message.$ === 'stdin') {
                this.readController.enqueue(message.data);
                return;
            }
        });
    }

    on (name, listener) {
        if ( ! this.ioctl_listeners.hasOwnProperty(name) ) {
            this.ioctl_listeners[name] = [];
        }
        this.ioctl_listeners[name].push(listener);
    }

    emit (name, evt) {
        if ( ! this.ioctl_listeners.hasOwnProperty(name) ) return;
        for ( const listener of this.ioctl_listeners[name] ) {
            listener(evt);
        }
    }

    once (name, listener) {
        const wrapper = evt => {
            listener(evt);
            this.off(name, wrapper);
        };
        this.on(name, wrapper);
    }

    off (name, listener) {
        if ( ! this.ioctl_listeners.hasOwnProperty(name) ) return;
        this.ioctl_listeners[name] = this.ioctl_listeners[name].filter(
            l => l !== listener
        );
    }
}
