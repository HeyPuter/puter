/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
'use strict';
const express = require('express');
const router = new express.Router();
const { get_user, body_parser_error_handler, invalidate_cached_user_by_id } = require('../../helpers');
const { UserActorType } = require('../../services/auth/Actor');
const { Context } = require('../../util/context');
const { DB_WRITE } = require('../../services/database/consts');
const config = require('../../config');
const validator = require('validator');
const auth2 = require('../../middleware/auth2');

// ---- Registration: begin (requires auth) ----
router.post(
    '/auth/webauthn/register/begin',
    express.json(),
    body_parser_error_handler,
    auth2,
    async (req, res) => {
        const actor = Context.get('actor');
        if ( !actor || !(actor.type instanceof UserActorType) ) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const svc_webauthn = req.services.get('webauthn');
        const user = await get_user({ id: req.user.id, force: true });

        try {
            const options = await svc_webauthn.generate_registration_options({ user, req });
            res.json(options);
        } catch (e) {
            console.error('[webauthn] register/begin error:', e);
            res.status(500).json({ error: e.message });
        }
    },
);

// ---- Registration: complete (requires auth) ----
router.post(
    '/auth/webauthn/register/complete',
    express.json(),
    body_parser_error_handler,
    auth2,
    async (req, res) => {
        const actor = Context.get('actor');
        if ( !actor || !(actor.type instanceof UserActorType) ) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        if ( ! req.body.response ) return res.status(400).json({ error: 'response is required' });

        const svc_webauthn = req.services.get('webauthn');
        const user = await get_user({ id: req.user.id, force: true });

        try {
            const credential_data = await svc_webauthn.verify_registration({
                user,
                response: req.body.response,
                req,
            });
            await svc_webauthn.save_credential({
                user_id: user.id,
                credential_data,
                name: req.body.name,
            });
            invalidate_cached_user_by_id(user.id);
            res.json({ ok: true });
        } catch (e) {
            console.error('[webauthn] register/complete error:', e);
            res.status(400).json({ error: e.message });
        }
    },
);

// ---- List credentials (requires auth) ----
router.get('/auth/webauthn/credentials', auth2, async (req, res) => {
    const actor = Context.get('actor');
    if ( !actor || !(actor.type instanceof UserActorType) ) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const svc_webauthn = req.services.get('webauthn');
    const credentials = await svc_webauthn.list_credentials(req.user.id);
    const db = req.services.get('database').get(DB_WRITE, 'webauthn');
    const [user_row] = await db.read(
        'SELECT password_required FROM user WHERE id = ? LIMIT 1',
        [req.user.id],
    );
    res.json({
        credentials,
        password_required: Number(user_row?.password_required ?? 1),
    });
});

// ---- Delete credential (requires auth) ----
router.delete('/auth/webauthn/credentials/:id', auth2, async (req, res) => {
    const actor = Context.get('actor');
    if ( !actor || !(actor.type instanceof UserActorType) ) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const svc_webauthn = req.services.get('webauthn');
    const db = req.services.get('database').get(DB_WRITE, 'webauthn');
    const [user_row] = await db.read(
        'SELECT password_required FROM user WHERE id = ? LIMIT 1',
        [req.user.id],
    );
    const credentials = await svc_webauthn.list_credentials(req.user.id);

    // Prevent account lockout: in passwordless mode a user must keep at least one passkey.
    if ( Number(user_row?.password_required ?? 1) === 0 && credentials.length <= 1 ) {
        return res.status(400).json({
            error: 'Cannot delete your last passkey while passwordless login is enabled. Add a password first.',
        });
    }

    await svc_webauthn.delete_credential({
        user_id: req.user.id,
        credential_id: req.params.id,
    });
    invalidate_cached_user_by_id(req.user.id);
    res.json({ ok: true });
});

// ---- Rename credential (requires auth) ----
router.post(
    '/auth/webauthn/credentials/:id/rename',
    express.json(),
    body_parser_error_handler,
    auth2,
    async (req, res) => {
        const actor = Context.get('actor');
        if ( !actor || !(actor.type instanceof UserActorType) ) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        if ( ! req.body.name ) return res.status(400).json({ error: 'name is required' });

        const svc_webauthn = req.services.get('webauthn');
        await svc_webauthn.rename_credential({
            user_id: req.user.id,
            credential_id: req.params.id,
            name: req.body.name,
        });
        res.json({ ok: true });
    },
);

