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
const putility = require('@heyputer/putility');
const BaseService = require('./BaseService');
const config = require('../config');

const tips = (
    // CLI tips
    `
    Type \`help\` to see a list of commands
    \`logs:show\` toggles log output; useful when typing long commands
    \`logs:indent \` toggles indentation for some logs
    \`lock:locks \` will list any active mutex locks
    `,
    // Source code tips
    `
    Most services are registered in CoreModule.js
    Boot sequence events are different from service events
    ExpectationService exists to ensure Puter doesn't miss a step
    Services are composable; StrategyService is a good example
    API endpoints should be on a separate origin in production
    These messages come from DevTODService.js
    `)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length)
    ;

/**
* @class DevTODService
* @extends BaseService
* @description Service that manages the "Tip of the Day" functionality in the development console.
* Displays random helpful tips about the system during startup and provides commands to manage
* the tip display. Inherits from BaseService and integrates with the dev-console and commands
* services to provide an interactive tip system for developers.
*/
class DevTODService extends BaseService {
    /**
    * Initializes the DevTODService by registering commands with the command service
    * @private
    * @async
    * @returns {Promise<void>}
    */
    async _init () {
        const svc_commands = this.services.get('commands');
        this._register_commands(svc_commands);
    }

    /**
    * Handles the boot consolidation phase for the Tip of the Day service
    * Selects a random tip, wraps it to fit the console width, and creates
    * a widget function to display the formatted tip with optional header/footer
    *
    * @returns {Promise<void>}
    */
    async ['__on_boot.consolidation'] () {
        if ( ! config.tipofday ) return;
        const random_tip = tips[Math.floor(Math.random() * tips.length)];
        const svc_devConsole = this.services.get('dev-console', { optional: true });
        if ( ! svc_devConsole ) return;

        // Keep a widget so it can be dismissed, but render with simple lines.
        this.tod_widget = () => {
            const lines = putility.libs.string.wrap_text(random_tip);
            if ( ! this.global_config.minimal_console ) {
                lines.unshift('\x1B[1mTip of the Day\x1B[0m');
                lines.push('Type tod:dismiss to un-stick this message');
            }
            return lines;
        };

        this.tod_widget.unimportant = true;
        svc_devConsole.add_widget(this.tod_widget);
    }

    _register_commands (commands) {
        commands.registerCommands('tod', [
            {
                id: 'dismiss',
                description: 'Dismiss the startup message',
                handler: async (_, log) => {
                    if ( ! this.tod_widget ) {
                        log.log('No Tip of the Day message to dismiss.');
                        return;
                    }
                    const svc_devConsole = this.services.get('dev-console', { optional: true });
                    if ( svc_devConsole ) {
                        svc_devConsole.remove_widget(this.tod_widget);
                    }
                    const lines = this.tod_widget();
                    for ( const line of lines ) log.log(line);
                    this.tod_widget = null;
                },
            },
        ]);
    }
}

module.exports = { DevTODService };
