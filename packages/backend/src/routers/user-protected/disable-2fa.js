const { DB_WRITE } = require("../../services/database/consts");

module.exports = {
    route: '/disable-2fa',
    methods: ['POST'],
    handler: async (req, res, next) => {
        const db = req.services.get('database').get(DB_WRITE, '2fa.disable');
        await db.write(
            `UPDATE user SET otp_enabled = 0, otp_recovery_codes = NULL, otp_secret = NULL WHERE uuid = ?`,
            [req.user.uuid]
        );
        // update cached user
        req.user.otp_enabled = 0;

        const svc_email = req.services.get('email');
        await svc_email.send_email({ email: req.user.email }, 'disabled_2fa', {
            username: req.user.username,
        });

        res.send({ success: true });
    }
};
