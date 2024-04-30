const APIError = require("../../api/APIError");
const eggspress = require("../../api/eggspress");
const { UserActorType } = require("../../services/auth/Actor");
const { DB_WRITE } = require("../../services/database/consts");
const { Context } = require("../../util/context");

module.exports = eggspress('/auth/configure-2fa/:action', {
    subdomain: 'api',
    auth2: true,
    allowedMethods: ['POST'],
}, async (req, res, next) => {
    const action = req.params.action;
    const x = Context.get();

    // Only users can configure 2FA
    const actor = Context.get('actor');
    if ( ! (actor.type instanceof UserActorType) ) {
        throw APIError.create('forbidden');
    }

    const user = actor.type.user;

    const actions = {};

    const db = await x.get('services').get('database').get(DB_WRITE, '2fa');

    actions.enable = async () => {
        const svc_otp = x.get('services').get('otp');
        const result = svc_otp.create_secret();
        await db.write(
            `UPDATE user SET otp_secret = ? WHERE uuid = ?`,
            [result.secret, user.uuid]
        );
        return result;
    };

    actions.disable = async () => {
        await db.write(
            `UPDATE user SET otp_secret = NULL WHERE uuid = ?`,
            [user.uuid]
        );
        return { success: true };
    };

    if ( ! actions[action] ) {
        throw APIError.create('invalid_action', null, { action });
    }

    const result = await actions[action]();

    res.json(result);
});
