const eggspress = require("../../api/eggspress");
const { UserActorType } = require("../../services/auth/Actor");
const { Context } = require("../../util/context");
const APIError = require('../../api/APIError');

module.exports = eggspress('/auth/list-sessions', {
    subdomain: 'api',
    auth2: true,
    allowedMethods: ['GET'],
}, async (req, res, next) => {
    const x = Context.get();
    const svc_auth = x.get('services').get('auth');

    // Only users can list their own sessions
    // apps, access tokens, etc should NEVER access this
    const actor = x.get('actor');
    if ( ! (actor.type instanceof UserActorType) ) {
        throw APIError.create('forbidden');
    }

    const sessions = await svc_auth.list_sessions(actor);

    res.json(sessions);
});
