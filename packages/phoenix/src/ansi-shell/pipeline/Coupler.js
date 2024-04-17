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
import { TeePromise } from "../../promise.js";

export class Coupler {
    static description = `
        Connects a read stream to a write stream.
        Does not close the write stream when the read stream is closed.
    `

    constructor (source, target) {
        this.source = source;
        this.target = target;
        this.on_ = true;
        this.closed_ = new TeePromise();
        this.isDone = new Promise(rslv => {
            this.resolveIsDone = rslv;
        })
        this.listenLoop_();
    }

    off () { this.on_ = false; }
    on () { this.on_ = true; }

    close () {
        this.closed_.resolve({
            value: undefined,
            done: true,
        });
    }

    async listenLoop_ () {
        this.active = true;
        for (;;) {
            const { value, done } = await Promise.race([
                this.closed_,
                this.source.read(),
            ]);
            if ( done ) {
                this.source = null;
                this.target = null;
                this.active = false;
                this.resolveIsDone();
                break;
            }
            if ( this.on_ ) {
                await this.target.write(value);
            }
        }
    }
}
