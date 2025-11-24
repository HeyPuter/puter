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

import { TeePromise } from '@heyputer/putility/src/libs/promise';
import { Exit } from '../coreutils/coreutil_lib/exit';

const ASCII_TUX = `
        .--.       Puter Linux
       |o_o |      (Alpine Linux edge i686)
       |:_/ |
      //   \\ \\
     (|     | )    You are now using Linux in your browser.
    /'\_    _/\`\\    Welcome to the future!
    \\___)=(___/
`;

export class EmuCommandProvider {
    static AVAILABLE = {
        'bash': '/bin/bash',
        'htop': '/usr/bin/htop',
        'emu-sort': '/usr/bin/sort',
    };

    static EMU_APP_NAME = 'puter-linux';

    constructor () {
        this.available = this.constructor.AVAILABLE;
    }

    async aquire_emulator ({ ctx }) {
        // FUTURE: when we have a way to query instances
        // without exposing the real instance id
        /*
        const instances = await puter.ui.queryInstances();
        if ( instances.length < 0 ) {
            return;
        }
        const instance = instances[0];
        */

        const conn = await puter.ui.connectToInstance(this.constructor.EMU_APP_NAME);
        const p_ready = new TeePromise();
        let prev_phase = 'init';
        let progress_shown = false;
        let tux_enabled = false;
        const leftpadd = 10;
        const on_message = message => {
            if ( message.$ !== 'status' ) {
                console.log('[!!] message from the emulator', message);
                return;
            }
            if ( message.phase !== prev_phase && message.phase !== 'ready' ) {
                if ( progress_shown ) {
                    ctx.externs.out.write('\n');
                }
            }
            if ( message.phase === 'ready' ) {
                if ( progress_shown ) {
                    // show complete progress so it doesn't look weird
                    ctx.externs.out.write(`\r\x1B[${leftpadd}C[${
                        '='.repeat(ctx.env.COLS - 2 - leftpadd) }]\n`);
                }
                p_ready.resolve();
                return;
            }
            if ( message.phase !== prev_phase ) {
                progress_shown = false;
                ctx.externs.out.write(`\r\x1B[${leftpadd}Cphase: ${message.phase}\n`);
                prev_phase = message.phase;
            }
            if ( message.phase_progress ) {
                progress_shown = true;
                let w = ctx.env.COLS;
                w -= 2 + leftpadd;
                ctx.externs.out.write(`\r\x1B[${leftpadd}C[`);
                const done = Math.floor(message.phase_progress * w);
                for ( let i = 0 ; i < done ; i++ ) {
                    ctx.externs.out.write('=');
                }
                for ( let i = done ; i < w ; i++ ) {
                    ctx.externs.out.write(' ');
                }
                ctx.externs.out.write(']');
            }
            // ctx.externs.out.write(JSON.stringify(message)+'\n');
        };
        conn.on('message', on_message);
        if ( conn.response.status.ready ) {
            p_ready.resolve();
        } else {
            conn.response.status.$ = 'status';
            ctx.externs.out.write('          Puter Linux is starting...\n');
            ctx.externs.out.write('          (Alpine Linux edge i686)\n');
            ctx.externs.out.write('\x1B[2A');
            ctx.externs.out.write(`${conn.response.logo }\n`);
            ctx.externs.out.write('\x1B[2A');
            on_message(conn.response.status);
        }
        console.log('status from emu', conn.response);
        if ( conn.response.status.missing_files ) {
            const pfx = '\x1B[31;1m┃\x1B[0m ';
            ctx.externs.out.write('\n');
            ctx.externs.out.write('\x1B[31;1m┃ Emulator is missing files:\x1B[0m\n');
            for ( const file of conn.response.status.missing_files ) {
                ctx.externs.out.write(`${pfx}-  ${file}\n`);
            }
            ctx.externs.out.write(`${pfx}\n`);
            ctx.externs.out.write(`${pfx}\x1B[33;1mDid you run \`./tools/build_v86.sh\`?\x1B[0m\n`);
            ctx.externs.out.write('\n');
            return;
        }
        console.log('awaiting emulator ready');
        await p_ready;
        if ( tux_enabled ) {
            ctx.externs.out.write(ASCII_TUX);
        }
        console.log('emulator ready');
        return conn;
    }

    async lookup (id, { ctx }) {
        if ( ! (id in this.available) ) {
            return;
        }

        const emu = await this.aquire_emulator({ ctx });
        if ( ! emu ) {
            ctx.externs.out.write('No emulator available.\n');
            return new Exit(1);
        }

        // ctx.externs.out.write(`Launching ${id} in emulator ${emu.appInstanceID}\n`);

        return {
            name: id,
            path: 'Emulator',
            execute: this.execute.bind(this, { id, emu, ctx }),
            no_signal_reader: true,
        };
    }

    async execute ({ id, emu }, ctx) {
        // TODO: DRY: most copied from PuterAppCommandProvider
        const resize_listener = evt => {
            emu.postMessage({
                $: 'ioctl.set',
                windowSize: {
                    rows: evt.detail.rows,
                    cols: evt.detail.cols,
                },
            });
        };
        ctx.shell.addEventListener('signal.window-resize', resize_listener);

        // Note: this won't be triggered because the signal reader is disabled,
        // but if we ever need to enable it here this might be useful.
        // ctx.externs.sig.on(signal => {
        //     if ( signal === signals.SIGINT ) emu.postMessage({
        //         $: 'stdin',
        //         data: '\x03', // ETX
        //     });
        // })

        // TODO: handle CLOSE -> emu needs to close connection first
        const app_close_promise = new TeePromise();
        const sigint_promise = new TeePromise();

        const decoder = new TextDecoder();
        emu.on('message', message => {
            if ( message.$ === 'stdout' ) {
                ctx.externs.out.write(decoder.decode(message.data, { stream: true }));
            }
            if ( message.$ === 'chtermios' ) {
                if ( message.termios.echo !== undefined ) {
                    if ( message.termios.echo ) {
                        ctx.externs.echo.on();
                    } else {
                        ctx.externs.echo.off();
                    }
                }
            }
            if ( message.$ === 'pty.close' ) {
                app_close_promise.resolve();
            }
        });

        // Repeatedly copy data from stdin to the child, while it's running.
        // DRY: Initially copied from PathCommandProvider
        let data, done;
        const next_data = async () => {
            console.log('!~!!!!!');
            ({ value: data, done } = await Promise.race([
                app_close_promise, sigint_promise, ctx.externs.in_.read(),
            ]));
            console.log('next_data', data, done);
            if ( data ) {
                console.log('sending stdin data');
                emu.postMessage({
                    $: 'stdin',
                    data: data,
                });
                if ( ! done ) setTimeout(next_data, 0);
            }
        };
        setTimeout(next_data, 0);

        emu.postMessage({
            $: 'exec',
            command: this.available[id],
            args: [],
        });

        await app_close_promise;
    }
}
