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
import config from '../config.js';
import { DB_WRITE } from '../services/database/consts.js';
import { generate_identifier } from '../util/identifier.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Create a new user for signup. Common behavior shared by POST /signup and OIDC signup.
 * Form-signup path is still handled in signup.js; this handles OIDC and will support form signup after refactor.
 *
 * @param {object} services - Backend services (from req.services)
 * @param {object} options - Creation options. For OIDC: { providerId, userinfo }. For form signup: TBD (to be refactored from signup.js).
 * @returns {Promise<object|null>} The created user, or null on failure (e.g. email already registered).
 */
async function signup_create_new_user (services, options) {
    const { providerId, userinfo } = options;
    if ( !providerId || !userinfo ) {
        // Form signup: to be refactored from signup.js; not implemented here yet.
        return null;
    }

    const db = await services.get('database').get(DB_WRITE, 'auth');
    const svc_group = services.get('group');
    const svc_user = services.get('user');
    const svc_oidc = services.get('oidc');
    if ( ! svc_oidc ) return null;

    const claims = userinfo;
    let username = (claims.name || claims.email || '').toString().trim();
    if ( username ) {
        username = username.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
        if ( username.length > 45 ) username = username.slice(0, 45);
    }
    if ( !username || !/^\w+$/.test(username) ) {
        let candidate;
        do {
            candidate = generate_identifier();
            const [r] = await db.pread('SELECT 1 FROM user WHERE username = ? LIMIT 1', [candidate]);
            if ( ! r ) username = candidate;
        } while ( !username );
    } else {
        const [existing] = await db.pread('SELECT 1 FROM user WHERE username = ? LIMIT 1', [username]);
        if ( existing ) {
            let suffix = 1;
            while ( true ) {
                const candidate = `${username}${suffix}`;
                const [r] = await db.pread('SELECT 1 FROM user WHERE username = ? LIMIT 1', [candidate]);
                if ( ! r ) {
                    username = candidate; break;
                }
                suffix++;
            }
        }
    }

    const email = (claims.email || '').toString().trim() || null;
    const clean_email = email ? email.toLowerCase().trim() : null;
    if ( clean_email ) {
        const [existingEmail] = await db.pread('SELECT 1 FROM user WHERE clean_email = ? LIMIT 1', [clean_email]);
        if ( existingEmail ) {
            return null; // email already registered; caller should return error
        }
    }

    const user_uuid = uuidv4();
    const email_confirm_code = String(Math.floor(100000 + Math.random() * 900000));
    const email_confirm_token = uuidv4();

    await db.write(`INSERT INTO user (
            username, email, clean_email, password, uuid, referrer,
            email_confirm_code, email_confirm_token, free_storage,
            referred_by, email_confirmed, requires_email_confirmation
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
        username,
        email,
        clean_email,
        null,
        user_uuid,
        null,
        email_confirm_code,
        email_confirm_token,
        config.storage_capacity,
        null,
        1,
        0,
    ]);
    const [inserted] = await db.pread('SELECT id FROM user WHERE uuid = ? LIMIT 1', [user_uuid]);
    const user_id = inserted.id;

    await svc_oidc.linkProviderToUser(user_id, providerId, claims.sub, null);

    await svc_group.add_users({
        uid: config.default_user_group,
        users: [username],
    });

    const [user] = await db.pread('SELECT * FROM user WHERE id = ? LIMIT 1', [user_id]);
    if ( user && user.metadata && typeof user.metadata === 'string' ) {
        user.metadata = JSON.parse(user.metadata);
    } else if ( user && !user.metadata ) {
        user.metadata = {};
    }
    await svc_user.generate_default_fsentries({ user });

    return user;
}

export default signup_create_new_user;
