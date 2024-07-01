const { RWLock } = require("../util/lockutil");
const BaseService = require("./BaseService");

/**
 * LockService implements robust critical sections when the behavior
 * might return early or throw an error.
 * 
 * This serivces uses RWLock but always locks in write mode.
 */
class LockService extends BaseService {
    async _construct () {
        this.locks = {};
    }
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