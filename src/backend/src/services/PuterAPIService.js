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
const configurable_auth = require("../middleware/configurable_auth");
const { Endpoint } = require("../util/expressutil");
const BaseService = require("./BaseService");


/**
* @class PuterAPIService
* @extends BaseService
* 
* The PuterAPIService class is responsible for integrating various routes 
* into the web server for the Puter application. It acts as a middleware 
* support layer, providing necessary API endpoints for handling various 
* functionality such as authentication, user management, and application 
* operations. This class is designed to extend the core functionalities 
* of BaseService, ensuring that all routes are properly configured and 
* available for use.
*/
class PuterAPIService extends BaseService {
    /**
    * Sets up the routes for the Puter API service.
    * This method registers various API endpoints with the web server.
    * It does not return a value as it configures the server directly.
    */
    async ['__on_install.routes'] () {
        const { app } = this.services.get('web-server');

        app.use(require('../routers/apps'))
        app.use(require('../routers/query/app'))
        app.use(require('../routers/change_username'))
        require('../routers/change_email')(app);
        app.use(require('../routers/auth/list-sessions'))
        app.use(require('../routers/auth/revoke-session'))
        app.use(require('../routers/auth/check-app'))
        app.use(require('../routers/auth/app-uid-from-origin'))
        app.use(require('../routers/auth/create-access-token'))
        app.use(require('../routers/auth/delete-own-user'))
        app.use(require('../routers/auth/configure-2fa'))
        app.use(require('../routers/drivers/call'))
        app.use(require('../routers/drivers/list-interfaces'))
        app.use(require('../routers/drivers/usage'))
        app.use(require('../routers/confirm-email'))
        app.use(require('../routers/down'))
        app.use(require('../routers/contactUs'))
        app.use(require('../routers/delete-site'))
        app.use(require('../routers/get-dev-profile'))
        app.use(require('../routers/kvstore/getItem'))
        app.use(require('../routers/kvstore/setItem'))
        app.use(require('../routers/kvstore/listItems'))
        app.use(require('../routers/kvstore/clearItems'))
        // app.use(require('../routers/get-launch-apps'))
        app.use(require('../routers/itemMetadata'))
        app.use(require('../routers/login'))
        app.use(require('../routers/logout'))
        app.use(require('../routers/open_item'))
        app.use(require('../routers/passwd'))
        app.use(require('../routers/rao'))
        app.use(require('../routers/remove-site-dir'))
        app.use(require('../routers/removeItem'))
        app.use(require('../routers/save_account'))
        app.use(require('../routers/send-confirm-email'))
        app.use(require('../routers/send-pass-recovery-email'))
        app.use(require('../routers/set-desktop-bg'))
        app.use(require('../routers/verify-pass-recovery-token'))
        app.use(require('../routers/set-pass-using-token'))
        app.use(require('../routers/set_layout'))
        app.use(require('../routers/set_sort_by'))
        app.use(require('../routers/sign'))
        app.use(require('../routers/signup'))
        app.use(require('../routers/sites'))
        // app.use(require('../routers/filesystem_api/stat'))
        app.use(require('../routers/suggest_apps'))
        app.use(require('../routers/healthcheck'))
        app.use(require('../routers/test'))
        app.use(require('../routers/update-taskbar-items'))
        require('../routers/whoami')(app);


        Endpoint({
            route: '/get-launch-apps',
            methods: ['GET'],
            mw: [configurable_auth()],
            handler: require('../routers/get-launch-apps'),
        }).attach(app);

    }
}

module.exports = PuterAPIService;
