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
const { BaseService } = require('../BaseService');
const { DB_READ, DB_WRITE } = require('../database/consts');

class WebAuthnService extends BaseService {

    _get_rpid (req) {
        if ( this.global_config.webauthn_rpid ) return this.global_config.webauthn_rpid;
        if ( req && req.hostname ) {
            // Strip 'api.' prefix so RP ID matches the page's domain, not the API subdomain
            const h = req.hostname;
            return h.startsWith('api.') ? h.slice(4) : h;
        }
        return 'puter.com';
    }

    _get_rpname () {
        return this.global_config.webauthn_rpname || 'Puter';
    }

    // Origin is supplied by the frontend (window.location.origin) so it always
    // matches the page domain, regardless of which API subdomain handled the request.
    _get_origin (req, body_origin) {
        if ( this.global_config.webauthn_origin ) return this.global_config.webauthn_origin;
        if ( body_origin ) return body_origin;
        const hostname = (req && req.hostname) || 'puter.com';
        const protocol = hostname === 'localhost' ? 'http' : 'https';
        return `${protocol}://${hostname}`;
    }

    async _cleanup_expired_challenges (db) {
        const now = Math.floor(Date.now() / 1000);
        await db.write('DELETE FROM webauthn_challenges WHERE expires_at < ?', [now]);
    }

    async generate_registration_options ({ user, req }) {
        const { generateRegistrationOptions } = await import('@simplewebauthn/server');
        const db = await this.services.get('database').get(DB_WRITE, 'webauthn');

        await this._cleanup_expired_challenges(db);

        const existing = await db.read(
            'SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = ?',
            [user.id],
        );

        const options = await generateRegistrationOptions({
            rpName: this._get_rpname(),
            rpID: this._get_rpid(req),
            userID: Buffer.from(user.uuid),
            userName: user.username,
            userDisplayName: user.username,
            attestationType: 'none',
            authenticatorSelection: {
                residentKey: 'preferred',
                userVerification: 'preferred',
            },
            excludeCredentials: existing.map(c => ({
                id: c.credential_id,
                transports: JSON.parse(c.transports || '[]'),
            })),
        });

        const expires_at = Math.floor(Date.now() / 1000) + 300;
        await db.write(
            'INSERT INTO webauthn_challenges (user_id, challenge, type, expires_at) VALUES (?, ?, ?, ?)',
            [user.id, options.challenge, 'registration', expires_at],
        );

        return options;
    }

    async verify_registration ({ user, response, req }) {
        const { verifyRegistrationResponse } = await import('@simplewebauthn/server');
        const db = await this.services.get('database').get(DB_WRITE, 'webauthn');

        const rows = await db.read(
            `SELECT * FROM webauthn_challenges
             WHERE user_id = ? AND type = 'registration'
             ORDER BY id DESC LIMIT 1`,
            [user.id],
        );

        if ( !rows || rows.length === 0 ) throw new Error('No pending registration challenge');

        const challenge = rows[0];
        if ( challenge.expires_at < Math.floor(Date.now() / 1000) ) {
            throw new Error('Challenge expired');
        }

        const verification = await verifyRegistrationResponse({
            response,
            expectedChallenge: challenge.challenge,
            expectedOrigin: this._get_origin(req, req.body?.page_origin),
            expectedRPID: this._get_rpid(req),
            requireUserVerification: false,
        });

        if ( ! verification.verified ) throw new Error('Registration verification failed');

        await db.write('DELETE FROM webauthn_challenges WHERE id = ?', [challenge.id]);

        const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

        return {
            credential_id: credential.id,
            public_key: Buffer.from(credential.publicKey).toString('base64url'),
            counter: credential.counter,
            device_type: credentialDeviceType,
            backed_up: credentialBackedUp ? 1 : 0,
            transports: JSON.stringify(response.response?.transports || []),
        };
    }

