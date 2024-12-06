/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const APIError = require("../../api/APIError");
const { chkperm } = require("../../helpers");
const { TYPE_SYMLINK } = require("../FSNodeContext");
const { LLRead } = require("../ll_operations/ll_read");
const { HLFilesystemOperation } = require("./definitions");

class HLRead extends HLFilesystemOperation {
    static MODULES = {
        'stream': require('stream'),
    }

    async _run () {
        const {
            fsNode, actor,
            line_count, byte_count,
            offset,
            version_id,
        } = this.values;

        if ( ! await fsNode.exists() ) {
            throw APIError.create('subject_does_not_exist');
        }

        const ll_read = new LLRead();
        let stream = await ll_read.run({
            fsNode, actor,
            version_id,
            ...(byte_count !== undefined ? {
                offset: offset ?? 0,
                length: byte_count
            } : {}),
        });

        if ( line_count !== undefined ) {
            stream = this._wrap_stream_line_count(stream, line_count);
        }

        return stream;
    }

    /**
     * returns a new stream that will only produce the first `line_count` lines
     * @param {*} stream - input stream
     * @param {*} line_count - number of lines to produce
     */
    _wrap_stream_line_count (stream, line_count) {
        const readline = require('readline');
        const rl = readline.createInterface({
          input: stream,
          terminal: false
        });

        const { PassThrough } = this.modules.stream;

        const output_stream = new PassThrough();

        let lines_read = 0;
        new Promise((resolve, reject) => {
            rl.on('line', (line) => {
                if(lines_read++ >= line_count){
                    return rl.close();
                }

                output_stream.write(lines_read > 1 ? '\r\n' + line : line);
            });
            rl.on('error', () => {
                console.log('error');
            });
            rl.on('close', function () {
                resolve();
            });
        });

        return output_stream;
    }
}

module.exports = {
    HLRead
};
