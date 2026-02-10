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
import jwt from 'jsonwebtoken';
import { username_exists } from '../../helpers.js';
import { generate_identifier } from '../../util/identifier.js';
import BaseService from '../BaseService.js';
import { DB_WRITE } from '../database/consts.js';

const GOOGLE_DISCOVERY_URL = 'https://accounts.google.com/.well-known/openid-configuration';
const GOOGLE_SCOPES = 'openid email profile';
const STATE_EXPIRY_SEC = 600; // 10 minutes

const VALID_OIDC_FLOWS = ['login', 'signup', 'revalidate'];

async function generate_random_username () {
    let username;
    do {
        username = generate_identifier();
    } while ( await username_exists(username) );
    return username;
}

/**
 * OIDC/OAuth2 service for sign-in with Google (and extensible to other providers).
 * Uses config.oidc.providers only; no environment variables.
 */
export class OIDCService extends BaseService {
    static MODULES = {
        jwt,
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
     * Return the OAuth callback URL for a given flow. Structure: /auth/oidc/callback/<flow>
     * @param {string} flow - e.g. 'login' or 'signup'
     * @returns {string|null} Full callback URL, or null if flow is invalid
     */
    getCallbackUrlForFlow (flow) {
        if ( !flow || !VALID_OIDC_FLOWS.includes(flow) ) return null;
        const base = this.global_config.origin || '';
        const callback_url = `${base.replace(/\/$/, '')}/auth/oidc/callback/${flow}`;
        this.log.noticeme('CALLBACK URL???', { callback_url });
        return callback_url;
    }

    /**
     * Build authorization URL for the provider. Callback URL is /auth/oidc/callback/<flow> when flow is provided.
     */
    async getAuthorizationUrl (providerId, state, flow) {
        const config = await this.getProviderConfig(providerId);
        if ( ! config ) return null;
        const base = this.getCallbackUrlForFlow(flow) ?? `${this.global_config.api_base_url}/auth/oidc/callback`;
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
     * Exchange authorization code for tokens. redirectUri must match the URL used in getAuthorizationUrl (e.g. /auth/oidc/callback/:flow).
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
     * Create a new Puter user from OIDC claims and link the provider. Delegates to signup_create_new_user.
     */
    async createUserFromOIDC (providerId, claims) {
        const svc_signup = this.services.get('signup');
        const outcome = await svc_signup.create_new_user({
            username: await generate_random_username(),
            email: claims?.email ?? null,
            password: null,
            oidc_only: true,
        });
        const { user_id } = outcome.infoObject;
        console.log('user_id?', user_id);
        if ( outcome.success )
        {
            await this.linkProviderToUser(user_id, providerId, claims.sub, null);
        }
        return outcome;
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
