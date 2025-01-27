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


/**
* Class representing the PuterVersionService.
* 
* The PuterVersionService extends the BaseService and provides methods 
* to initialize the service, handle routing for version information, 
* and retrieve the current version of the application. It is responsible 
* for managing version-related operations within the Puter framework.
*/
class PuterVersionService extends BaseService {
    /**
     * Initializes the service by recording the current boot time.
     * This method is called asynchronously to ensure that any necessary 
     * setup can be completed before the service begins handling requests.
     */
    async _init () {
        this.boot_time = Date.now();
    }


    /**
     * Sets up the routes for the versioning API.
     * This method registers the version router with the web server application.
     * 
     * @async
     * @returns {Promise<void>} Resolves when the routes are successfully registered.
     */
    async ['__on_install.routes'] () {
        const { app } = this.services.get('web-server');
        app.use(require('../routers/version'));
    }


    /**
    * Retrieves the current version information of the application along with 
    * the environment and deployment details. The method fetches the version 
    * from the npm package or the local package.json file and returns an 
    * object containing the version, environment, server location, and 
    * deployment timestamp.
    * 
    * @returns {Object} An object containing version details.
    * @returns {string} return.version - The current application version.
    * @returns {string} return.environment - The environment in which the app is running.
    * @returns {string} return.location - The server ID where the application is deployed.
    * @returns {number} return.deploy_timestamp - The timestamp when the application was deployed.
    */
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