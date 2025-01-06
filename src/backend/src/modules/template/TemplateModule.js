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

const { AdvancedBase } = require("@heyputer/putility");

/**
 * This is a template module that you can copy and paste to create new modules.
 * 
 * This module is also included in `EssentialModules`, which means it will load
 * when Puter boots. If you're just testing something, you can add it here
 * temporarily.
 */
class TemplateModule extends AdvancedBase {
    async install (context) {
        // === LIBS === //
        const useapi = context.get('useapi');

        const lib = require('./lib/__lib__.js');
        
        // In extensions: use('workinprogress').hello_world();
        // In services classes: see TemplateService.js
        useapi.def(`workinprogress`, lib, { assign: true });
        
        useapi.def('core.context', require('../../util/context.js').Context);
        
        // === SERVICES === //
        const services = context.get('services');

        const { TemplateService } = require('./TemplateService.js');
        services.registerService('template-service', TemplateService);
    }

}

module.exports = {
    TemplateModule
};
