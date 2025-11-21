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

const { AdvancedBase } = require('@heyputer/putility');
const { RuntimeModule } = require('../../extension/RuntimeModule.js');

/**
 * This module initializes a pre-configured web server and socket.io server.
 * The main service, WebServerService, emits 'install.routes' and provides
 * the server instance to the callback.
 */
class WebModule extends AdvancedBase {
    async install (context) {
        // === LIBS === //
        const useapi = context.get('useapi');
        useapi.def('web', require('./lib/__lib__.js'), { assign: true });

        // Prevent extensions from loading incompatible versions of express
        useapi.def('web.express', require('express'));

        // Extension compatibility
        const runtimeModule = new RuntimeModule({ name: 'web' });
        context.get('runtime-modules').register(runtimeModule);
        runtimeModule.exports = useapi.use('web');

        // === SERVICES === //
        const services = context.get('services');

        const SocketioService = require('./SocketioService');
        services.registerService('socketio', SocketioService);

        const WebServerService = require('./WebServerService');
        services.registerService('web-server', WebServerService);

        const APIErrorService = require('./APIErrorService');
        services.registerService('api-error', APIErrorService);
    }
}

module.exports = {
    WebModule,
};
