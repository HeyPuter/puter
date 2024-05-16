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
import { ErrorCodes, ErrorMetadata, errorFromIntegerCode } from '@heyputer/puter-js-common/src/PosixError.js';
import { Exit } from './coreutil_lib/exit.js';

const maxErrorNameLength = Object.keys(ErrorCodes)
    .reduce((longest, name) => Math.max(longest, name.length), 0);
const maxNumberLength = 3;

async function printSingleErrno(errorCode, out) {
    const metadata = ErrorMetadata.get(errorCode);
    const paddedName = errorCode.description + ' '.repeat(maxErrorNameLength - errorCode.description.length);
    const code = metadata.code.toString();
    const paddedCode = ' '.repeat(maxNumberLength - code.length) + code;
    await out.write(`${paddedName} ${paddedCode} ${metadata.description}\n`);
}

export default {
    name: 'errno',
    usage: 'errno [OPTIONS] [NAME-OR-CODE...]',
    description: 'Look up and describe errno codes.',
    args: {
        $: 'simple-parser',
        allowPositionals: true,
        options: {
            list: {
                description: 'List all errno values',
                type: 'boolean',
                short: 'l'
            },
            search: {
                description: 'Search for errors whose descriptions contain NAME-OR-CODEs, case-insensitively',
                type: 'boolean',
                short: 's'
            }
        }
    },
    execute: async ctx => {
        const { err, out } = ctx.externs;
        const { positionals, values } = ctx.locals;

        if (values.search) {
            for (const [errorCode, metadata] of ErrorMetadata) {
                const description = metadata.description.toLowerCase();
                let matches = true;
                for (const nameOrCode of positionals) {
                    if (! description.includes(nameOrCode.toLowerCase())) {
                        matches = false;
                        break;
                    }
                }
                if (matches) {
                    await printSingleErrno(errorCode, out);
                }
            }
            return;
        }

        if (values.list) {
            for (const errorCode of ErrorMetadata.keys()) {
                await printSingleErrno(errorCode, out);
            }
            return;
        }

        let failedToMatchSomething = false;
        const fail = async (nameOrCode) => {
            await err.write(`ERROR: Not understood: ${nameOrCode}\n`);
            failedToMatchSomething = true;
        };

        for (const nameOrCode of positionals) {
            let errorCode = ErrorCodes[nameOrCode.toUpperCase()];
            if (errorCode) {
                await printSingleErrno(errorCode, out);
                continue;
            }

            const code = Number.parseInt(nameOrCode);
            if (!isFinite(code)) {
                await fail(nameOrCode);
                continue;
            }
            errorCode = errorFromIntegerCode(code);
            if (errorCode) {
                await printSingleErrno(errorCode, out);
                continue;
            }

            await fail(nameOrCode);
        }

        if (failedToMatchSomething) {
            throw new Exit(1);
        }
    }
};
