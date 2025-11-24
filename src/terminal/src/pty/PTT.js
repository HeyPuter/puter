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
 * PTT: pseudo-terminal target; called "slave" in POSIX
 */
export class PTT {
    constructor (pty) {
        const encoder = new TextEncoder();
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
                if ( pty.outputModeflags?.outputNLCR ) {
                    chunk = pty.LF_to_CRLF(chunk);
                }
                pty.readController.enqueue(chunk);
            },
        });
        this.out = this.writableStream.getWriter();
        this.in = this.readableStream.getReader();
    }
}
