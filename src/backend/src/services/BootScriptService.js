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

// METADATA // {"ai-commented":{"service":"mistral","model":"mistral-large-latest"}}
const { Context } = require("../util/context");
const BaseService = require("./BaseService");


/**
* @class BootScriptService
* @extends BaseService
* @description The BootScriptService class extends BaseService and is responsible for
* managing and executing boot scripts. It provides methods to handle boot scripts when
* the system is ready and to run individual script commands.
*/
class BootScriptService extends BaseService {
    static MODULES = {
        fs: require('fs'),
    }
    /**
    * Loads and executes a boot script if specified in the arguments.
    *
    * This method reads the provided boot script file, parses it, and runs the script using the `run_script` method.
    * If no boot script is specified in the arguments, the method returns immediately.
    *
    * @async
    * @function
    * @returns {Promise<void>}
    */
    async ['__on_boot.ready'] () {
        const args = Context.get('args');
        if ( ! args['boot-script'] ) return;
        const script_name = args['boot-script'];

        const require = this.require;
        const fs = require('fs');
        const boot_json_raw = fs.readFileSync(script_name, 'utf8');
        const boot_json = JSON.parse(boot_json_raw);
        await this.run_script(boot_json);
    }


    /**
    * Executes a series of commands defined in a JSON boot script.
    *
    * This method processes each command in the boot_json array.
    * If the command is recognized within the predefined scope, it will be executed.
    * If not, an error is thrown.
    *
    * @param {Array} boot_json - An array of commands to execute.
    * @throws {Error} Thrown if an unknown command is encountered.
    */
    async run_script (boot_json) {
        const scope = {
            runner: 'boot-script',
            ['end-puter-process']: ({ args }) => {
                const svc_shutdown = this.services.get('shutdown');
                svc_shutdown.shutdown(args[0]);
            }
        };

        for ( const statement of boot_json ) {
            const [cmd, ...args] = statement;
            if ( ! scope[cmd] ) {
                throw new Error(`Unknown command: ${cmd}`);
            }
            await scope[cmd]({ scope, args });
        }
    }
}

module.exports = {
    BootScriptService
};
