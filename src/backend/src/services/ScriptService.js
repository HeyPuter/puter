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

class BackendScript {
    constructor (name, fn) {
        this.name = name;
        this.fn = fn;
    }

    async run (ctx, args) {
        return await this.fn(ctx, args);
    }

}

class ScriptService extends BaseService {
    _construct () {
        this.scripts = [];
    }

    async _init () {
        const svc_commands = this.services.get('commands');
        svc_commands.registerCommands('script', [
            {
                id: 'run',
                description: 'run a script',
                handler: async (args, ctx) => {
                    const script_name = args.shift();
                    const script = this.scripts.find(s => s.name === script_name);
                    if ( ! script ) {
                        ctx.error(`script not found: ${script_name}`);
                        return;
                    }
                    await script.run(ctx, args);
                },
                completer: (args) => {
                    // The script name is the first argument, so return no results if we're on the second or later.
                    if (args.length > 1)
                        return;
                    const scriptName = args[args.length - 1];

                    return this.scripts
                        .filter(script => scriptName.startsWith(scriptName))
                        .map(script => script.name);
                }
            }
        ]);
    }

    register (name, fn) {
        this.scripts.push(new BackendScript(name, fn));
    }
}

module.exports = {
    ScriptService,
    BackendScript,
};
