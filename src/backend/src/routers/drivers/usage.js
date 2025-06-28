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
const APIError = require("../../api/APIError");
const eggspress = require("../../api/eggspress");
const { UserActorType } = require("../../services/auth/Actor");
const { DB_READ } = require("../../services/database/consts");
const { Context } = require("../../util/context");

module.exports = eggspress('/drivers/usage', {
    subdomain: 'api',
    auth2: true,
    allowedMethods: ['GET'],
}, async (req, res, next) => {
    const x = Context.get();

    const actor = x.get('actor');

    // Apps cannot (currently) check usage on behalf of users
    if ( ! ( actor.type instanceof UserActorType ) ) {
        throw APIError.create('forbidden');
    }

    const db = x.get('services').get('database').get(DB_READ, 'drivers');

    const usages = {
        user: {}, // map[str(iface:method)]{date,count,max}
        apps: {}, // []{app,map[str(iface:method)]{date,count,max}}
        app_objects: {},
        usages: [],
    };
    
    const event = {
        actor,
        usages: [],
    };
    const svc_event = x.get('services').get('event');
    await svc_event.emit('usages.query', event);
    usages.usages = event.usages;


    const user_is_verified = actor.type.user.email_confirmed;

    for ( const k in usages.apps ) {
        usages.apps[k] = Object.values(usages.apps[k]);
    }

    res.json({
        user: Object.values(usages.user),
        apps: usages.apps,
        app_objects: usages.app_objects,
        usages: usages.usages,
    });
})
