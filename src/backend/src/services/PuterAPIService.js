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
import configurable_auth from '../middleware/configurable_auth.js';
import appsRouter from '../routers/apps.js';
import authAppUidFromOriginRouter from '../routers/auth/app-uid-from-origin.js';
import authCheckAppRouter from '../routers/auth/check-app.js';
import configure2faRouter from '../routers/auth/configure-2fa.js';
import createAccessTokenRouter from '../routers/auth/create-access-token.js';
import listSessionsRouter from '../routers/auth/list-sessions.js';
import { router as oidcRouter } from '../routers/auth/oidc.js';
import revokeAccessTokenRouter from '../routers/auth/revoke-access-token.js';
import revokeSessionRouter from '../routers/auth/revoke-session.js';
import changeEmailRouter from '../routers/change_email.js';
import changeUsernameRouter from '../routers/change_username.js';
import confirmEmailRouter from '../routers/confirmEmail/confirm-email.js';
import contactUsRouter from '../routers/contactUs.js';
import deleteSiteRouter from '../routers/delete-site.js';
import downRouter from '../routers/down.js';
import driverCallRouter from '../routers/drivers/call.js';
import driverListInterfacesRouter from '../routers/drivers/list-interfaces.js';
import driverUsageRouter from '../routers/drivers/usage.js';
import getDevProfileRouter from '../routers/get-dev-profile.js';
import launchAppsHandler from '../routers/get-launch-apps.js';
import healthcheckRouter from '../routers/healthcheck.js';
import itemMetadataRouter from '../routers/itemMetadata.js';
import kvstoreClearItemsRouter from '../routers/kvstore/clearItems.js';
import kvstoreGetItemRouter from '../routers/kvstore/getItem.js';
import kvstoreListItemsRouter from '../routers/kvstore/listItems.js';
import kvstoreSetItemRouter from '../routers/kvstore/setItem.js';
import loginRouter from '../routers/login.js';
import logoutRouter from '../routers/logout.js';
import openItemRouter from '../routers/open_item.js';
import passwdRouter from '../routers/passwd.js';
import appQueryRouter from '../routers/query/app.js';
import recentAppOpensRouter from '../routers/recentAppOpens/rao.js';
import saveAccountRouter from '../routers/save_account.js';
import sendConfirmEmailRouter from '../routers/send-confirm-email.js';
import sendPassRecoveryEmailRouter from '../routers/send-pass-recovery-email.js';
import setDesktopBackgroundRouter from '../routers/set-desktop-bg.js';
import setPassUsingTokenRouter from '../routers/set-pass-using-token.js';
import setLayoutRouter from '../routers/set_layout.js';
import setSortByRouter from '../routers/set_sort_by.js';
import signRouter from '../routers/sign.js';
import signupRouter from '../routers/signup.js';
import suggestAppsRouter from '../routers/suggest_apps.js';
import testRouter from '../routers/test.js';
import updateTaskbarItemsRouter from '../routers/update-taskbar-items.js';
import verifyPassRecoveryTokenRouter from '../routers/verify-pass-recovery-token.js';
import { Endpoint } from '../util/expressutil.js';
import BaseService from './BaseService.js';
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
export class PuterAPIService extends BaseService {
    /**
    * Sets up the routes for the Puter API service.
    * This method registers various API endpoints with the web server.
    * It does not return a value as it configures the server directly.
    */
    async '__on_install.routes' () {
        const svc_web = this.services.get('web-server');
        const { app } = svc_web;
        svc_web.allow_undefined_origin('/healthcheck');

        app.use(appsRouter);
        app.use(appQueryRouter);
        app.use(changeUsernameRouter);
        changeEmailRouter(app);
        app.use(listSessionsRouter);
        app.use(revokeSessionRouter);
        app.use(authCheckAppRouter);
        app.use(authAppUidFromOriginRouter);
        app.use(createAccessTokenRouter);
        app.use(revokeAccessTokenRouter);
        app.use(configure2faRouter);
        app.use(driverCallRouter);
        app.use(driverListInterfacesRouter);
        app.use(driverUsageRouter);
        app.use(confirmEmailRouter);
        app.use(downRouter);
        app.use(contactUsRouter);
        app.use(deleteSiteRouter);
        app.use(getDevProfileRouter);
        app.use(kvstoreGetItemRouter);
        app.use(kvstoreSetItemRouter);
        app.use(kvstoreListItemsRouter);
        app.use(kvstoreClearItemsRouter);
        app.use(itemMetadataRouter);
        app.use(loginRouter);
        app.use(oidcRouter);
        app.use(logoutRouter);
        app.use(openItemRouter);
        app.use(passwdRouter);
        app.use(recentAppOpensRouter);
        app.use(saveAccountRouter);
        app.use(sendConfirmEmailRouter);
        app.use(sendPassRecoveryEmailRouter);
        app.use(setDesktopBackgroundRouter);
        app.use(verifyPassRecoveryTokenRouter);
        app.use(setPassUsingTokenRouter);
        app.use(setLayoutRouter);
        app.use(setSortByRouter);
        app.use(signRouter);
        app.use(signupRouter);
        app.use(suggestAppsRouter);
        app.use(healthcheckRouter);
        app.use(testRouter);
        app.use(updateTaskbarItemsRouter);

        Endpoint({
            route: '/get-launch-apps',
            methods: ['GET'],
            mw: [configurable_auth()],
            handler: launchAppsHandler,
        }).attach(app);

    }
}
