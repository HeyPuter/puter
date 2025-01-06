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

// TODO: import via `USE` static member
const BaseService = require("../../services/BaseService");
const { Endpoint } = require("../../util/expressutil");

/**
 * This is a template service that you can copy and paste to create new services.
 * You can also add to this service temporarily to test something.
 */
class TemplateService extends BaseService {
    static USE = {
        // - Defined by lib/__lib__.js,
        // - Exposed to `useapi` by TemplateModule.js
        workinprogress: 'workinprogress'
    }
    
    _construct () {
        // Use this override to initialize instance variables.
    }
    
    async _init () {
        // This is where you initialize the service and prepare
        // for the consolidation phase.
        this.log.info("I am the template service.");
    }
    
    /**
     * TemplateService listens to this event to provide an example endpoint
     */
    ['__on_install.routes'] (_, { app }) {
        this.log.info("TemplateService get the event for installing endpoint.");
        Endpoint({
            route: '/example-endpoint',
            methods: ['GET'],
            handler: async (req, res) => {
                res.send(this.workinprogress.hello_world());
            }
        }).attach(app);
        // ^ Don't forget to attach the endpoint to the app!
        //   it's very easy to forget this step.
    }
    
    /**
     * TemplateService listens to this event to provide an example event
     */
    ['__on_boot.consolidation'] () {
        // At this stage, all services have been initialized and it is
        // safe to start emitting events.
        this.log.info("TemplateService sees consolidation boot phase.");
        
        const svc_event = this.services.get('event');
        
        svc_event.on('template-service.hello', (_eventid, event_data) => {
            this.log.info('template-service said hello to itself; this is expected', {
                event_data,
            });
        });
        
        svc_event.emit('template-service.hello', {
            message: 'Hello all you other services! I am the template service.'
        });
    }
    /**
     * TemplateService listens to this event to show you that it's here
     */
    ['__on_boot.activation'] () {
        this.log.info("TemplateService sees activation boot phase.");
    }

    /**
     * TemplateService listens to this event to show you that it's here
     */
    ['__on_start.webserver'] () {
        this.log.info("TemplateService sees it's time to start web servers.");
    }
}

module.exports = {
    TemplateService
};

