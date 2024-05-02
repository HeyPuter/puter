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

    actions.setup = async () => {
        const svc_otp = x.get('services').get('otp');

        // generate secret
        const result = svc_otp.create_secret(user.username);

        // generate recovery codes
        result.codes = [];
        for ( let i = 0; i < 10; i++ ) {
            result.codes.push(svc_otp.create_recovery_code());
        }

        // update user
        await db.write(
            `UPDATE user SET otp_secret = ?, otp_recovery_codes = ? WHERE uuid = ?`,
            [result.secret, result.codes.join(','), user.uuid]
        );
        req.user.otp_secret = result.secret;
        req.user.otp_recovery_codes = result.codes.join(',');

        return result;
    };

    actions.enable = async () => {
        await db.write(
            `UPDATE user SET otp_enabled = 1 WHERE uuid = ?`,
            [user.uuid]
        );
        // update cached user
        req.user.otp_enabled = 1;
        return {};
    };

    actions.disable = async () => {
        await db.write(
            `UPDATE user SET otp_enabled = 0, otp_recovery_codes = '' WHERE uuid = ?`,
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
