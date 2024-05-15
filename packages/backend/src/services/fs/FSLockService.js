/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const { RWLock } = require("../../util/lockutil");
const { TeePromise } = require("../../util/promise");
const BaseService = require("../BaseService");

const MODE_READ = Symbol('read');
const MODE_WRITE = Symbol('write');

// TODO: DRY: could use LockService now
class FSLockService extends BaseService {
    async _construct () {
        this.locks = {};
    }
    async _init () {
        const svc_commands = this.services.get('commands');
        svc_commands.registerCommands('fslock', [
            {
                id: 'locks',
                description: 'lists locks',
                handler: async (args, log) => {
                    for ( const path in this.locks ) {
                        let line = path + ': ';
                        if ( this.locks[path].effective_mode === MODE_READ ) {
                            line += `READING (${this.locks[path].readers_})`;
                            log.log(line);
                        }
                        else
                        if ( this.locks[path].effective_mode === MODE_WRITE ) {
                            line += 'WRITING';
                            log.log(line);
                        }
                        else {
                            line += 'UNKNOWN';
                            log.log(line);

                            // log the lock's internal state
                            const lines = JSON.stringify(
                                this.locks[path],
                                null, 2
                            ).split('\n');
                            for ( const line of lines ) {
                                log.log(' -> ' + line);
                            }
                        }
                    }
                }
            }
        ]);
    }
    async lock_child (path, name, mode) {
        if ( path.endsWith('/') ) path = path.slice(0, -1);
        return await this.lock_path(path + '/' + name, mode);
    }
    async lock_path (path, mode) {
        // TODO: Why???
        // if ( this.locks === undefined ) this.locks = {};

        if ( ! this.locks[path] ) {
            const rwlock = new RWLock();
            rwlock.on_empty_ = () => {
                delete this.locks[path];
            };
            this.locks[path] = rwlock;
        }

        this.log.noticeme('WAITING FOR LOCK: ' + path + ' ' +
            mode.toString());

        if ( mode === MODE_READ ) {
            return await this.locks[path].rlock();
        }

        if ( mode === MODE_WRITE ) {
            return await this.locks[path].wlock();
        }

        throw new Error('Invalid mode');
    }
}

module.exports = {
    MODE_READ,
    MODE_WRITE,
    FSLockService
};
