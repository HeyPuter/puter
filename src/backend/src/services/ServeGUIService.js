// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o-mini"}}
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
const BaseService = require("./BaseService");

const express = require('express');
const _path = require('path');


/**
* Class representing the ServeGUIService, which extends the BaseService.
* This service is responsible for setting up the GUI-related routes 
* and serving static files for the Puter application.
*/
class ServeGUIService extends BaseService {
    /**
    * Handles the installation of GUI-related routes for the web server.
    * This method sets up the routing for Puter site domains and other cases,
    * including static file serving from the public directory.
    *
    * @async
    * @returns {Promise<void>} Resolves when routing is successfully set up.
    */
    async ['__on_install.routes-gui'] () {
        const { app } = this.services.get('web-server');

        // is this a puter.site domain?
        require('../routers/hosting/puter-site')(app);

        // Router for all other cases
        app.use(require('../routers/_default'))

        // Static files
        app.use(express.static(_path.join(__dirname, '../../public')))
    }
}

module.exports = ServeGUIService;

