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
const { RWLock } = require("../util/lockutil");
const BaseService = require("./BaseService");

/**
* Represents the LockService class responsible for managing locks
* using reader-writer locks (RWLock). This service ensures that 
* critical sections are properly handled by enforcing write locks 
* exclusively, enabling safe concurrent access to shared resources 
* while preventing race conditions and ensuring data integrity.
*/
class LockService extends BaseService {
    /**
    * Initializes the LockService by setting up the locks object 
    * and registering the 'lock' commands. This method is called 
    * during the service initialization phase.
    */
    async _construct () {
        this.locks = {};
    }
    /**
     * Initializes the locks object to store lock instances.
     *
     * This method is called during the construction of the LockService
     * instance to ensure that the locks property is ready for use.
     *
     * @returns {Promise<void>} A promise that resolves when the 
     * initialization is complete.
     */
    async _init () {
        const svc_commands = this.services.get('commands');
        svc_commands.registerCommands('lock', [
            {
                id: 'locks',
                description: 'lists locks',
                handler: async (args, log) => {
                    for ( const name in this.locks ) {
                        let line = name + ': ';
                        if ( this.locks[name].effective_mode === RWLock.TYPE_READ ) {
                            line += `READING (${this.locks[name].readers_})`;
                            log.log(line);
                        }
                        else
                        if ( this.locks[name].effective_mode === RWLock.TYPE_WRITE ) {
                            line += 'WRITING';
                            log.log(line);
                        }
                        else {
                            line += 'UNKNOWN';
                            log.log(line);

                            // log the lock's internal state
                            const lines = JSON.stringify(
                                this.locks[name],
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
    * Acquires a lock for the specified name, allowing for a callback to be executed while the lock is held.
    * If the name is an array, all locks will be acquired in sequence. The method supports optional
    * configurations, including a timeout feature. It returns the result of the callback execution.
    * 
    * @param {string|string[]} name - The name(s) of the lock(s) to acquire.
    * @param {Object} [opt_options] - Optional configuration options.
    * @param {function} callback - The function to call while the lock is held.
    * @returns {Promise} The result of the callback.
    */
    async lock (name, opt_options, callback) {
        if ( typeof opt_options === 'function' ) {
            callback = opt_options;
            opt_options = {};
        }

        // If name is an array, lock all of them
        if ( Array.isArray(name) ) {
            const names = name;
            // TODO: verbose log option by service
            // console.log('LOCKING NAMES', names)
            const section = names.reduce((current_callback, name) => {
                return async () => {
                    return await this.lock(name, opt_options, current_callback);
                };
            }, callback);

            return await section();
        }

        if ( ! this.locks[name] ) {
            const rwlock = new RWLock();
            this.locks[name] = rwlock;
        }

        const handle = await this.locks[name].wlock();
        // TODO: verbose log option by service
        // console.log(`\x1B[36;1mLOCK (${name})\x1B[0m`);


        let timeout, timed_out;
        if ( opt_options.timeout ) {
            timeout = setTimeout(() => {
                handle.unlock();
                // TODO: verbose log option by service
                // throw new Error(`lock ${name} timed out`);
            }, opt_options.timeout);
        }

        try {
            return await callback();
        } finally {
            if ( timeout ) {
                clearTimeout(timeout);
            }
            if ( ! timed_out ) {
                // TODO: verbose log option by service
                // console.log(`\x1B[36;1mUNLOCK (${name})\x1B[0m`);
                handle.unlock();
            }
        }
    }
}

module.exports = { LockService };