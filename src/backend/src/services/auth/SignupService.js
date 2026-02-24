//@ts-check
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { generate_random_username, send_email_verification_code, send_email_verification_token, username_exists } from '../../helpers.js';
import { OutcomeObject } from '../../util/outcomeutil.js';
import { validate_nonEmpty_string } from '../../util/validutil.js';
import BaseService from '../BaseService.js';
import { DB_WRITE } from '../database/consts.js';

export class CreatedUserOutcome {
    /**
     * @type {number|null}
     */
    user_id = null;
}

export class SignupService extends BaseService {
    /**
     * Creates a new user.
     * @async
     * @param {object} params - The parameters for creating a new user.
     * @param {object} [params.req] - The request object (if applicable).
     * @param {boolean} [params.temporary] - Whether the user is a temporary user.
     * @param {boolean} [params.oidc_only] - Whether the user created with OIDC
     * @param {boolean} [params.send_confirmation_code] - Whether to send a confirmation code instead of a token by email
     * @param {boolean} [params.assume_email_ownership] - If true, set email_confirmed=1 without sending verification (e.g. OIDC provider already verified).
     * @param {string|null} params.username - The username of the user.
     * @param {string|null} params.email - The email of the user.
     * @param {string|null} params.password - The password of the user.
     * @returns {Promise<OutcomeObject<CreatedUserOutcome>>} The outcome of the user creation.
     */
    async create_new_user ({
        req,
        temporary = false,
        oidc_only = false,
        send_confirmation_code = false,
        assume_email_ownership = false,
        username = null,
        email = null,
        password = null,
    }) {
        const outcome = new OutcomeObject(new CreatedUserOutcome());

        let raw_email = email;

        if ( ! username ) {
            throw new TypeError('username is a required parameter of create_new_user');
        }
        if ( !temporary && !validate_nonEmpty_string(email) ) {
            throw new TypeError('email is a required parameter of create_new_user');
        }

        // Temp users get default values; they cannot have emails or passwords
        if ( temporary ) {
            username = username ?? await generate_random_username();
            email = email ?? `${username}@nonexis.com`;
            password = 'login-is-not-enabled'; // arbitrary, but accurate
        }

        // Some installations of Puter are configured to disable
        // signup or temporary users. In these cases, we will specify
        // a failure message and abort creating a user.
        {
            const svc_featureFlag = this.services.get('feature-flag');
            const is_temp_users_disabled =
                await svc_featureFlag.check('temp-users-disabled');
            const is_user_signup_disabled =
                await svc_featureFlag.check('user-signup-disabled');

            if ( is_user_signup_disabled && is_temp_users_disabled ) {
                return outcome.fail(
                    'User signup and Temporary users are disabled.',
                    'signup.signup_and_temp_users_disabled',
                );
            }

            if ( temporary && is_temp_users_disabled ) {
                return outcome.fail(
                    'Temporary users are disabled.',
                    'signup.temp_users_disabled',
                );
            }

            if ( !temporary && is_user_signup_disabled ) {
                return outcome.fail(
                    'User signup is disabled.',
                    'signup.user_signup_disabled',
                );
            }
        }

        // Emit the `puter.signup` event
        // NOTICE: conditional early return
        {
            const svc_event = this.services.get('event');
            const event = { allow: true, outcome };

            if ( req ) {
                event.ip = req.headers?.['x-forwarded-for'] ||
                    req.connection?.remoteAddress;
                event.user_agent = req.headers?.['user-agent'];
                event.body = req.body;
            }

            await svc_event.emit('puter.signup', event);

            if ( ! event.allow ) {
                outcome.log('disallowed by a puter.signup listener');
                return outcome;
            }
        }

        if ( await username_exists(username) ) {
            return outcome.fail(
                'Username already exists',
                'username_already_exists',
            );
        }

        // These checks are required for non-temporary users
        if ( ! temporary ) {
            const db = this.services.get('database').get(DB_WRITE, 'create-user:not-temp-checks');
            const svc_cleanEmail = this.services.get('clean-email');
            raw_email = email;

            if ( ! email ) {
                return outcome.fail(
                    'An email address is required',
                    'email_required',
                );
            }

            email = svc_cleanEmail.clean(email);
            if ( ! await svc_cleanEmail.validate(email) ) {
                return outcome.fail(
                    'This email does not seem to be valid',
                    'email_invalid',
                );
            }

            let rows2 = await db.read(`SELECT EXISTS(
                    SELECT 1 FROM user WHERE (email=? OR clean_email=?) AND email_confirmed=1 AND password IS NOT NULL
                ) AS email_exists`, [raw_email, email]);
            if ( rows2[0].email_exists )
            {
                return outcome.fail(
                    'Email is already verified for another account',
                    'email_already_exists',
                );
            }
        }

        // TODO: this is where referral goes. We might drop
        // referral, so I'm leaving it out here for now.

        const user_uuid = uuidv4();
        const email_confirm_token = uuidv4();
        // TODO: `Math.random()` is not crypto-secure
        const email_confirm_code = `${Math.floor(100000 + Math.random() * 900000)}`;

        const audit_metadata = {};
        if ( req ) {
            audit_metadata.ip = req.connection.remoteAddress;
            audit_metadata.ip_fwd = req.headers['x-forwarded-for'];
            audit_metadata.user_agent = req.headers['user-agent'];
            audit_metadata.origin = req.headers['origin'];
            audit_metadata.server = this.global_config.server_id;
        }

        {
            const db = this.services.get('database').get(DB_WRITE, 'create-user:main-insert');

            const insert_res = await db.write(
                `INSERT INTO user
                (
                    username, email, clean_email, password, uuid, referrer, 
                    email_confirm_code, email_confirm_token, email_confirmed, free_storage, 
                    referred_by, audit_metadata, signup_ip, signup_ip_forwarded, 
                    signup_user_agent, signup_origin, signup_server
                ) 
                VALUES 
                (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                // username
                    username,
                    // email
                    temporary ? null : raw_email,
                    // normalized email
                    temporary ? null : email,
                    // password
                    (temporary || oidc_only) ? null : await bcrypt.hash(password, 8),
                    // uuid
                    user_uuid,
                    // referrer
                    req?.body?.referrer ?? null,
                    // email_confirm_code
                    email_confirm_code,
                    // email_confirm_token
                    email_confirm_token,
                    // email_confirmed (1 when assume_email_ownership, else 0)
                    assume_email_ownership ? 1 : 0,
                    // free_storage
                    this.global_config.storage_capacity,
                    // referred_by
                    // TODO: we might remove referalls so I'mm leaving out
                    // the value for the `referred_by` field for now
                    null,
                    // audit_metadata
                    JSON.stringify(audit_metadata),
                    // signup_ip
                    req?.connection?.remoteAddress ?? null,
                    // signup_ip_fwd
                    req?.headers?.['x-forwarded-for'] ?? null,
                    // signup_user_agent
                    req?.headers?.['user-agent'] ?? null,
                    // signup_origin
                    req?.headers?.['origin'] ?? null,
                    // signup_server
                    this.global_config.server_id ?? null,
                ],
            );

            // record activity (asynchronously)
            db.write(
                'UPDATE `user` SET `last_activity_ts` = now() WHERE id=? LIMIT 1',
                [insert_res.insertId],
            );

            // TODO: it would be VERY NICE if this was a calculated
            // group membership instead of something we store in the DB
            const svc_group = this.services.get('group');
            await svc_group.add_users({
                uid: temporary
                    ? this.global_config.default_temp_group
                    : this.global_config.default_user_group,
                users: [username],
            });

            const user_id = insert_res.insertId;
            outcome.infoObject.user_id = user_id;

            const [user] = await db.pread(
                'SELECT * FROM `user` WHERE `id` = ? LIMIT 1',
                [user_id],
            );

            // TODO(???): should user login happen here or by caller?
            {
                // const { token } = await svc_auth.create_session_token(user, {
                //     req,
                // });
            }

            if ( ! assume_email_ownership ) {
                if ( send_confirmation_code ) {
                    send_email_verification_code(email_confirm_code, email);
                } else {
                    send_email_verification_token(email_confirm_token, email, user_uuid);
                }
            }

            // TODO: This is where sending the referral code would
            // usually happen but we might remove referral so I'm
            // leaving it out for now.
            const svc_user = this.services.get('user');
            await svc_user.generate_default_fsentries({ user });

            // NOTE: `res.cookie` happens here in @signup.js but this
            // should be handled by the caller over here.

            {
                const svc_event = this.services.get('event');
                svc_event.emit('user.save_account', { user });
            }

            return outcome.success();
        }
    }
}
