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

class ServeStaticFilesService extends BaseService {
    async _init (args) {
        this.directories = args.directories;
    }

    async ['__on_install.routes'] () {
        const { app } = this.services.get('web-server');

        for ( const { prefix, path } of this.directories ) {
            app.use(prefix, require('express').static(path));
        }
    }
}

module.exports = { ServeStaticFilesService };
