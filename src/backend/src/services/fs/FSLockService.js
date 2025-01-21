// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o"}}
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
const { RWLock } = require("../../util/lockutil");
const BaseService = require("../BaseService");

// Constant representing the read lock mode used for distinguishing between read and write operations.
const MODE_READ = Symbol('read');
// Constant representing the read mode for locks, used to distinguish between read and write operations.
const MODE_WRITE = Symbol('write');

// TODO: DRY: could use LockService now
/**
* FSLockService is a service class that manages file system locks using read-write locks.
* It provides functionality to create, list, and manage locks on file paths,
* allowing concurrent read and exclusive write operations.
*/
class FSLockService extends BaseService {
    async _construct () {
        this.locks = {};
    }
    /**
     * Initializes the FSLockService by setting up the locks object.
     * This method should be called before using the service to ensure
     * that the locks property is properly instantiated.
     *
     * @returns {Promise<void>} A promise that resolves when the initialization is complete.
     */
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
    
    /**
     * Lock a file by parent path and child node name.
     * 
     * @param {string} path - The path to lock.
     * @param {string} name - The name of the resource to lock.
     * @param {symbol} mode - The mode of the lock (read or write).
     * @returns {Promise} A promise that resolves when the lock is acquired.
     * @throws {Error} Throws an error if an invalid mode is provided.
     */
    async lock_child (path, name, mode) {
        if ( path.endsWith('/') ) path = path.slice(0, -1);
        return await this.lock_path(path + '/' + name, mode);
    }

    /**
     * Lock a file by path.
     * 
     * @param {string} path - The path to lock.
     * @param {symbol} mode - The mode of the lock (read or write).
     * @returns {Promise} A promise that resolves when the lock is acquired.
     * @throws {Error} Throws an error if an invalid mode is provided.
     */
    async lock_path (path, mode) {
        // TODO: Why???
        // if ( this.locks === undefined ) this.locks = {};

        if ( ! this.locks[path] ) {
            const rwlock = new RWLock();
            /**
             * Acquires a lock for the specified path and mode. If the lock does not exist,
             * a new RWLock instance is created and associated with the path. The lock is
             * released when there are no more active locks.
             *
             * @param {string} path - The path for which to acquire the lock.
             * @param {Symbol} mode - The mode of the lock, either MODE_READ or MODE_WRITE.
             * @returns {Promise} A promise that resolves once the lock is successfully acquired.
             * @throws {Error} Throws an error if the mode provided is invalid.
             */
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
