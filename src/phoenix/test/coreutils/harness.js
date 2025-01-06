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
import putility from '@heyputer/putility';
const { Context } = putility.libs.context;
import { SyncLinesReader } from '../../src/ansi-shell/ioutil/SyncLinesReader.js';
import { CommandStdinDecorator } from '../../src/ansi-shell/pipeline/iowrappers.js';
import { ReadableStream, WritableStream } from 'stream/web'

class WritableStringStream extends WritableStream {
    constructor() {
        super({
            write: (chunk) => {
                if (this.output_ === undefined)
                    this.output_ = "";
                this.output_ += chunk;
            }
        });
    }

    write(chunk) {
        if (!this.writer_)
            this.writer_ = this.getWriter();
        return this.writer_.write(chunk);
    }

    get output() { return this.output_ || ""; }
}

// TODO: Flesh this out as needed.
export const MakeTestContext = (command, { positionals = [],  values = {}, stdinInputs = [], env = {} }) => {
    // This is a replacement to ReadableStream.from() in earlier Node versions
    // Sourece: https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream#convert_an_iterator_or_async_iterator_to_a_stream
    function iteratorToStream(iterator) {
        return new ReadableStream({
            async pull(controller) {
                const { value, done } = await iterator.next();

                if (done) {
                    controller.close();
                } else {
                    controller.enqueue(value);
                }
            },
        });
    }

    let in_ = iteratorToStream(stdinInputs.values()).getReader();
    if (command.input?.syncLines) {
        in_ = new SyncLinesReader({ delegate: in_ });
    }
    in_ = new CommandStdinDecorator(in_);

    return new Context({
        cmdExecState: { valid: true },
        externs: new Context({
            in_,
            out: new WritableStringStream(),
            err: new WritableStringStream(),
            sig: null,
        }),
        locals: new Context({
            args: [],
            command,
            positionals,
            values,
        }),
        platform: new Context({}),
        plugins: new Context({}),
        registries: new Context({}),
        env: env,
    });
}