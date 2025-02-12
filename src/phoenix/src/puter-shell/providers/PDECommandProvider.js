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
import { Exit } from '../coreutils/coreutil_lib/exit.js';
import { signals } from '../../ansi-shell/signals.js';

const BUILT_IN_APPS = [
    'explorer',
];

const lookup_app = async (id) => {
    // if (BUILT_IN_APPS.includes(id)) {
    //     return { success: true, path: null };
    // }

    const request = await fetch(`${puter.APIOrigin}/drivers/call`, {
        "headers": {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${puter.authToken}`,
        },
        "body": JSON.stringify({ interface: 'puter-apps', method: 'read', args: { id: { name: id } } }),
        "method": "POST",
    });

    const { success, result } = await request.json();
    return { success, path: result?.index_url };
};

export class PDECommandProvider {

    async lookup (id) {
        try {
            await puter.fs.stat("/admin/Public/bin/" + id + ".pde")
        } catch (e) {
            return false;
        }
        const { success, path } = await lookup_app("pderunner");

        return {
            name: id,
            path: path ?? 'Built-in Puter app',
            // TODO: Let apps expose option/positional definitions like builtins do, and parse them here?
            async execute(ctx) {
                console.log(ctx)
                const args = {
                    command_line: {
                        args: ["/admin/Public/bin/" + id + ".pde" , ...ctx.locals.args],
                    },
                    env: {...ctx.env},
                };
                console.log(args)
                const child = await puter.ui.launchApp("pderunner", args);

                const resize_listener = evt => {
                    child.postMessage({
                        $: 'ioctl.set',
                        windowSize: {
                            rows: evt.detail.rows,
                            cols: evt.detail.cols,
                        }
                    });
                };
                ctx.shell.addEventListener('signal.window-resize', resize_listener);

                // Wait for app to close.
                // console.log('waiting for app to close (phoenix)', window, {
                //     child_appid: child.targetAppInstanceID,
                //     phoen_appid: puter.appInstanceID,
                // });
                const app_close_promise = new Promise((resolve, reject) => {
                    child.on('close', (data) => {
                        if ((data.statusCode ?? 0) != 0) {
                            reject(new Exit(data.statusCode));
                        } else {
                            resolve({ done: true });
                        }
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
                        if (message.$ === 'chtermios') {
                            if ( message.termios.echo !== undefined ) {
                                if ( message.termios.echo ) {
                                    ctx.externs.echo.on();
                                } else {
                                    ctx.externs.echo.off();
                                }
                            }
                        }
                    });

                    // Repeatedly copy data from stdin to the child, while it's running.
                    // DRY: Initially copied from PathCommandProvider
                    let data, done;
                    const next_data = async () => {
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

                // TODO: propagate sigint to the app
                const exit = await Promise.race([ app_close_promise, sigint_promise ]);
                ctx.shell.removeEventListener('signal.window-resize', resize_listener);
                return exit;
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

    async complete (query, { ctx }) {
        if (query === '') return [];

        const results = (await puter.fs.readdir("/admin/Public/bin/"))
            .map( (e) => {
                if (e.name.endsWith(".pde")) {
                    return e.name.slice(0, -4)
                } else {
                    return e.name
                }
            })
            .filter( (e) => e.startsWith(query));

        return results;
    }
}
