// METADATA // {"ai-commented":{"service":"claude"}}
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
const BaseService = require("./BaseService");


/**
* Represents a Command class that encapsulates command execution functionality.
* Each Command instance contains a specification (spec) that defines its ID,
* name, description, handler function, and optional argument completer.
* The class provides methods for executing commands and handling command
* argument completion.
*/
class Command {
    constructor(spec) {
        this.spec_ = spec;
    }


    /**
    * Gets the unique identifier for this command
    * @returns {string} The command's ID as specified in the constructor
    */
    get id() {
        return this.spec_.id;
    }


    /**
    * Executes the command with given arguments and logging
    * @param {Array} args - Command arguments to pass to the handler
    * @param {Object} [log=console] - Logger object for output, defaults to console
    * @returns {Promise<void>}
    * @throws {Error} Logs any errors that occur during command execution
    */
    async execute(args, log) {
        log = log ?? console;
        const { id, name, description, handler } = this.spec_;
        try {
            await handler(args, log);
        } catch (err) {
            log.error(`command ${name ?? id} failed: ${err.message}`);
            log.error(err.stack);
        }
    }

    completeArgument(args) {
        const completer = this.spec_.completer;
        if ( completer )
            return completer(args);
        return [];
    }
}


/**
* CommandService class manages the registration, execution, and handling of commands in the Puter system.
* Extends BaseService to provide command-line interface functionality. Maintains a collection of Command
* objects, supports command registration with namespaces, command execution with arguments, and provides
* command lookup capabilities. Includes built-in help command functionality.
* @extends BaseService
*/
class CommandService extends BaseService {
    /**
    * Initializes the command service's internal state
    * Called during service construction to set up the empty commands array
    */
    async _construct () {
        this.commands_ = [];
    }
    
    /**
     * Add the help command to the list of commands on init
     */
    async _init () {
        this.commands_.push(new Command({
            id: 'help',
            description: 'show this help',
            handler: (args, log) => {
                log.log(`available commands:`);
                for (const command of this.commands_) {
                    log.log(`- ${command.spec_.id}: ${command.spec_.description}`);
                }
            }
        }));
    }

    registerCommands(serviceName, commands) {
        if ( ! this.log ) process.exit(1);
        for (const command of commands) {
            this.log.info(`registering command ${serviceName}:${command.id}`);
            this.commands_.push(new Command({
                ...command,
                id: `${serviceName}:${command.id}`,
            }));
        }
    }


    /**
    * Executes a command with the given arguments and logging context
    * @param {string[]} args - Array of command arguments where first element is command name
    * @param {Object} log - Logger object for output (defaults to console if not provided)
    * @returns {Promise<void>}
    * @throws {Error} If command execution fails
    */
    async executeCommand(args, log) {
        const [commandName, ...commandArgs] = args;
        const command = this.commands_.find(c => c.spec_.id === commandName);
        if ( ! command ) {
            log.error(`unknown command: ${commandName}`);
            return;
        }
        /**
        * Executes a command with the given arguments in a global context
        * @param {string[]} args - Array of command arguments where first element is command name
        * @param {Object} log - Logger object for output
        * @returns {Promise<void>}
        * @throws {Error} If command execution fails
        */
        await globalThis.root_context.sub({
            injected_logger: log,
        }).arun(async () => {
            await command.execute(commandArgs, log);
        });
    }


    /**
    * Executes a raw command string by splitting it into arguments and executing the command
    * @param {string} text - Raw command string to execute
    * @param {object} log - Logger object for output (defaults to console if not provided)
    * @returns {Promise<void>}
    * @todo Replace basic whitespace splitting with proper tokenizer (obvious-json)
    */
    async executeRawCommand(text, log) {
        // TODO: add obvious-json as a tokenizer
        const args = text.split(/\s+/);
        await this.executeCommand(args, log);
    }


    /**
    * Gets a list of all registered command names/IDs
    * @returns {string[]} Array of command identifier strings
    */
    get commandNames() {
        return this.commands_.map(command => command.id);
    }

    getCommand(id) {
        return this.commands_.find(command => command.id === id);
    }
}

module.exports = {
    CommandService
};
