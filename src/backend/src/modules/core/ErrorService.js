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
const BaseService = require("../../services/BaseService");


/**
* **ErrorContext Class**
*
* The `ErrorContext` class is designed to encapsulate error reporting functionality within a specific logging context.
* It facilitates the reporting of errors by providing a method to log error details along with additional contextual information.
*
* @class
* @classdesc Provides a context for error reporting with specific logging details.
* @param {ErrorService} error_service - The error service instance to use for reporting errors.
* @param {object} log_context - The logging context to associate with the error reports.
*/
class ErrorContext {
    constructor (error_service, log_context) {
        this.error_service = error_service;
        this.log_context = log_context;
    }
    report (location, fields) {
        fields = {
            ...fields,
            logger: this.log_context,
        };
        this.error_service.report(location, fields);
    }
}


/**
* The ErrorService class is responsible for handling and reporting errors within the system.
* It provides methods to initialize the service, create error contexts, and report errors with detailed logging and alarm mechanisms.

* @class ErrorService
* @extends BaseService
*/
class ErrorService extends BaseService {
    /**
    * Initializes the ErrorService, setting up the alarm and backup logger services.
    *
    * @async
    * @function init
    * @memberof ErrorService
    * @returns {Promise<void>} A promise that resolves when the initialization is complete.
    */
    async init () {
        const services = this.services;
        this.alarm = services.get('alarm');
        this.backupLogger = services.get('log-service').create('error-service');
    }
    
    /**
     * Creates an ErrorContext instance with the provided logging context.
     * 
     * @param {*} log_context The logging context to associate with the error reports.
     * @returns {ErrorContext} An ErrorContext instance.
     */
    create (log_context) {
        return new ErrorContext(this, log_context);
    }
    
    /**
     * Reports an error with the specified location and details.
     * The "location" is a string up to the callers discretion to identify
     * the source of the error.
     * 
     * @param {*} location The location where the error occurred.
     * @param {*} fields The error details to report.
     * @param {boolean} [alarm=true] Whether to raise an alarm for the error.
     * @returns {void}
     */
    report (location, { source, logger, trace, extra, message }, alarm = true) {
        message = message ?? source?.message;
        logger = logger ?? this.backupLogger;
        logger.error(`Error @ ${location}: ${message}; ` + source?.stack);

        if ( alarm ) {
            const alarm_id = `${location}:${message}`;
            this.alarm.create(alarm_id, message, {
                error: source,
                ...extra,
            });
        }
    }
}

module.exports = { ErrorService };
