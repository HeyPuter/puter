/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const { DBKVStore } = require("../drivers/DBKVStore");
const { EntityStoreImplementation } = require("../drivers/EntityStoreImplementation");
const { HelloWorld } = require("../drivers/HelloWorld");
const BaseService = require("./BaseService");

class SelfhostedService extends BaseService {
    static description = `
        Registers drivers for self-hosted Puter instances.
    `

    async _init () {
        const svc_driver = this.services.get('driver');

        svc_driver.register_driver('helloworld', new HelloWorld());
        svc_driver.register_driver('puter-kvstore', new DBKVStore());
        svc_driver.register_driver('puter-apps', new EntityStoreImplementation({ service: 'es:app' }));
        svc_driver.register_driver('puter-subdomains', new EntityStoreImplementation({ service: 'es:subdomain' }));
        svc_driver.register_driver('puter-notifications', new EntityStoreImplementation({ service: 'es:notification' }));
    }
}

module.exports = { SelfhostedService };
