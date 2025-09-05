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
const APIError = require('../../api/APIError');
const config = require('../../config');

module.exports = {
    sql: {
        table_name: 'subdomains',
    },
    primary_identifier: 'uid',
    redundant_identifiers: ['subdomain'],
    properties: {
        // INHERENT
        uid: {
            type: 'puter-uuid',
            prefix: 'sd',
            sql: { column_name: 'uuid' },
        },

        // DOMAIN
        subdomain: {
            type: 'string',
            required: true,
            immutable: true,
            unique: true,
            maxlen: config.subdomain_max_length,
            regex: config.subdomain_regex,
            // TODO: can this 'adapt' be data instead?
            async adapt (value) {
                return value.toLowerCase();
            },
            async validate (value) {
                console.log('VALIDATIOB IS RUN', config.reserved_words, value);
                if ( config.reserved_words.includes(value) ) {
                    return APIError.create('subdomain_reserved', null, {
                        subdomain: value,
                    });
                }
            }
        },
        domain: {
            type: 'string',
            maxlen: 253,

            // It turns out validating domain names kind of sucks
            // source: https://stackoverflow.com/questions/10306690
            regex: '^(((?!-))(xn--|_)?[a-z0-9-]{0,61}[a-z0-9]{1,1}\.)*(xn--)?([a-z0-9][a-z0-9\-]{0,60}|[a-z0-9-]{1,30}\.[a-z]{2,})$',

            // TODO: can this 'adapt' be data instead?
            async adapt (value) {
                if (value !== null)
                    return value.toLowerCase();
                return null;
            },
        },
        root_dir: {
            type: 'puter-node',
            fs_permission: 'read',
            sql: {
                column_name: 'root_dir_id',
            }
        },
        associated_app: {
            type: 'reference',
            service: 'es:app',
            to: 'app',
            sql: {
                use_id: true,
                column_name: 'associated_app_id',
            }
        },
        created_at: {
            type: 'datetime',
            aliases: ['timestamp'],
            sql: {
                column_name: 'ts',
            },
        },

        // ACCESS
        owner: {
            type: 'reference',
            to: 'user',
            permissions: ['write'],
            permissible_subproperties: ['username', 'uuid'],
            sql: {
                use_id: true,
                column_name: 'user_id',
            },
        },
        app_owner: {
            type: 'reference',
            service: 'es:app',
            to: 'app',
            sql: { use_id: true },
        },
        protected: {
            type: 'flag',
        },
    }
};

