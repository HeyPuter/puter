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

/**
 * A replacement for CoreModule with as few external relative requires as possible.
 * This will eventually be the successor to CoreModule, the main module for Puter's backend.
 *
 * The scope of this module is:
 * - logging and error handling
 * - alarm handling
 * - services that are tightly coupled with alarm handling are allowed
 * - any essential information about server stats or health
 * - any very generic service which other services can register
 *   behavior to.
 */
class Core2Module extends AdvancedBase {
    async install (context) {
        // === LIBS === //
        const useapi = context.get('useapi');

        const lib = require('./lib/__lib__.js');
        for ( const k in lib ) {
            useapi.def(`core.${k}`, lib[k], { assign: true });
        }

        useapi.def('core.context', require('../../util/context.js').Context);

        // === SERVICES === //
        const services = context.get('services');

        const { LogService } = require('./LogService.js');
        services.registerService('log-service', LogService);

        const { AlarmService } = require('./AlarmService.js');
        services.registerService('alarm', AlarmService);

        const { ErrorService } = require('./ErrorService.js');
        services.registerService('error-service', ErrorService);

        const { PagerService } = require('./PagerService.js');
        services.registerService('pager', PagerService);

        const { ExpectationService } = require('./ExpectationService.js');
        services.registerService('expectations', ExpectationService);

        const { ProcessEventService } = require('./ProcessEventService.js');
        services.registerService('process-event', ProcessEventService);

        const { ServerHealthService } = require('./ServerHealthService.js');
        services.registerService('server-health', ServerHealthService);

        const { ParameterService } = require('./ParameterService.js');
        services.registerService('params', ParameterService);

        const { ContextService } = require('./ContextService.js');
        services.registerService('context', ContextService);
    }
}

module.exports = {
    Core2Module,
};
