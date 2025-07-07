// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o"}}
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
const { Actor } = require("./auth/Actor");
const BaseService = require("./BaseService");
const { DB_READ } = require("./database/consts");

/**
 * Get user by one of a variety of identifying properties.
 * 
 * Pass `cached: false` to options to force a database read.
 * Pass `force: true` to options to force a primary database read.
 * 
 * This provides the functionality of `get_user` (helpers.js)
 * as a service so that other services can register identifying
 * properties for caching.
 * 
 * The original `get_user` function now uses this service.
 */
class GetUserService extends BaseService {
    /**
    * Constructor for GetUserService.
    * Initializes the set of identifying properties used to retrieve user data.
    */
    _construct () {
        this.id_properties = new Set();

        this.id_properties.add('username');
        this.id_properties.add('uuid');
        this.id_properties.add('id');
        this.id_properties.add('email');
        this.id_properties.add('referral_code');
    }

    /**
    * Initializes the GetUserService instance.
    * This method prepares any necessary internal structures or states.
    * It is called automatically upon instantiation of the service.
    * 
    * @returns {Promise<void>} A promise that resolves when the initialization is complete.
    */
    async _init () {
    }

    /**
     * Retrieves a user object based on the provided options.
     * 
     * This method queries the user from cache or database,
     * depending on the caching options provided. If the user 
     * is found, it also calls the 'whoami' service to enrich 
     * the user details before returning.
     * 
     * @param {Object} options - The options for retrieving the user.
     * @param {boolean} [options.cached=true] - Indicates if caching should be used.
     * @param {boolean} [options.force=false] - Forces a read from the database regardless of cache.
     * @returns {Promise<Object|null>} The user object if found, else null.
     */
    async get_user (options) {
        const user = await this.get_user_(options);
        if ( ! user ) return null;
        
        const svc_whoami = this.services.get('whoami');
        await svc_whoami.get_details({ user }, user);
        return user;
    }
    
    async refresh_actor (actor) {
        if ( actor.type.user ) {
            actor.type.user = await this.get_user({
                username: actor.type.user.username,
                force: true,
            });
        }
        return actor;
    }

    async get_user_ (options) {
        const services = this.services;

        /** @type BaseDatabaseAccessService */
        const db = services.get('database').get(DB_READ, 'filesystem');

        const cached = options.cached ?? true;

        if ( cached && ! options.force ) {
            for ( const prop of this.id_properties ) {
                if ( options.hasOwnProperty(prop) ) {
                    const user = kv.get(`users:${prop}:${options[prop]}`);
                    if ( user ) return user;
                }
            }
        }

        let user;

        if ( ! options.force ) {
            for ( const prop of this.id_properties ) {
                if ( options.hasOwnProperty(prop) ) {
                    [user] = await db.read(`SELECT * FROM \`user\` WHERE \`${prop}\` = ? LIMIT 1`, [options[prop]]);
                    if ( user ) break;
                }
            }
        }

        if ( ! user || ! user[0] ) {
            for ( const prop of this.id_properties ) {
                if ( options.hasOwnProperty(prop) ) {
                    [user] = await db.pread(`SELECT * FROM \`user\` WHERE \`${prop}\` = ? LIMIT 1`, [options[prop]]);
                    if ( user ) break;
                }
            }
        }

        if ( ! user ) return null;

        try {
            for ( const prop of this.id_properties ) {
                if ( user[prop] ) {
                    kv.set(`users:${prop}:${user[prop]}`, user);
                }
            }
        } catch (e) {
            console.error(e);
        }

        return user;
    }
    register_id_property (prop) {
        this.id_properties.add(prop);
    }
}

module.exports = { GetUserService };