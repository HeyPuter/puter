// METADATA // {"ai-commented":{"service":"mistral","model":"mistral-large-latest"}}
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
* SystemValidationService class.
*
* This class extends BaseService and is responsible for handling system validation
* and marking the server as invalid. It includes methods for reporting invalid
* system states, raising alarms, and managing the server's response in different
* environments (e.g., development and production).
*
* @class
* @extends BaseService
*/
class SystemValidationService extends BaseService {
    /**
    * Marks the server as being in an invalid state.
    *
    * This method is used to indicate that the server is in a serious error state. It will attempt
    * to alert the user and then shut down the server after 25 minutes.
    *
    * @param {string} message - A description of why mark_invalid was called.
    * @param {Error} [source] - The error that caused the invalid state, if any.
    */
    async mark_invalid (message, source) {
        if ( ! source ) source = new Error('no source error');

        // The system is in an invalid state. The server will do whatever it
        // can to get our attention, and then it will shut down.
        if ( ! this.errors ) {
            console.error(
                'SystemValidationService is trying to mark the system as invalid, but the error service is not available.',
                message,
                source,
            );

            // We can't do anything else. The server will crash.
            throw new Error('SystemValidationService is trying to mark the system as invalid, but the error service is not available.');
        }

        this.errors.report('INVALID SYSTEM STATE', {
            source,
            message,
            trace: true,
            alarm: true,
        });

        // If we're in dev mode...
        if ( this.global_config.env === 'dev' ) {
            // Display a permanent message in the console
            const svc_devConsole = this.services.get('dev-console');
            svc_devConsole.turn_on_the_warning_lights();
            /**
            * Turns on the warning lights in the developer console and adds a widget indicating that the system is in an invalid state.
            * This is used in development mode to provide a visual indicator of the invalid state without shutting down the server.
            *
            * @returns {void}
            */
            svc_devConsole.add_widget(() => {
                return `\x1B[33;1m *** SYSTEM IS IN AN INVALID STATE *** \x1B[0m`;
            });

            // Don't shut down
            return;
        }

        // Raise further alarms if the system keeps running
        for ( let i = 0; i < 5; i++ ) {
            // After 5 minutes, raise another alarm
            await new Promise(rslv => setTimeout(rslv, 60 * 5000));
            this.errors.report(`INVALID SYSTEM STATE (Reminder ${i+1})`, {
                source,
                message,
                trace: true,
                alarm: true,
            });
        }
    }
}

module.exports = { SystemValidationService };
