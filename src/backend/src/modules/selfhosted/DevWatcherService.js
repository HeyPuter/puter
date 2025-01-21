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
const BaseService = require("../../services/BaseService");

class ProxyLogger {
    constructor (log) {
        this.log = log;
    }
    attach (stream) {
        let buffer = '';
        stream.on('data', (chunk) => {
            buffer += chunk.toString();
            let lineEndIndex = buffer.indexOf('\n');
            while (lineEndIndex !== -1) {
                const line = buffer.substring(0, lineEndIndex);
                this.log(line);
                buffer = buffer.substring(lineEndIndex + 1);
                lineEndIndex = buffer.indexOf('\n');
            }
        });

        stream.on('end', () => {
            if (buffer.length) {
                this.log(buffer);
            }
        });
    }
}

/**
 * @description
 * This service is used to run webpack watchers.
 */
class DevWatcherService extends BaseService {
    static MODULES = {
        path: require('path'),
        spawn: require('child_process').spawn,
    };

    _construct () {
        this.instances = [];
    }

    async _init (args) {
        this.args = args;

        process.on('exit', () => {
            this.exit_all_();
        })
    }
    
    // Oh geez we need to wait for the web server to initialize
    // so that `config.origin` has the actual port in it if the
    // port is set to `auto` - you have no idea how confusing
    // this was to debug the first time, like Ahhhhhh!!
    // but hey at least we have this convenient event listener.
    async ['__on_ready.webserver'] () {
        const { root, commands } = this.args;
        let promises = [];
        for ( const entry of commands ) {
            const { directory } = entry;
            const fullpath = this.modules.path.join(
                root, directory);
            promises.push(this.start_({ ...entry, fullpath }));
        }
        await Promise.all(promises);

        // It's difficult to tell when webpack is "done" its first
        // run so we just wait a bit before we say we're ready.
        await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    log_ (name, isErr, line) {
        let txt = `[${name}:`;
        txt += isErr
            ? `\x1B[34;1m2\x1B[0m`
            : `\x1B[32;1m1\x1B[0m`;
        txt += '] ' + line;
        this.log.info(txt);
    }

    async start_ ({ name, fullpath, command, args, env }) {
        this.log.info(`Starting ${name} in ${fullpath}`);
        const env_processed = { ...(env ?? {}) };
        for ( const k in env_processed ) {
            if ( typeof env_processed[k] !== 'function' ) continue;
            env_processed[k] = env_processed[k]({
                global_config: this.global_config
            });
        }
        console.log(
            'command',
            command,
            ...args
        )
        const proc = this.modules.spawn(command, args, {
            shell: true,
            env: {
                ...process.env,
                ...env_processed,
            },
            cwd: fullpath,
        });
        this.instances.push({
            name, proc,
        });
        const out = new ProxyLogger((line) => this.log_(name, false, line));
        out.attach(proc.stdout);
        const err = new ProxyLogger((line) => this.log_(name, true, line));
        err.attach(proc.stderr);
        proc.on('exit', () => {
            this.log.info(`[${name}:exit] Process exited (${proc.exitCode})`);
            this.instances = this.instances.filter((inst) => inst.proc !== proc);
        })
    }

    async exit_all_ () {
        for ( const { proc } of this.instances ) {
            proc.kill();
        }
    }
};

module.exports = DevWatcherService;
