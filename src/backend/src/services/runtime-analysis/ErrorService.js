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
const BaseService = require("../BaseService");

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

class ErrorService extends BaseService {
    async init () {
        const services = this.services;
        this.alarm = services.get('alarm');
        this.backupLogger = services.get('log-service').create('error-service');
    }
    create (log_context) {
        return new ErrorContext(this, log_context);
    }
    report (location, { source, logger, trace, extra, message }, alarm = true) {
        message = message ?? source?.message;
        logger = logger ?? this.backupLogger;
        logger.error(`Error @ ${location}: ${message}; ` + source?.stack);
        if ( trace ) {
            logger.error(source);
        }

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
