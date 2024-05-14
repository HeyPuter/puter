// TODO: DRY: This is the same function used by UIWindowChangePassword!

const { invalidate_cached_user } = require("../../helpers");
const { DB_WRITE } = require("../../services/database/consts");

// duplicate definition is in src/helpers.js (puter GUI)
const check_password_strength = (password) => {
    // Define criteria for password strength
    const criteria = {
        minLength: 8,
        hasUpperCase: /[A-Z]/.test(password),
        hasLowerCase: /[a-z]/.test(password),
        hasNumber: /\d/.test(password),
        hasSpecialChar: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)
    };

    let overallPass = true;

    // Initialize report object
    let criteria_report = {
        minLength: {
            message: `Password must be at least ${criteria.minLength} characters long`,
            pass: password.length >= criteria.minLength,
        },
        hasUpperCase: {
            message: 'Password must contain at least one uppercase letter',
            pass: criteria.hasUpperCase,
        },
        hasLowerCase: {
            message: 'Password must contain at least one lowercase letter',
            pass: criteria.hasLowerCase,
        },
        hasNumber: {
            message: 'Password must contain at least one number',
            pass: criteria.hasNumber,
        },
        hasSpecialChar: {
            message: 'Password must contain at least one special character',
            pass: criteria.hasSpecialChar,
        },
    };

    // Check overall pass status and add messages
    for (let criterion in criteria) {
        if (!criteria_report[criterion].pass) {
            overallPass = false;
            break;
        }
    }

    return {
        overallPass: overallPass,
        report: criteria_report,
    };
}

module.exports = {
    route: '/change-password',
    methods: ['POST'],
    handler: async (req, res, next) => {
        // Validate new password
        const { new_pass } = req.body;
        const { overallPass: strong } = check_password_strength(new_pass);
        if ( ! strong ) {
            req.status(400).send('Password does not meet requirements.');
        }

        // Update user
        // TODO: DI for endpoint definitions like this one
        const bcrypt = require('bcrypt');
        const db = req.services.get('database').get(DB_WRITE, 'auth');
        await db.write(
            'UPDATE user SET password=?, `pass_recovery_token` = NULL, `change_email_confirm_token` = NULL WHERE `id` = ?',
            [await bcrypt.hash(req.body.new_pass, 8), req.user.id]
        );
        invalidate_cached_user(req.user);

        // Notify user about password change
        // TODO: audit log for user in security tab
        const svc_email = req.services.get('email');
        svc_email.send_email({ email: req.user.email }, 'password_change_notification');

        // Kick out all other sessions
        const svc_auth = req.services.get('auth');
        const sessions = await svc_auth.list_sessions(req.actor);
        for ( const session of sessions ) {
            if ( session.current ) continue;
            await svc_auth.revoke_session(req.actor, session.uuid);
        }

        return res.send('Password successfully updated.')
    }
};
