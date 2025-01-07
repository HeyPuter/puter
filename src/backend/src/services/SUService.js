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

// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o-mini"}}
const { get_user } = require("../helpers");
const { Context } = require("../util/context");
const { TeePromise } = require('@heyputer/putility').libs.promise;
const { Actor, UserActorType } = require("./auth/Actor");
const BaseService = require("./BaseService");


/**
* "SUS"-Service (Super-User Service)
* Wherever you see this, be suspicious! (it escalates privileges)
*
* SUService is a specialized service that extends BaseService,
* designed to manage system user and actor interactions. It 
* handles the initialization of system-level user and actor 
* instances, providing methods to retrieve the system actor 
* and perform actions with elevated privileges.
*/
class SUService extends BaseService {
    /**
    * Initializes the SUService instance, creating promises for system user 
    * and system actor. This method does not take any parameters and does 
    * not return a value.
    */
    _construct () {
        this.sys_user_ = new TeePromise();
        this.sys_actor_ = new TeePromise();
    }
    
    /**
     * Resolves the system actor and user upon booting the service.
     * This method fetches the system user and then creates an Actor
     * instance for the user, resolving both promises. It's called 
     * automatically during the boot process.
     *
     * @async
     * @returns {Promise<void>} A promise that resolves when both the 
     *                          system user and actor have been set.
     */
    async ['__on_boot.consolidation'] () {
        const sys_user = await get_user({ username: 'system' });
        this.sys_user_.resolve(sys_user);
        const sys_actor = new Actor({
            type: new UserActorType({
                user: sys_user,
            }),
        });
        this.sys_actor_.resolve(sys_actor);
    }

    /**
     * Retrieves the system actor instance.
     * 
     * This method returns a promise that resolves to the system actor. The actor
     * represents the system user and is initialized during the boot process.
     * 
     * @returns {Promise<TeePromise>} A promise that resolves to the system actor.
     */
    async get_system_actor () {
        return this.sys_actor_;
    }
    
    /**
    * Super-User Do
    * 
    * Performs an operation as a specified actor, allowing for callback execution 
    * within the context of that actor. If no actor is provided, the system actor 
    * is used by default. The adapted actor is then utilized to execute the callback 
    * under the appropriate user context.
    * 
    * @param {Actor} actor - The actor to perform the operation as. 
    * If omitted, defaults to the system actor.
    * @param {Function} callback - The function to execute within the actor's context.
    * @returns {Promise} A promise that resolves with the result of the callback execution.
    */
    async sudo (actor, callback) {
        if ( ! callback ) {
            callback = actor;
            actor = await this.sys_actor_;
        }
        actor = Actor.adapt(actor);
        return await Context.get().sub({
            actor,
            user: actor.type.user,
        }).arun(callback);
    }
}

module.exports = {
    SUService,
};
