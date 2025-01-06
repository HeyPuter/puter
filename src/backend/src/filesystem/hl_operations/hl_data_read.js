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
const { stream_to_buffer } = require("../../util/streamutil");
const { HLFilesystemOperation } = require("./definitions");
const { chkperm } = require('../../helpers');
const { LLRead } = require('../ll_operations/ll_read');
const APIError = require('../../api/APIError');

/**
 * HLDataRead reads a stream of objects from a file containing structured data.
 * For .jsonl files, the stream will product multiple objects.
 * For .json files, the stream will produce a single object.
 */
class HLDataRead extends HLFilesystemOperation {
    static MODULES = {
        'stream': require('stream'),
    }

    async _run () {
        const { context } = this;

        // We get the user from context so that an elevated system context
        // can read files under the system user.
        const user = await context.get('user');

        const {
            fsNode,
            version_id,
        } = this.values;

        if ( ! await fsNode.exists() ) {
            throw APIError.create('subject_does_not_exist');
        }

        if ( ! await chkperm(fsNode.entry, user.id, 'read') ) {
            throw APIError.create('forbidden');
        }

        const ll_read = new LLRead();
        let stream = await ll_read.run({
            fsNode, user,
            version_id,
        });

        stream = this._stream_bytes_to_lines(stream);
        stream = this._stream_jsonl_lines_to_objects(stream);

        return stream;
    }

    _stream_bytes_to_lines (stream) {
        const readline = require('readline');
        const rl = readline.createInterface({
          input: stream,
          terminal: false
        });

        const { PassThrough } = this.modules.stream;

        const output_stream = new PassThrough();

        rl.on('line', (line) => {
            output_stream.write(line);
        });
        rl.on('close', () => {
            output_stream.end();
        });

        return output_stream;
    }

    _stream_jsonl_lines_to_objects (stream) {
        const { PassThrough } = this.modules.stream;
        const output_stream = new PassThrough();
        (async () => {
            for await (const line of stream) {
                output_stream.write(JSON.parse(line));
            }
            output_stream.end();
        })();
        return output_stream;
    }
}

module.exports = {
    HLDataRead
};
