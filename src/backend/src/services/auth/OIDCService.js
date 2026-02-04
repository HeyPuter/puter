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
const BaseService = require('../BaseService');
const { DB_WRITE } = require('../database/consts');
const { generate_identifier } = require('../../util/identifier');

const GOOGLE_DISCOVERY_URL = 'https://accounts.google.com/.well-known/openid-configuration';
const GOOGLE_SCOPES = 'openid email profile';
const STATE_EXPIRY_SEC = 600; // 10 minutes

/**
 * OIDC/OAuth2 service for sign-in with Google (and extensible to other providers).
 * Uses config.oidc.providers only; no environment variables.
 */
class OIDCService extends BaseService {
    static MODULES = {
        jwt: require('jsonwebtoken'),
    };

    async _init () {
        this.db = await this.services.get('database').get(DB_WRITE, 'auth');
        this.providers = this.config.providers ?? {};
        this._googleDiscovery = null;
    }

    /**
     * Get provider config from config.oidc.providers. For Google, resolve endpoints from discovery.
     * @param {string} providerId - e.g. 'google'
     * @returns {Promise<object|null>} Config with client_id, client_secret, authorization_endpoint, token_endpoint, userinfo_endpoint, scopes
     */
    async getProviderConfig (providerId) {
        const providers = this.providers;
        const raw = providers[providerId];
        if ( !raw || typeof raw !== 'object' || !raw.client_id || !raw.client_secret ) {
            return null;
        }
        if ( providerId === 'google' ) {
            const discovery = await this._getGoogleDiscovery_();
            if ( ! discovery ) return null;
            return {
                client_id: raw.client_id,
                client_secret: raw.client_secret,
                authorization_endpoint: discovery.authorization_endpoint,
                token_endpoint: discovery.token_endpoint,
                userinfo_endpoint: discovery.userinfo_endpoint,
                scopes: raw.scopes ?? GOOGLE_SCOPES,
            };
        }
        if ( raw.authorization_endpoint && raw.token_endpoint && raw.userinfo_endpoint ) {
            return {
                ...raw,
                scopes: raw.scopes ?? 'openid email profile',
            };
        }
        return null;
    }

    async _getGoogleDiscovery_ () {
        if ( this._googleDiscovery ) return this._googleDiscovery;
        try {
            const res = await fetch(GOOGLE_DISCOVERY_URL);
            if ( ! res.ok ) return null;
            this._googleDiscovery = await res.json();
            return this._googleDiscovery;
        } catch ( e ) {
            this.log?.warn?.('OIDC: Google discovery fetch failed', e);
            return null;
        }
    }

    /**
     * Build authorization URL for the provider. redirect_uri is our callback URL.
     */
    async getAuthorizationUrl (providerId, state, redirectUri) {
        const config = await this.getProviderConfig(providerId);
        if ( ! config ) return null;
        const base = redirectUri ?? `${this.global_config.api_base_url}/auth/oidc/callback`;
        const params = new URLSearchParams({
            client_id: config.client_id,
            redirect_uri: base,
            response_type: 'code',
            scope: config.scopes,
            state,
        });
        return `${config.authorization_endpoint}?${params.toString()}`;
    }

    /**
     * Sign state payload for CSRF protection (short-lived JWT).
     */
    signState (payload) {
        return this.modules.jwt.sign(payload,
                        this.global_config.jwt_secret,
                        { expiresIn: STATE_EXPIRY_SEC });
    }

    verifyState (token) {
        try {
            return this.modules.jwt.verify(token, this.global_config.jwt_secret);
        } catch ( e ) {
            return null;
        }
    }

    /**
     * Exchange authorization code for tokens.
     */
    async exchangeCodeForTokens (providerId, code, redirectUri) {
        const config = await this.getProviderConfig(providerId);
        if ( ! config ) return null;
        const base = redirectUri ?? `${this.global_config.api_base_url}/auth/oidc/callback`;
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: base,
            client_id: config.client_id,
            client_secret: config.client_secret,
        });
        const res = await fetch(config.token_endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        if ( ! res.ok ) {
            const text = await res.text();
            this.log?.warn?.('OIDC token exchange failed', { status: res.status, body: text });
            return null;
        }
        return await res.json();
    }

    /**
     * Get userinfo from provider (e.g. Google userinfo endpoint).
     */
    async getUserInfo (providerId, accessToken) {
        const config = await this.getProviderConfig(providerId);
        if ( !config || !config.userinfo_endpoint ) return null;
        const res = await fetch(config.userinfo_endpoint, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if ( ! res.ok ) return null;
        return await res.json();
    }

    /**
     * Find Puter user by provider and IdP subject. Returns user object or null.
     */
    async findUserByProviderSub (providerId, providerSub) {
        const rows = await this.db.pread('SELECT user_id FROM user_oidc_providers WHERE provider = ? AND provider_sub = ? LIMIT 1',
                        [providerId, providerSub]);
        if ( !rows || rows.length === 0 ) return null;
        const svc_get_user = this.services.get('get-user');
        return await svc_get_user.get_user({ id: rows[0].user_id, cached: false });
    }

    /**
     * Link an existing Puter user to an OIDC provider identity.
     */
    async linkProviderToUser (userId, providerId, providerSub, refreshToken = null) {
        try {
            await this.db.write('INSERT INTO user_oidc_providers (user_id, provider, provider_sub, refresh_token) VALUES (?, ?, ?, ?)',
                            [userId, providerId, providerSub, refreshToken]);
        } catch ( e ) {
            if ( e.message?.includes('UNIQUE') || e.code === 'SQLITE_CONSTRAINT' ) {
                // already linked
                return;
            }
            throw e;
        }
    }

    /**
     * Create a new Puter user from OIDC claims and link the provider. Reuses signup patterns (groups, default fs).
     */
    async createUserFromOIDC (providerId, claims) {
        const db = this.db;
        const svc_group = this.services.get('group');
        const svc_user = this.services.get('user');
        const { v4: uuidv4 } = require('uuid');

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
            this.global_config.storage_capacity,
            null,
            1,
            0,
        ]);
        const [inserted] = await db.pread('SELECT id FROM user WHERE uuid = ? LIMIT 1', [user_uuid]);
        const user_id = inserted.id;

        await this.linkProviderToUser(user_id, providerId, claims.sub, null);

        await svc_group.add_users({
            uid: this.global_config.default_user_group,
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

    /**
     * List provider ids that have valid config (for frontend to show "Sign in with Google" etc.).
     */
    async getEnabledProviderIds () {
        const providers = this.providers ?? {};
        const ids = [];
        for ( const id of Object.keys(providers) ) {
            const cfg = await this.getProviderConfig(id);
            if ( cfg ) ids.push(id);
        }
        return ids;
    }
}

module.exports = { OIDCService };
