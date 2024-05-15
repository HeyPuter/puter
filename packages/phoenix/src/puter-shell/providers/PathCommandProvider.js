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
import path_ from "node:path";
import child_process from "node:child_process";
import stream from "node:stream";
import { signals } from '../../ansi-shell/signals.js';
import { Exit } from '../coreutils/coreutil_lib/exit.js';
import pty from 'node-pty';

function spawn_process(ctx, executablePath) {
    console.log(`Spawning ${executablePath} as a child process`);
    const child = child_process.spawn(executablePath, ctx.locals.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: ctx.vars.pwd,
    });

    const in_ = new stream.PassThrough();
    const out = new stream.PassThrough();
    const err = new stream.PassThrough();

    in_.on('data', (chunk) => {
        child.stdin.write(chunk);
    });
    out.on('data', (chunk) => {
        ctx.externs.out.write(chunk);
    });
    err.on('data', (chunk) => {
        ctx.externs.err.write(chunk);
    });

    const fn_err = label => err => {
        console.log(`ERR(${label})`, err);
    };
    in_.on('error', fn_err('in_'));
    out.on('error', fn_err('out'));
    err.on('error', fn_err('err'));
    child.stdin.on('error', fn_err('stdin'));
    child.stdout.on('error', fn_err('stdout'));
    child.stderr.on('error', fn_err('stderr'));

    child.stdout.pipe(out);
    child.stderr.pipe(err);

    child.on('error', (err) => {
        console.error(`Error running path executable '${executablePath}':`, err);
    });

    const sigint_promise = new Promise((resolve, reject) => {
        ctx.externs.sig.on((signal) => {
            if ( signal === signals.SIGINT ) {
                reject(new Exit(130));
            }
        });
    });

    const exit_promise = new Promise((resolve, reject) => {
        child.on('exit', (code) => {
            ctx.externs.out.write(`Exited with code ${code}\n`);
            if (code === 0) {
                resolve({ done: true });
            } else {
                reject(new Exit(code));
            }
        });
    });

    // Repeatedly copy data from stdin to the child, while it's running.
    let data, done;
    const next_data = async () => {
        ({ value: data, done } = await Promise.race([
            exit_promise, sigint_promise, ctx.externs.in_.read(),
        ]));
        if ( data ) {
            in_.write(data);
            if ( ! done ) setTimeout(next_data, 0);
        }
    }
    setTimeout(next_data, 0);

    return Promise.race([ exit_promise, sigint_promise ]);
}

function spawn_pty(ctx, executablePath) {
    console.log(`Spawning ${executablePath} as a pty`);
    const child = pty.spawn(executablePath, ctx.locals.args, {
        name: 'xterm-color',
        rows: ctx.env.ROWS,
        cols: ctx.env.COLS,
        cwd: ctx.vars.pwd,
        env: ctx.env
    });
    child.onData(chunk => {
        ctx.externs.out.write(chunk);
    });

    const sigint_promise = new Promise((resolve, reject) => {
        ctx.externs.sig.on((signal) => {
            if ( signal === signals.SIGINT ) {
                child.kill('SIGINT'); // FIXME: Docs say this will throw when used on Windows
                reject(new Exit(130));
            }
        });
    });

    const exit_promise = new Promise((resolve, reject) => {
        child.onExit(({code, signal}) => {
            ctx.externs.out.write(`Exited with code ${code || 0} and signal ${signal || 0}\n`);
            if ( signal ) {
                reject(new Exit(1));
            } else if ( code ) {
                reject(new Exit(code));
            } else {
                resolve({ done: true });
            }
        });
    });

    // Repeatedly copy data from stdin to the child, while it's running.
    let data, done;
    const next_data = async () => {
        ({ value: data, done } = await Promise.race([
            exit_promise, sigint_promise, ctx.externs.in_.read(),
        ]));
        if ( data ) {
            child.write(data);
            if ( ! done ) setTimeout(next_data, 0);
        }
    }
    setTimeout(next_data, 0);

    return Promise.race([ exit_promise, sigint_promise ]);
}

function makeCommand(id, executablePath) {
    return {
        name: id,
        path: executablePath,
        async execute(ctx) {
            // TODO: spawn_pty() does a lot of things better than spawn_process(), but can't handle output redirection.
            //       At some point, we'll need to implement more ioctls within spawn_process() and then remove spawn_pty(),
            //       but for now, the best experience is to use spawn_pty() unless we need the redirection.
            if (ctx.locals.outputIsRedirected) {
                return spawn_process(ctx, executablePath);
            }
            return spawn_pty(ctx, executablePath);
        }
    };
}

async function findCommandsInPath(id, ctx, firstOnly) {
    const PATH = ctx.env['PATH'];
    if (!PATH || id.includes(path_.sep))
        return;
    const pathDirectories = PATH.split(path_.delimiter);

    const results = [];

    for (const dir of pathDirectories) {
        const executablePath = path_.resolve(dir, id);
        let stat;
        try {
            stat = await ctx.platform.filesystem.stat(executablePath);
        } catch (e) {
            // Stat failed -> file does not exist
            continue;
        }
        // TODO: Detect if the file is executable, and ignore it if not.
        const command = makeCommand(id, executablePath);

        if ( firstOnly ) return command;
        results.push(command);
    }

    return results.length > 0 ? results : undefined;
}

export class PathCommandProvider {
    async lookup (id, { ctx }) {
        return findCommandsInPath(id, ctx, true);
    }

    async lookupAll(id, { ctx }) {
        return findCommandsInPath(id, ctx, false);
    }

    async complete(query, { ctx }) {
        if (query === '') return [];

        const PATH = ctx.env['PATH'];
        if (!PATH)
            return [];
        const path_directories = PATH.split(path_.delimiter);

        const results = [];

        for (const dir of path_directories) {
            const dir_entries = await ctx.platform.filesystem.readdir(dir);
            for (const dir_entry of dir_entries) {
                if (dir_entry.name.startsWith(query)) {
                    results.push(dir_entry.name);
                }
            }
        }

        return results;
    }
}
