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
import { PTT } from './PTT';

const encoder = new TextEncoder();

/**
 * PTY: pseudo-terminal
 *
 * This implements the PTY device driver.
 */
export class PTY {
    constructor () {
        this.outputModeflags = {
            outputNLCR: true,
        };
        this.readableStream = new ReadableStream({
            start: controller => {
                this.readController = controller;
            },
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
            },
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
        for ( let i = 0; i < input.length; i++ ) {
            if ( input[i] === 0x0A ) {
                lfCount++;
            }
        }

        const output = new Uint8Array(input.length + lfCount);

        let outputIndex = 0;
        for ( let i = 0; i < input.length; i++ ) {
            // If LF is encountered, insert CR (0x0D) before LF (0x0A)
            if ( input[i] === 0x0A ) {
                output[outputIndex++] = 0x0D;
            }
            output[outputIndex++] = input[i];
        }

        return output;
    }
}
