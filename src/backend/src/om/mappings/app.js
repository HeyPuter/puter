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
const config = require("../../config");

module.exports = {
    sql: {
        table_name: 'apps',
    },
    primary_identifier: 'uid',
    redundant_identifiers: ['name'],
    properties: {
        // INHERENT
        uid: {
            type: 'puter-uuid',
            prefix: 'app',
        },

        // DOMAIN
        icon: 'image-base64',
        name: {
            type: 'string',
            required: true,
            maxlen: config.app_name_max_length,
            regex: config.app_name_regex,
        },
        title: {
            type: 'string',
            required: true,
            maxlen: config.app_title_max_length,
        },
        description: {
            type: 'string',
            // longest description in prod is currently 3444,
            // so I've doubled that and rounded up
            maxlen: 7000,
        },
        metadata: {
            type: 'json',
        },
        maximize_on_start: 'flag',
        background: 'flag',
        subdomain: {
            type: 'string',
            transient: true,
            factory: () => 'app-' + require('uuid').v4(),
            sql: { ignore: true },
        },
        index_url: {
            type: 'url',
            required: true,
            maxlen: 3000,
            imply: {
                given: ['subdomain', 'source_directory'],
                make: async ({ subdomain }) => {
                    return config.protocol + '://' + subdomain + '.puter.site';
                }
            },
        },
        source_directory: {
            type: 'puter-node',
            node_type: 'directory',
            sql: { ignore: true },
        },
        created_at: {
            type: 'datetime',
            aliases: ['timestamp'],
            sql: {
                column_name: 'timestamp',
            }
        },

        filetype_associations: {
            type: 'array', of: 'string',
            sql: { ignore: true }
        },

        // DOMAIN :: CALCULATED
        stats: {
            type: 'json',
            sql: { ignore: true }
        },
        created_from_origin: {
            type: 'string',
            sql: { ignore: true }
        },

        // ACCESS
        owner: {
            type: 'reference',
            to: 'user',
            permissions: ['write'], // write = update,delete,create
            permissible_subproperties: ['username', 'uuid'],
            sql: {
                use_id: true,
                column_name: 'owner_user_id',
            }
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

        // OPERATIONS
        last_review: {
            type: 'datetime',
            protected: true,
        },
        approved_for_listing: {
            type: 'flag',
            read_only: true,
        },
        approved_for_opening_items: {
            type: 'flag',
            read_only: true,
        },
        approved_for_incentive_program: {
            type: 'flag',
            read_only: true,
        },

        // SYSTEM
        godmode: {
            type: 'flag',
            read_only: true,
        },
    }
}
