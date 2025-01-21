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
const configurable_auth = require("../middleware/configurable_auth");
const { Context } = require("../util/context");
const { Endpoint } = require("../util/expressutil");
const BaseService = require("./BaseService");
const { Interface } = require("./drivers/meta/Construct");

// Permission flag that grants access to view all services in the kernel info system
const PERM_SEE_ALL = 'kernel-info:see-all-services';
// Permission flag that grants access to view all services in the kernel info system
const PERM_SEE_DRIVERS = 'kernel-info:see-all-drivers';


/**
* KernelInfoService class provides information about the kernel's services, modules, and interfaces.
* It handles listing available modules, services, and their implementations based on user permissions.
* The service exposes endpoints for querying kernel module information and manages access control
* through permission checks for viewing all services and drivers.
* @extends BaseService
*/
class KernelInfoService extends BaseService {
    async _init () {}

    /**
    * Installs routes for the kernel info service
    * @param {*} _ Unused parameter
    * @param {Object} param1 Object containing Express app instance
    * @param {Express} param1.app Express application instance
    * @private
    */
    ['__on_install.routes'] (_, { app }) {
        const router = (() => {
            const require = this.require;
            const express = require('express');
            return express.Router();
        })();
        
        app.use('/', router);
        
        Endpoint({
            route: '/lsmod',
            methods: ['GET', 'POST'],
            mw: [
                configurable_auth(),
            ],
            handler: async (req, res) => {
                const svc_permission = this.services.get('permission');
                
                const actor = Context.get('actor');
                const can_see_all = actor &&
                    await svc_permission.check(actor, PERM_SEE_ALL);
                const can_see_drivers = actor &&
                    await svc_permission.check(actor, PERM_SEE_DRIVERS);
                
                const interfaces = {};
                const svc_registry = this.services.get('registry');
                const col_interfaces = svc_registry.get('interfaces');
                for ( const interface_name of col_interfaces.keys() ) {
                    const iface = col_interfaces.get(interface_name);
                    console.log('-->', interface_name, iface);
                    if ( iface === undefined ) continue;
                    if ( iface.no_sdk ) continue;
                    interfaces[interface_name] = {
                        spec: (new Interface(
                            iface,
                            { name: interface_name }
                        )).serialize(),
                        implementors: {}
                    }
                }

                const services = [];
                for ( const k in this.services.modules_ ) {
                    const module_info = {
                        name: k,
                        services: []
                    };
                    
                    for ( const s_k of this.services.modules_[k].services_l ) {
                        const service_info = {
                            name: s_k,
                            traits: []
                        };
                        services.push(service_info);
                        
                        const service = this.services.get(s_k);
                        if ( service.list_traits ) {
                            const traits = service.list_traits();
                            for ( const trait of traits ) {
                                const corresponding_iface = interfaces[trait];
                                if ( ! corresponding_iface ) continue;
                                corresponding_iface.implementors[s_k] = {};
                            }
                            service_info.traits = service.list_traits();
                        }
                    }
                }
                
                // If actor doesn't have permission to see all drivers,
                // (granted by either "can_see_all" or "can_see_drivers")
                if ( ! can_see_all && ! can_see_drivers ) {
                    // only show interfaces with at least one implementation
                    // that the actor has permission to use
                    for ( const iface_name in interfaces ) {
                        for ( const impl_name in interfaces[iface_name].implementors ) {
                            const perm = `service:${impl_name}:ii:${iface_name}`;
                            const can_see_this = actor &&
                                await svc_permission.check(actor, perm);
                            if ( ! can_see_this ) {
                                delete interfaces[iface_name].implementors[impl_name];
                            }
                        }
                        if ( Object.keys(interfaces[iface_name].implementors).length < 1 ) {
                            delete interfaces[iface_name];
                        }
                    }
                }
                
                res.json({
                    interfaces,
                    ...(can_see_all ? { services } : {})
                });
            }
        }).attach(router);
    }
}

module.exports = {
    KernelInfoService,
};
