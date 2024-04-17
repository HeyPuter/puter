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
import { Exit } from '../coreutils/coreutil_lib/exit.js';
import { signals } from '../../ansi-shell/signals.js';

const BUILT_IN_APPS = [
    'explorer',
];

export class PuterAppCommandProvider {

    async lookup (id) {
        // Built-in apps will not be returned by the fetch query below, so we handle them separately.
        if (BUILT_IN_APPS.includes(id)) {
            return {
                name: id,
                path: 'Built-in Puter app',
                // TODO: Parameters and options?
                async execute(ctx) {
                    const args = {}; // TODO: Passed-in parameters and options would go here
                    await puter.ui.launchApp(id, args);
                }
            };
        }

        const request = await fetch(`${puter.APIOrigin}/drivers/call`, {
            "headers": {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${puter.authToken}`,
            },
            "body": JSON.stringify({ interface: 'puter-apps', method: 'read', args: { id: { name: id } } }),
            "method": "POST",
        });

        const { success, result } = await request.json();

        if (!success) return;

        const { name, index_url } = result;
        return {
            name,
            path: index_url,
            // TODO: Parameters and options?
            async execute(ctx) {
                const args = {}; // TODO: Passed-in parameters and options would go here
                const child = await puter.ui.launchApp(name, args);

                // Wait for app to close.
                const app_close_promise = new Promise((resolve, reject) => {
                    child.on('close', () => {
                        // TODO: Exit codes for apps
                        resolve({ done: true });
                    });
                });

                // Wait for SIGINT
                const sigint_promise = new Promise((resolve, reject) => {
                    ctx.externs.sig.on((signal) => {
                        if (signal === signals.SIGINT) {
                            child.close();
                            reject(new Exit(130));
                        }
                    });
                });

                // We don't connect stdio to non-SDK apps, because they won't make use of it.
                if (child.usesSDK) {
                    const decoder = new TextDecoder();
                    child.on('message', message => {
                        if (message.$ === 'stdout') {
                            ctx.externs.out.write(decoder.decode(message.data));
                        }
                    });

                    // Repeatedly copy data from stdin to the child, while it's running.
                    // DRY: Initially copied from PathCommandProvider
                    let data, done;
                    const next_data = async () => {
                        // FIXME: This waits for one more read() after we finish.
                        ({ value: data, done } = await Promise.race([
                            app_close_promise, sigint_promise, ctx.externs.in_.read(),
                        ]));
                        if (data) {
                            child.postMessage({
                                $: 'stdin',
                                data: data,
                            });
                            if (!done) setTimeout(next_data, 0);
                        }
                    };
                    setTimeout(next_data, 0);
                }

                return Promise.race([ app_close_promise, sigint_promise ]);
            }
        };
    }

    // Only a single Puter app can match a given name
    async lookupAll (...a) {
        const result = await this.lookup(...a);
        if ( result ) {
            return [ result ];
        }
        return undefined;
    }
}
