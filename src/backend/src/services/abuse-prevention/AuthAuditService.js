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
const BaseService = require("../BaseService");
const { DB_WRITE } = require("../database/consts");


/**
* AuthAuditService Class
*
* The AuthAuditService class extends BaseService and is responsible for recording
* authentication audit logs. It handles the initialization of the database connection,
* recording audit events, and managing any errors that occur during the process.
* This class ensures that all authentication-related actions are logged for auditing
* and troubleshooting purposes.
*/
class AuthAuditService extends BaseService {
    static MODULES = {
        uuidv4: require('uuid').v4,
    }

    async _init () {
        this.db = this.services.get('database').get(DB_WRITE, 'auth:audit');
    }


    /**
    * Records an audit entry for authentication actions.
    *
    * This method handles the recording of audit entries for various authentication actions.
    * It captures the requester details, action, body, and any extra information.
    * If an error occurs during the recording process, it reports the error with appropriate details.
    *
    * @param {Object} parameters - The parameters for the audit entry.
    * @param {Object} parameters.requester - The requester object.
    * @param {string} parameters.action - The action performed.
    * @param {Object} parameters.body - The body of the request.
    * @param {Object} [parameters.extra] - Any extra information.
    * @returns {Promise<void>} - A promise that resolves when the audit entry is recorded.
    */
    async record (parameters) {
        try {
            await this._record(parameters);
        } catch (err) {
            this.errors.report('auth-audit-service.record', {
                source: err,
                trace: true,
                alarm: true,
            });
        }
    }


    /**
    * Records an authentication audit event.
    *
    * This method logs an authentication audit event with the provided parameters.
    * It generates a unique identifier for the event, serializes the requester,
    * body, and extra information, and writes the event to the database.
    *
    * @param {Object} params - The parameters for the authentication audit event.
    * @param {Object} params.requester - The requester information.
    * @param {string} params.requester.ip - The IP address of the requester.
    * @param {string} params.requester.ua - The user-agent string of the requester.
    * @param {Function} params.requester.serialize - A function to serialize the requester information.
    * @param {string} params.action - The action performed during the authentication event.
    * @param {Object} params.body - The body of the request.
    * @param {Object} params.extra - Additional information related to the event.
    * @returns {Promise<void>} - A promise that resolves when the event is recorded.
    */
    async _record ({ requester, action, body, extra }) {
        const uid = 'aas-' + this.modules.uuidv4();

        const json_values = {
            requester: requester.serialize(),
            body: body,
            extra: extra ?? {},
        };

        let has_parse_error = 0;

        for ( const k in json_values ) {
            let value = json_values[k];
            try {
                value = JSON.stringify(value);
            } catch (err) {
                has_parse_error = 1;
                value = { parse_error: err.message };
            }
            json_values[k] = value;
        }

        await this.db.write(
            `INSERT INTO auth_audit (` +
            `uid, ip_address, ua_string, action, ` +
            `requester, body, extra, ` +
            `has_parse_error` +
            `) VALUES ( ?, ?, ?, ?, ?, ?, ?, ? )`,
            [
                uid,
                requester.ip,
                requester.ua,
                action,
                JSON.stringify(requester.serialize()),
                JSON.stringify(body),
                JSON.stringify(extra ?? {}),
                has_parse_error,
            ]
        );
    }
}

module.exports = {
    AuthAuditService
};