    async save_credential ({ user_id, credential_data, name }) {
        const db = await this.services.get('database').get(DB_WRITE, 'webauthn');

        await db.write(
            `INSERT INTO webauthn_credentials
             (user_id, credential_id, public_key, counter, device_type, backed_up, transports, name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                user_id,
                credential_data.credential_id,
                credential_data.public_key,
                credential_data.counter,
                credential_data.device_type,
                credential_data.backed_up,
                credential_data.transports,
                name || 'My Key',
            ],
        );

        await db.write('UPDATE user SET webauthn_enabled = 1 WHERE id = ?', [user_id]);
    }

    async generate_authentication_options ({ user, req }) {
        const { generateAuthenticationOptions } = await import('@simplewebauthn/server');
        const db = await this.services.get('database').get(DB_WRITE, 'webauthn');

        await this._cleanup_expired_challenges(db);

        let allow_credentials = [];
        if ( user ) {
            const creds = await db.read(
                'SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = ?',
                [user.id],
            );
            allow_credentials = creds.map(c => ({
                id: c.credential_id,
                transports: JSON.parse(c.transports || '[]'),
            }));
        }

        const options = await generateAuthenticationOptions({
            rpID: this._get_rpid(req),
            userVerification: 'preferred',
            allowCredentials: allow_credentials,
        });

        const expires_at = Math.floor(Date.now() / 1000) + 300;
        await db.write(
            'INSERT INTO webauthn_challenges (user_id, challenge, type, expires_at) VALUES (?, ?, ?, ?)',
            [user ? user.id : null, options.challenge, 'authentication', expires_at],
        );

        return options;
    }

    async verify_authentication ({ user_id, response, req }) {
        const { verifyAuthenticationResponse } = await import('@simplewebauthn/server');
        const db = await this.services.get('database').get(DB_WRITE, 'webauthn');

        const cred_rows = await db.read(
            'SELECT * FROM webauthn_credentials WHERE credential_id = ?',
            [response.id],
        );

        if ( !cred_rows || cred_rows.length === 0 ) throw new Error('Credential not found');
        const cred = cred_rows[0];

        if ( user_id && cred.user_id !== user_id ) throw new Error('Credential does not belong to user');

        const challenge_rows = await db.read(
            `SELECT * FROM webauthn_challenges
             WHERE type = 'authentication' AND (user_id = ? OR user_id IS NULL)
             ORDER BY id DESC LIMIT 1`,
            [cred.user_id],
        );

        if ( !challenge_rows || challenge_rows.length === 0 ) throw new Error('No pending authentication challenge');

        const challenge = challenge_rows[0];
        if ( challenge.expires_at < Math.floor(Date.now() / 1000) ) throw new Error('Challenge expired');

        const verification = await verifyAuthenticationResponse({
            response,
            expectedChallenge: challenge.challenge,
            expectedOrigin: this._get_origin(req, req.body?.page_origin),
            expectedRPID: this._get_rpid(req),
            credential: {
                id: cred.credential_id,
                publicKey: Buffer.from(cred.public_key, 'base64url'),
                counter: cred.counter,
                transports: JSON.parse(cred.transports || '[]'),
            },
            requireUserVerification: false,
        });

        if ( ! verification.verified ) throw new Error('Authentication verification failed');

        await db.write(
            'UPDATE webauthn_credentials SET counter = ?, last_used_at = datetime(\'now\') WHERE id = ?',
            [verification.authenticationInfo.newCounter, cred.id],
        );

        await db.write('DELETE FROM webauthn_challenges WHERE id = ?', [challenge.id]);

        return { user_id: cred.user_id };
    }

    async list_credentials (user_id) {
        const db = await this.services.get('database').get(DB_READ, 'webauthn');
        return await db.read(
            `SELECT id, name, device_type, backed_up, transports, created_at, last_used_at
             FROM webauthn_credentials WHERE user_id = ?`,
            [user_id],
        );
    }

    async delete_credential ({ user_id, credential_id }) {
        const db = await this.services.get('database').get(DB_WRITE, 'webauthn');

        await db.write(
            'DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?',
            [credential_id, user_id],
        );

        const remaining = await db.read(
            'SELECT COUNT(*) as cnt FROM webauthn_credentials WHERE user_id = ?',
            [user_id],
        );

        if ( remaining[0].cnt === 0 ) {
            await db.write(
                'UPDATE user SET webauthn_enabled = 0, password_required = 1 WHERE id = ?',
                [user_id],
            );
        }
    }

    async rename_credential ({ user_id, credential_id, name }) {
        const db = await this.services.get('database').get(DB_WRITE, 'webauthn');
        await db.write(
            'UPDATE webauthn_credentials SET name = ? WHERE id = ? AND user_id = ?',
            [name, credential_id, user_id],
        );
    }
}

module.exports = { WebAuthnService };
