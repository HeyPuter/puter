/*
 * Copyright (C) 2025-present Puter Technologies Inc.
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
"use strict";

const passport = require('passport');

const BaseService = require("./BaseService");

/**
 * @class OAuthAPIService
 * @extends BaseService
 * 
 * The OAuthAPIService class is responsible for integrating OAuth authentication routes
 * into the web server for the Puter application. It registers the necessary middleware
 * and routes for OAuth authentication with various providers.
 */
class OAuthAPIService extends BaseService {
    /**
     * Sets up the routes for OAuth authentication.
     * This method registers various OAuth endpoints with the web server.
     */
    async ['__on_install.routes']() {
        const { app } = this.services.get('web-server');
        
        // Only register OAuth routes if OAuth is enabled
        if ( this.global_config.oauth?.enabled ) {
            // Initialize Passport middleware
            app.use(passport.initialize());
            
            // Register OAuth router
            app.use(require('../routers/auth/oauth'));
            
            this.log.info('OAuth API routes registered');
        }
    }

    /**
     * Initialize the OAuth API service
     */
    async _init() {
        if ( this.global_config.oauth?.enabled ) {
            this.log.info('OAuth API service initialized');
        }
    }
}

module.exports = { OAuthAPIService };