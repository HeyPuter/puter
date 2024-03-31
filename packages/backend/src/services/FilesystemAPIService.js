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

class FilesystemAPIService extends BaseService {
    async ['__on_install.routes'] () {
        const { app } = this.services.get('web-server');

        // batch
        app.use(require('../routers/filesystem_api/batch/all'))

        // v2 -- also in batch
        app.use(require('../routers/filesystem_api/write'))
        app.use(require('../routers/filesystem_api/mkdir'))
        app.use(require('../routers/filesystem_api/delete'))
        // v2 -- not in batch
        app.use(require('../routers/filesystem_api/stat'));
        app.use(require('../routers/filesystem_api/touch'))
        app.use(require('../routers/filesystem_api/read'))
        app.use(require('../routers/filesystem_api/token-read'))
        app.use(require('../routers/filesystem_api/readdir'))
        app.use(require('../routers/filesystem_api/copy'))
        app.use(require('../routers/filesystem_api/move'))
        app.use(require('../routers/filesystem_api/rename'))

        // v1
        app.use(require('../routers/writeFile'))
        app.use(require('../routers/file'))

        // misc
        app.use(require('../routers/df'))

    }
}

module.exports = FilesystemAPIService;
