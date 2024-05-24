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
import { Exit } from './coreutil_lib/exit.js';
import { fileLines } from '../../util/file.js';
import { parseScript } from './sed/parser.js';

export default {
    name: 'sed',
    usage: 'sed [OPTIONS] [SCRIPT] FILE...',
    description: 'Filter and transform text, line by line.\n\n' +
        'Treats the first positional argument as the SCRIPT if no -e options are provided. ' +
        'If a FILE is `-`, read standard input.',
    input: {
        syncLines: true
    },
    args: {
        $: 'simple-parser',
        allowPositionals: true,
        options: {
            expression: {
                description: 'Specify an additional script to execute. May be specified multiple times.',
                type: 'string',
                short: 'e',
                multiple: true,
                default: [],
            },
            quiet: {
                description: 'Suppress default printing of selected lines.',
                type: 'boolean',
                short: 'n',
                default: false,
            },
        }
    },
    execute: async ctx => {
        const { out, err } = ctx.externs;
        const { positionals, values } = ctx.locals;

        if (positionals.length < 1) {
            await err.write('sed: No inputs given\n');
            throw new Exit(1);
        }

        // "If any -e or -f options are specified, the script of editing commands shall initially be empty. The commands
        // specified by each -e or -f option shall be added to the script in the order specified. When each addition is
        // made, if the previous addition (if any) was from a -e option, a <newline> shall be inserted before the new
        // addition. The resulting script shall have the same properties as the script operand, described in the
        // OPERANDS section."
        // TODO: -f loads scripts from a file
        let scriptString = '';
        if (values.expression.length > 0) {
            scriptString = values.expression.join('\n');
        } else {
            scriptString = positionals.shift();
        }

        const script = parseScript(scriptString);
        await out.write(script.dump());
        await script.run(ctx);
    }
};
