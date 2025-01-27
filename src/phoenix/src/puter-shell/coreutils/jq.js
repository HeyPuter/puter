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
import jsonQuery from 'json-query';
import { signals } from '../../ansi-shell/signals.js';
import { Exit } from './coreutil_lib/exit.js';

export default {
    name: 'jq',
    usage: 'jq FILTER [FILE...]',
    description: 'Process JSON input FILE(s) according to FILTER.\n\n' +
        'Reads from standard input if no FILE is provided.',
    input: {
        syncLines: true,
    },
    args: {
        $: 'simple-parser',
        allowPositionals: true,
    },
    execute: async ctx => {
        const { externs } = ctx;
        const { sdkv2 } = externs;

        const { positionals } = ctx.locals;
        const [query] = positionals;
    
        // Read one line at a time
        const { in_, out, err } = ctx.externs;

        let rslv_sigint;
        const p_int = new Promise(rslv => rslv_sigint = rslv);
        ctx.externs.sig.on((signal) => {
            if ( signal === signals.SIGINT ) {
                rslv_sigint({ is_sigint: true });
            }
        });


        let line, done;
        const next_line = async () => {
            let is_sigint = false;
            ({ value: line, done, is_sigint } = await Promise.race([
                p_int, in_.read(),
            ]));
            if ( is_sigint ) {
                throw new Exit(130);
            }
            // ({ value: line, done } = await in_.read());
        }
        for ( await next_line() ; ! done ; await next_line() ) {
            let data; try {
                data = JSON.parse(line);
            } catch (e) {
                await err.write('Error: ' + e.message + '\n');
                continue;
            }
            const result = jsonQuery(query, { data });
            await out.write(JSON.stringify(result.value) + '\n');
        }
    }
}