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
import { ANSIContext } from "../ANSIContext.js";
import { signals } from "../signals.js";
import { ProxyReader } from "./ProxyReader.js";

const encoder = new TextEncoder();

export class SignalReader extends ProxyReader {
    constructor ({ sig, ...kv }, ...a) {
        super({ ...kv }, ...a);
        this.sig = sig;
    }

    async read (opt_buffer) {
        const mapping = [
            [ANSIContext.constants.CHAR_ETX, signals.SIGINT],
            [ANSIContext.constants.CHAR_EOT, signals.SIGQUIT],
        ];

        let { value, done } = await this.delegate.read(opt_buffer);

        if ( value === undefined ) {
            return { value, done };
        }

        let tmp_value = value;

        if ( ! (tmp_value instanceof Uint8Array) ) {
            tmp_value = encoder.encode(value);
        }

        // show hex for debugging
        // console.log(value.split('').map(c => c.charCodeAt(0).toString(16)).join(' '));

        for ( const [key, signal] of mapping ) {
            if ( tmp_value.includes(key) ) {
                // this.sig.emit(signal);
                // if ( signal === signals.SIGQUIT ) {
                return { done: true };
                // }
            }
        }

        return { value, done };
    }
}
