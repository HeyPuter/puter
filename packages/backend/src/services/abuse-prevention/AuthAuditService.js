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
const { DB_WRITE } = require("../database/consts");

class AuthAuditService extends BaseService {
    static MODULES = {
        uuidv4: require('uuid').v4,
    }
    async _init () {
        this.db = this.services.get('database').get(DB_WRITE, 'auth:audit');
    }

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
