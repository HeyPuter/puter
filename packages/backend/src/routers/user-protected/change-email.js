const APIError = require("../../api/APIError");
const { DB_WRITE } = require("../../services/database/consts");
const jwt = require('jsonwebtoken');
const validator = require('validator');
const crypto = require('crypto');
const config = require("../../config");

module.exports = {
    route: '/change-email',
    methods: ['POST'],
    handler: async (req, res, next) => {
        const user = req.user;
        const new_email = req.body.new_email;

        console.log('DID REACH HERE');

        // TODO: DRY: signup.js
        // validation
        if( ! new_email ) {
            throw APIError.create('field_missing', null, { key: 'new_email' });
        }
        if ( typeof new_email !== 'string' ) {
            throw APIError.create('field_invalid', null, {
                key: 'new_email', expected: 'a valid email address' });
        }
        if ( ! validator.isEmail(new_email) ) {
            throw APIError.create('field_invalid', null, {
                key: 'new_email', expected: 'a valid email address' });
        }
        
        // check if email is already in use
        const db = req.services.get('database').get(DB_WRITE, 'auth');
        const rows = await db.read(
            'SELECT COUNT(*) AS `count` FROM `user` WHERE `email` = ?',
            [new_email]
        );
        if ( rows[0].count > 0 ) {
            throw APIError.create('email_already_in_use', null, { email: new_email });
        }

        // generate confirmation token
        const token = crypto.randomBytes(4).toString('hex');
        const jwt_token = jwt.sign({
            user_id: user.id,
            token,
        }, config.jwt_secret, { expiresIn: '24h' });

        // send confirmation email
        const svc_email = req.services.get('email');
        await svc_email.send_email({ email: new_email }, 'email_change_request', {
            confirm_url: `${config.origin}/change_email/confirm?token=${jwt_token}`,
            username: user.username,
        });
        const old_email = user.email;
        // TODO: NotificationService
        await svc_email.send_email({ email: old_email }, 'email_change_notification', {
            new_email: new_email,
        });

        // update user
        await db.write(
            'UPDATE `user` SET `unconfirmed_change_email` = ?, `change_email_confirm_token` = ? WHERE `id` = ?',
            [new_email, token, user.id]
        );

        res.send({ success: true });
    }
};
