const { get_user } = require("../helpers");
const { Context } = require("../util/context");
const { TeePromise } = require("../util/promise");
const { Actor, UserActorType } = require("./auth/Actor");
const BaseService = require("./BaseService");

class SUService extends BaseService {
    _construct () {
        this.sys_user_ = new TeePromise();
        this.sys_actor_ = new TeePromise();
    }
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
    async get_system_actor () {
        return this.sys_actor_;
    }
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
