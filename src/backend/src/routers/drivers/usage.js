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
const { get_app } = require("../../helpers");
const { UserActorType } = require("../../services/auth/Actor");
const { DB_READ } = require("../../services/database/consts");
const { Context } = require("../../util/context");
const { hash_serializable_object } = require("../../util/datautil");

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

    const rows = await db.read(
        'SELECT * FROM `service_usage_monthly` WHERE user_id=? ' +
            'AND `year` = ? AND `month` = ?',
        [
            actor.type.user.id,
            new Date().getUTCFullYear(),
            new Date().getUTCMonth() + 1,
        ]
    );

    const user_is_verified = actor.type.user.email_confirmed;

    for ( const row of rows ) {
        const app = await get_app({ id: row.app_id });
        
        let extra_parsed;
        try {
            extra_parsed = db.case({
                mysql: () => row.extra,
                otherwise: () => JSON.parse(row.extra),
            })();
        } catch ( e ) {
            console.log(
                '\x1B[31;1m error parsing monthly usage extra',
                row.extra, e,
            );
            continue;
        }

        const identifying_fields = {
            service: extra_parsed,
            year: row.year,
            month: row.month,
        };

        // EntityStorage identifiers weren't tracked properly. We don't realy need
        // to track or show them, so this isn't a huge deal, but we need to make
        // sure they don't populate garbage data into the usage report.
        if ( ! identifying_fields.service['driver.implementation'] ) {
            continue;
        }
        if ( identifying_fields.service['driver.interface'] === 'puter-es' ) {
            continue;
        }
        if ( identifying_fields.service['driver.interface'] === 'puter-kvstore' ) {
            continue;
        }

        const svc_driverUsage = req.services.get('driver-usage-policy');
        const policy = await svc_driverUsage.get_effective_policy({
            actor,
            service_name: identifying_fields.service['driver.implementation'],
            trait_name: identifying_fields.service['driver.interface'],
        });
        
        // console.log(`POLICY FOR ${identifying_fields.service['driver.implementation']} ${identifying_fields.service['driver.interface']}`, policy);

        const user_usage_key = hash_serializable_object(identifying_fields);

        if ( ! usages.user[user_usage_key] ) {
            usages.user[user_usage_key] = {
                ...identifying_fields,
                policy,
            };
            usages.user[user_usage_key].monthly_limit =
                policy?.['monthly-limit'] ??
                policy?.['monthy-limit'] ??
                null;
            if ( ! policy ) {
                usages.user[user_usage_key].monthly_limit = 0;
            }
        }

        usages.user[user_usage_key].monthly_usage =
            (usages.user[user_usage_key].monthly_usage || 0) + row.count;

        // const user_method_usage = usages.user.find(
        //     u => u.key === row.key
        // );

        // This will be
        if ( ! app ) continue;

        const app_usages = usages.apps[app.uid]
            ?? (usages.apps[app.uid] = {});

        const id_plus_app = {
            ...identifying_fields,
            app_uid: app.uid,
        };

        usages.app_objects[app.uid] = app;

        const app_usage_key = hash_serializable_object(id_plus_app);

        // DISABLED FOR NOW: need to rework this for the new policy system
        if ( false ) if ( ! app_usages[app_usage_key] ) {
            app_usages[app_usage_key] = {
                ...identifying_fields,
            };

            const method_key = row.extra['driver.implementation'] +
                ':' + row.extra['driver.method'];
            const sla_key = `driver:impl:${method_key}`;

            const svc_sla = x.get('services').get('sla');
            const sla = await svc_sla.get('app_default', sla_key);

            app_usages[app_usage_key].monthly_limit =
                sla?.monthly_limit || null;
        }

        // TODO: DRY
        // remove some privileged information
        delete app.id;
        delete app.approved_for_listing;
        delete app.approved_for_opening_items;
        delete app.godmode;
        delete app.owner_user_id;

        if ( ! app_usages[app_usage_key] ) {
            app_usages[app_usage_key] = {};
        }

        app_usages[app_usage_key].monthly_usage =
            (app_usages[app_usage_key].monthly_usage || 0) + row.count;

        // usages.apps.push(usage);
    }

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
