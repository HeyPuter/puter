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
import { libs } from '@heyputer/putility';
const { Context } = libs.context;
import { launchPuterShell } from './puter-shell/main.js';
import { NodeStdioPTT } from './pty/NodeStdioPTT.js';
import { CreateFilesystemProvider } from './platform/node/filesystem.js';
import { CreateEnvProvider } from './platform/node/env.js';
import { CreateSystemProvider } from './platform/node/system.js';
import { parseArgs } from '@pkgjs/parseargs';
import capcon from 'capture-console';
import fs from 'fs';

const { values } = parseArgs({
    options: {
        'log': {
            type: 'string',
        },
    },
    args: process.argv.slice(2),
});
const logFile = await (async () => {
    if ( ! values.log )
    {
        return;
    }
    return await fs.promises.open(values.log, 'w');
})();

// Capture console.foo() output and either send it to the log file, or to nowhere.
for ( const [name, oldMethod] of Object.entries(console) ) {
    console[name] = async (...args) => {
        let result;
        const stdio = capcon.interceptStdio(() => {
            result = oldMethod(...args);
        });

        if ( logFile ) {
            await logFile.write(stdio.stdout);
            await logFile.write(stdio.stderr);
        }

        return result;
    };
}

const ctx = new Context({
    ptt: new NodeStdioPTT(),
    config: {},
    platform: new Context({
        name: 'node',
        filesystem: CreateFilesystemProvider(),
        env: CreateEnvProvider(),
        system: CreateSystemProvider(),
    }),
});

await launchPuterShell(ctx);
