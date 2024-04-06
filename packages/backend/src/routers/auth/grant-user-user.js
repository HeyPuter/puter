const APIError = require("../../api/APIError");
const eggspress = require("../../api/eggspress");
const { UserActorType } = require("../../services/auth/Actor");
const { Context } = require("../../util/context");

module.exports = eggspress('/auth/grant-user-user', {
    subdomain: 'api',
    auth2: true,
    allowedMethods: ['POST'],
}, async (req, res, next) => {
    const x = Context.get();
    const svc_permission = x.get('services').get('permission');

    // Only users can grant user-user permissions
    const actor = Context.get('actor');
    if ( ! (actor.type instanceof UserActorType) ) {
        throw APIError.create('forbidden');
    }

    if ( ! req.body.target_username ) {
        throw APIError.create('field_missing', null, { key: 'target_username' });
    }

    await svc_permission.grant_user_user_permission(
        actor, req.body.target_username, req.body.permission,
        req.body.extra || {}, req.body.meta || {}
    );

    res.json({});
});
