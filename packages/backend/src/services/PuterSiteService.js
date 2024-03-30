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
const { Context } = require("../util/context");
const BaseService = require("./BaseService");
const { DB_WRITE } = require("./database/consts");

class PuterSiteService extends BaseService {
    async _init () {
        const services = this.services;
        this.db = services.get('database').get(DB_WRITE, 'sites');
    }

    async get_subdomain (subdomain) {
        if ( subdomain === 'devtest' && this.global_config.env === 'dev' ) {
            return {
                user_id: null,
                root_dir_id: this.config.devtest_directory,
            };
        }
        const rows = await this.read(
            `SELECT * FROM subdomains WHERE subdomain = ? LIMIT 1`,
            [subdomain]
        );
        if ( rows.length === 0 ) return null;
        return rows[0];
    }
}

module.exports = {
    PuterSiteService,
};
