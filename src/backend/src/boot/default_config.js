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
module.exports = {
    config_name: 'generated default config',
    env: 'dev',
    nginx_mode: true, // really means "serve http instead of https"
    server_id: 'localhost',
    http_port: 'auto',
    domain: 'puter.localhost',
    protocol: 'http',
    contact_email: 'hey@example.com',

    services: {
        database: {
            engine: 'sqlite',
            path: 'puter-database.sqlite',
        },
        thumbnails: {
            engine: 'purejs'
        },
        'file-cache': {
            disk_limit: 16384,
            disk_max_size: 16384,
            precache_size: 16384,
            path: './file-cache',

        }
    },
};
