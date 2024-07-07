const APIError = require("../../api/APIError");
const eggspress = require("../../api/eggspress");
const { UserActorType } = require("../../services/auth/Actor");
const { Context } = require("../../util/context");

module.exports = eggspress('/auth/revoke-session', {
    subdomain: 'api',
    auth2: true,
    allowedMethods: ['POST'],
}, async (req, res, next) => {
    const x = Context.get();
    const svc_auth = x.get('services').get('auth');

    // Only users can list their own sessions
    // apps, access tokens, etc should NEVER access this
    const actor = x.get('actor');
    if ( ! (actor.type instanceof UserActorType) ) {
        throw APIError.create('forbidden');
    }

    // Ensure valid UUID
    if ( ! req.body.uuid || typeof req.body.uuid !== 'string' ) {
        throw APIError.create('field_invalid', null, {
            key: 'uuid',
            expected: 'string'
        });
    }

    const sessions = await svc_auth.revoke_session(
        actor, req.body.uuid);

    res.json({ sessions });
});
