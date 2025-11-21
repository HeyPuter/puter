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

const BaseService = require('../../services/BaseService');

/**
* Service class that handles process-wide events and errors.
* Provides centralized error handling for uncaught exceptions and unhandled promise rejections.
* Sets up event listeners on the process object to capture and report critical errors
* through the logging and error reporting services.
*
* @class ProcessEventService
*/
class ProcessEventService extends BaseService {
    static USE = {
        Context: 'core.context',
    };

    _init () {
        const services = this.services;
        const log = services.get('log-service').create('process-event-service');
        const errors = services.get('error-service').create(log);

        process.on('uncaughtException', async (err, origin) => {
            /**
            * Handles uncaught exceptions in the process
            * Sets up an event listener that reports errors when uncaught exceptions occur
            * @param {Error} err - The uncaught exception error object
            * @param {string} origin - The origin of the uncaught exception
            * @returns {Promise<void>}
            */
            await this.Context.allow_fallback(async () => {
                errors.report('process:uncaughtException', {
                    source: err,
                    origin,
                    trace: true,
                    alarm: true,
                });
            });

        });

        process.on('unhandledRejection', async (reason, promise) => {
            /**
            * Handles unhandled promise rejections by reporting them to the error service
            * @param {*} reason - The rejection reason/error
            * @param {Promise} promise - The rejected promise
            * @returns {Promise<void>} Resolves when error is reported
            */
            await this.Context.allow_fallback(async () => {
                errors.report('process:unhandledRejection', {
                    source: reason,
                    promise,
                    trace: true,
                    alarm: true,
                });
            });
        });
    }
}

module.exports = {
    ProcessEventService,
};