// ---- Authentication: begin (PUBLIC - no auth needed) ----
router.post('/auth/webauthn/authenticate/begin', express.json(), body_parser_error_handler, async (req, res) => {
    const svc_webauthn = req.services.get('webauthn');
    let user = null;

    if ( req.body.email && validator.isEmail(req.body.email) ) {
        user = await get_user({ email: req.body.email, cached: false });
    } else if ( req.body.username ) {
        user = await get_user({ username: req.body.username, cached: false });
    }

    try {
        const options = await svc_webauthn.generate_authentication_options({ user, req });
        res.json(options);
    } catch (e) {
        console.error('[webauthn] authenticate/begin error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ---- Authentication: complete (PUBLIC - creates session) ----
router.post('/auth/webauthn/authenticate/complete', express.json(), body_parser_error_handler, async (req, res) => {
    const svc_webauthn = req.services.get('webauthn');
    const svc_auth     = req.services.get('auth');

    if ( ! req.body.response ) return res.status(400).json({ proceed: false, error: 'response is required' });

    // 2FA path: jwt token was issued after password check in /login
    let user_id = null;
    if ( req.body.webauthn_jwt_token ) {
        const svc_token = req.services.get('token');
        let decoded;
        try {
            decoded = svc_token.verify('webauthn', req.body.webauthn_jwt_token);
        } catch (e) {
            return res.status(400).json({ proceed: false, error: 'Invalid token' });
        }
        const u = await get_user({ uuid: decoded.user_uid, cached: false });
        if ( ! u ) return res.status(400).json({ proceed: false, error: 'User not found' });
        user_id = u.id;
    }

    try {
        const result = await svc_webauthn.verify_authentication({
            user_id,
            response: req.body.response,
            req,
        });

        const user = await get_user({ id: result.user_id, cached: false });
        if ( ! user ) return res.status(400).json({ proceed: false, error: 'User not found' });

        const { session, token: session_token } = await svc_auth.create_session_token(user, { req });
        const gui_token = svc_auth.create_gui_token(user, session);

        res.cookie(config.cookie_name, session_token, {
            sameSite: 'none',
            secure: true,
            httpOnly: true,
        });

        return res.json({
            proceed: true,
            next_step: 'complete',
            token: gui_token,
            user: {
                username: user.username,
                uuid: user.uuid,
                email: user.email,
                email_confirmed: user.email_confirmed,
                is_temp: (user.password === null && user.email === null),
            },
        });
    } catch (e) {
        console.error('[webauthn] authenticate/complete error:', e);
        return res.status(400).json({ proceed: false, error: e.message });
    }
});

// ---- Remove password - passkey-only login (requires auth) ----
router.post(
    '/auth/webauthn/remove-password',
    express.json(),
    body_parser_error_handler,
    auth2,
    async (req, res) => {
        const actor = Context.get('actor');
        if ( !actor || !(actor.type instanceof UserActorType) ) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const svc_webauthn = req.services.get('webauthn');
        const credentials  = await svc_webauthn.list_credentials(req.user.id);

        if ( credentials.length === 0 ) {
            return res.status(400).json({ error: 'Must have at least one passkey registered first' });
        }

        const has_synced_passkey = credentials.some(c => c.backed_up);
        if ( ! has_synced_passkey ) {
            return res.status(400).json({ error: 'Must have at least one synced passkey (not only security keys) to remove password' });
        }

        const db = req.services.get('database').get(DB_WRITE, 'webauthn');
        const update_result = await db.write(
            'UPDATE user SET password_required = 0 WHERE id = ?',
            [req.user.id],
        );
        if ( ! update_result?.anyRowsAffected ) {
            return res.status(500).json({ error: 'Failed to update password_required' });
        }

        // Disable 2FA when switching to passwordless — avoids a state where
        // the user has no password but still has OTP configured (which would
        // require entering an OTP after a passkey assertion, a confusing UX).
        await db.write(
            'UPDATE user SET otp_enabled = 0, otp_recovery_codes = NULL, otp_secret = NULL WHERE id = ?',
            [req.user.id],
        );

        const [updated_user_row] = await db.read(
            'SELECT password_required FROM user WHERE id = ? LIMIT 1',
            [req.user.id],
        );
        invalidate_cached_user_by_id(req.user.id);
        res.json({
            ok: true,
            password_required: Number(updated_user_row?.password_required ?? 1),
            otp_disabled: true,
        });
    },
);

module.exports = router;
