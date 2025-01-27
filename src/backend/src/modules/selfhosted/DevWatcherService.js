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

    async _init (args) {
        this.args = args;
    }
    
    // Oh geez we need to wait for the web server to initialize
    // so that `config.origin` has the actual port in it if the
    // port is set to `auto` - you have no idea how confusing
    // this was to debug the first time, like Ahhhhhh!!
    // but hey at least we have this convenient event listener.
    async ['__on_ready.webserver'] () {
        const svc_process = this.services.get('process');

        const { root, commands } = this.args;
        let promises = [];
        for ( const entry of commands ) {
            const { directory } = entry;
            const fullpath = this.modules.path.join(
                root, directory);
            // promises.push(this.start_({ ...entry, fullpath }));
            promises.push(svc_process.start({ ...entry, fullpath }));
        }
        await Promise.all(promises);

        // It's difficult to tell when webpack is "done" its first
        // run so we just wait a bit before we say we're ready.
        await new Promise((resolve) => setTimeout(resolve, 5000));
    }
};

module.exports = DevWatcherService;
