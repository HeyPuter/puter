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
const BaseService = require("./BaseService");

class PuterVersionService extends BaseService {
    async _init () {
        this.boot_time = Date.now();
    }

    async ['__on_install.routes'] () {
        const { app } = this.services.get('web-server');
        app.use(require('../routers/version'));
    }

    get_version () {
        const version = process.env.npm_package_version ||
            require('../../package.json').version;
        return {
            version,
            environment: this.global_config.env,
            location: this.global_config.server_id,
            deploy_timestamp: this.boot_time,
        };
    }
}

module.exports = {
    PuterVersionService,
};