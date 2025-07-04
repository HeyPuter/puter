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

// METADATA // {"ai-commented":{"service":"claude"}}
const { Endpoint } = require("../util/expressutil");
const BaseService = require("./BaseService");
const APIError = require("../api/APIError");

/**
* @class ChatAPIService
* @extends BaseService
* @description Service class that handles public (unauthenticated) API endpoints for AI chat functionality.
* This service provides endpoints for retrieving available AI chat models without requiring authentication.
*/
class ChatAPIService extends BaseService {
    static MODULES = {
        express: require('express'),
        Endpoint: Endpoint,
    };

    /**
    * Installs routes for chat API endpoints into the Express app
    * @param {Object} _ Unused parameter
    * @param {Object} options Installation options
    * @param {Express} options.app Express application instance to install routes on
    * @returns {Promise<void>}
    */
    async ['__on_install.routes'] (_, { app }) {
        // Create a router for chat API endpoints
        const router = (() => {
            const require = this.require;
            const express = require('express');
            return express.Router();
        })();

        // Register the router with the Express app
        app.use('/puterai/chat', router);

        // Install endpoints
        this.install_chat_endpoints_({ router });
    }

    /**
    * Installs chat API endpoints on the provided router
    * @param {Object} options Options object
    * @param {express.Router} options.router Express router to install endpoints on
    * @private
    */
    install_chat_endpoints_ ({ router }) {
        const Endpoint = this.require('Endpoint');
        // Endpoint to list available AI chat models
        Endpoint({
            route: '/models',
            methods: ['GET'],
            handler: async (req, res) => {
                try {
                    // Use SUService to access AIChatService as system user
                    const svc_su = this.services.get('su');
                    const models = await svc_su.sudo(async () => {
                        const svc_aiChat = this.services.get('ai-chat');
                        // Return the simple model list which contains basic model information
                        return svc_aiChat.simple_model_list;
                    });

                    // Return the list of models
                    res.json({ models });
                } catch (error) {
                    this.log.error('Error fetching models:', error);
                    throw APIError.create('internal_server_error');
                }
            }
        }).attach(router);

        // Endpoint to get detailed information about available AI chat models
        Endpoint({
            route: '/models/details',
            methods: ['GET'],
            handler: async (req, res) => {
                try {
                    // Use SUService to access AIChatService as system user
                    const svc_su = this.services.get('su');
                    const models = await svc_su.sudo(async () => {
                        const svc_aiChat = this.services.get('ai-chat');
                        // Return the detailed model list which includes cost and capability information
                        return svc_aiChat.detail_model_list;
                    });

                    // Return the detailed list of models
                    res.json({ models });
                } catch (error) {
                    this.log.error('Error fetching model details:', error);
                    throw APIError.create('internal_server_error');
                }
            }
        }).attach(router);
    }
}

module.exports = {
    ChatAPIService,
};