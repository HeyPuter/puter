// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o-mini"}}
const { get_user } = require("../helpers");
const { Context } = require("../util/context");
const { TeePromise } = require('@heyputer/putility').libs.promise;
const { Actor, UserActorType } = require("./auth/Actor");
const BaseService = require("./BaseService");


/**
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
    * Initializes the SUService by creating instances of TeePromise for system user and actor.
    * This method is invoked during the construction of the SUService class.
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
     * Resolves the system actor and user upon booting the service.
     * This method fetches the system user and then creates an Actor
     * instance for the user, resolving both promises. It's called 
     * automatically during the boot process.
     *
     * @async
     * @returns {Promise<void>} A promise that resolves when both the 
     *                          system user and actor have been set.
     */
    async get_system_actor () {
        return this.sys_actor_;
    }
    /**
     * Retrieves the system actor instance.
     * 
     * This method returns a promise that resolves to the system actor. The actor
     * represents the system user and is initialized during the boot process.
     * 
     * @returns {Promise<TeePromise>} A promise that resolves to the system actor.
     */
    async sudo (actor, callback) {
        if ( ! callback ) {
            callback = actor;
            actor = await this.sys_actor_;
        }
        actor = Actor.adapt(actor);
        /**
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
        return await Context.get().sub({
            actor,
            user: actor.type.user,
        }).arun(callback);
    }
}

module.exports = {
    SUService,
};
