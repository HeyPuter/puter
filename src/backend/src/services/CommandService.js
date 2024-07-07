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
const BaseService = require("./BaseService");

class Command {
    constructor(spec) {
        this.spec_ = spec;
    }

    get id() {
        return this.spec_.id;
    }

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

class CommandService extends BaseService {
    async _construct () {
        this.commands_ = [];
    }
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
        for (const command of commands) {
            this.log.info(`registering command ${serviceName}:${command.id}`);
            this.commands_.push(new Command({
                ...command,
                id: `${serviceName}:${command.id}`,
            }));
        }
    }

    async executeCommand(args, log) {
        const [commandName, ...commandArgs] = args;
        const command = this.commands_.find(c => c.spec_.id === commandName);
        if ( ! command ) {
            log.error(`unknown command: ${commandName}`);
            return;
        }
        await globalThis.root_context.arun(async () => {
            await command.execute(commandArgs, log);
        });
    }

    async executeRawCommand(text, log) {
        // TODO: add obvious-json as a tokenizer
        const args = text.split(/\s+/);
        await this.executeCommand(args, log);
    }

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
