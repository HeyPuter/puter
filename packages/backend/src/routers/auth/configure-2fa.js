const APIError = require("../../api/APIError");
const eggspress = require("../../api/eggspress");
const { get_user } = require("../../helpers");
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
        const user = await get_user({ id: req.user.id, force: true });

        if ( user.otp_enabled ) {
            throw APIError.create('2fa_already_enabled');
        }

        const svc_otp = x.get('services').get('otp');

        // generate secret
        const result = svc_otp.create_secret(user.username);

        // generate recovery codes
        result.codes = [];
        for ( let i = 0; i < 10; i++ ) {
            result.codes.push(svc_otp.create_recovery_code());
        }

        const hashed_recovery_codes = result.codes.map(code => {
            const crypto = require('crypto');
            const hash = crypto
                .createHash('sha256')
                .update(code)
                .digest('base64')
                // We're truncating the hash for easier storage, so we have 128
                // bits of entropy instead of 256. This is plenty for recovery
                // codes, which have only 48 bits of entropy to begin with.
                .slice(0, 22);
            return hash;
        });

        // update user
        await db.write(
            `UPDATE user SET otp_secret = ?, otp_recovery_codes = ? WHERE uuid = ?`,
            [result.secret, hashed_recovery_codes.join(','), user.uuid]
        );
        req.user.otp_secret = result.secret;
        req.user.otp_recovery_codes = hashed_recovery_codes.join(',');
        user.otp_secret = result.secret;
        user.otp_recovery_codes = hashed_recovery_codes.join(',');

        return result;
    };

    // IMPORTANT: only use to verify the user's 2FA setup;
    // this should never be used to verify the user's 2FA code
    // for authentication purposes.
    actions.test = async () => {
        const user = req.user;
        const svc_otp = x.get('services').get('otp');
        const code = req.body.code;
        const ok = svc_otp.verify(user.username, user.otp_secret, code);
        return { ok };
    };

    actions.enable = async () => {
        const svc_edgeRateLimit = req.services.get('edge-rate-limit');
        if ( ! svc_edgeRateLimit.check('enable-2fa') ) {
            return res.status(429).send('Too many requests.');
        }

        const user = await get_user({ id: req.user.id, force: true });

        // Verify that 2FA isn't already enabled
        if ( user.otp_enabled ) {
            throw APIError.create('2fa_already_enabled');
        }

        // Verify that TOTP secret was set (configuration step not skipped)
        if ( ! user.otp_secret ) {
            throw APIError.create('2fa_not_configured');
        }

        await db.write(
            `UPDATE user SET otp_enabled = 1 WHERE uuid = ?`,
            [user.uuid]
        );
        // update cached user
        req.user.otp_enabled = 1;

        const svc_email = req.services.get('email');
        await svc_email.send_email({ email: user.email }, 'enabled_2fa', {
            username: user.username,
        });

        return {};
    };

    if ( ! actions[action] ) {
        throw APIError.create('invalid_action', null, { action });
    }

    const result = await actions[action]();

    res.json(result);
});
