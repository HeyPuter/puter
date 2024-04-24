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
import { resolveRelativePath } from '../../util/path.js';
import { ErrorCodes } from '@heyputer/puter-js-common/src/PosixError.js';

export default {
    name: 'open',
    usage: 'open FILE',
    description: "Opens FILE in the user's preferred application",
    args: {
        $: 'simple-parser',
        allowPositionals: true
    },
    execute: async ctx => {
        const { out, err } = ctx.externs;
        const { positionals } = ctx.locals;
        const { filesystem } = ctx.platform;

        if (positionals.length !== 1) {
            await err.write('open: Please provide exactly one FILE parameter\n');
            throw new Exit(1);
        }

        const path = positionals[0];
        if (ctx.platform.name === 'node') {
            // On Node, best option is to use whichever utility the OS provides.
            const { platform } = await import('node:process');
            const system_open_command = (() => {
                switch (platform) {
                    case 'darwin': return 'open';
                    case 'win32':  return 'start';

                    // For all the others, we'll assume xdg-open is available.
                    case 'aix':
                    case 'android':
                    case 'freebsd':
                    case 'linux':
                    case 'openbsd':
                    case 'sunos':
                    default:
                        return 'xdg-open';
                }
            })();

            // TODO: Extract app-launching code from PathCommandProvider and use that here.
            //       (But make it a background process.)
            const { spawn } = await import('node:child_process');
            spawn(system_open_command, [ path ]);
            return;
        }

        // ------------------------- //
        // Otherwise, we're on Puter //
        // ------------------------- //

        // Open URLs in a browser
        try {
            new URL(path);
            // Parsing succeeded -> it's a URL
            // TODO: Launch in the user's preferred browser app on Puter, once that's queryable.
            window.open(path);
            return;
        } catch (e) {
            // Not a URL!
        }

        // Check if the file exists
        const abs_path = resolveRelativePath(ctx.vars, path);
        let stat;
        try {
            stat = await filesystem.stat(abs_path);
        } catch (e) {
            if (e.posixCode === ErrorCodes.ENOENT) {
                await err.write(`open: File or directory "${abs_path}" does not exist\n`);
                throw new Exit(2);
            }
            throw e;
        }

        let app_name = '';
        if (stat.is_dir) {
            // Directories should open in explorer.
            app_name = 'explorer';
        } else {
            // Query Puter for the preferred application
            const request = await fetch(`${puter.APIOrigin}/open_item`, {
                "headers": {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${puter.authToken}`,
                },
                "body": JSON.stringify({ uid: stat.uid, path: abs_path }),
                "method": "POST",
            });
            const response = await request.json();

            if (!response.suggested_apps) {
                await err.write(`open: ${response.message}\n`);
                throw new Exit(1);
            }

            const app_info = response.suggested_apps[0];
            app_name = app_info.name;
        }

        // Launch it
        // TODO: Extract app-launching code from PuterAppCommandProvider and use that here.
        //       (But make it a background process.)
        // TODO: Implement passing a list of files to open in `launchApp()`
        await out.write(`Launching ${app_name}...\n` +
        `Please note that this will not open the file. (Yet!)`);
        puter.ui.launchApp(app_name);

        return;
    }
};
