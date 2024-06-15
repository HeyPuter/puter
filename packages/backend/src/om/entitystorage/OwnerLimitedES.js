const { AppUnderUserActorType, UserActorType } = require("../../services/auth/Actor");
const context = require("../../util/context");
const { Context } = require("../../util/context");
const { Eq, Or } = require("../query/query");
const { BaseES } = require("./BaseES");
const { Entity } = require("./Entity");

class OwnerLimitedES extends BaseES {
    // Limit selection to entities owned by the app of the current actor.
    async select (options) {
        const actor = Context.get('actor');

        if ( ! (actor.type instanceof UserActorType) ) {
            return [];
        }

        let condition = new Eq({
            key: 'owner',
            value: actor.type.user.id,
        });

        options.predicate = options.predicate?.and
            ? options.predicate.and(condition)
            : condition;

        return await this.upstream.select(options);
    }

    // Limit read to entities owned by the app of the current actor.
    async read (uid) {
        const actor = Context.get('actor');
        if ( ! (actor.type instanceof UserActorType) ) {
            return null;
        }

        const entity = await this.upstream.read(uid);
        if ( ! entity ) return null;
        
        const entity_owner = await entity.get('owner');
        let owner_id = entity_owner?.id;
        if ( entity_owner.id !== actor.type.user.id ) {
            return null;
        }

        return entity;
    }
}

module.exports = {
    OwnerLimitedES,
};

