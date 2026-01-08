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
const eggspress = require('../../api/eggspress');
const { Interface } = require('../../services/drivers/meta/Construct');
const { Context } = require('../../util/context');

module.exports = eggspress('/drivers/list-interfaces', {
    subdomain: 'api',
    auth2: true,
    allowedMethods: ['GET'],
}, async (req, res, next) => {
    const x = Context.get();
    const svc_driver = x.get('services').get('driver');

    const interfaces_raw = await svc_driver.list_interfaces();

    const interfaces = {};
    for ( const interface_name in interfaces_raw ) {
        if ( interfaces_raw[interface_name].no_sdk ) continue;
        interfaces[interface_name] = (new Interface(interfaces_raw[interface_name],
                        { name: interface_name })).serialize();
    }

    res.json(interfaces);
});
