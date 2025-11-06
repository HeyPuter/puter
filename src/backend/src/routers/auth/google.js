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
"use strict";

const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const config = require('../../config');
const { DB_WRITE } = require('../../services/database/consts');
const { username_exists, invalidate_cached_user_by_id } = require('../../helpers');
const { generate_identifier } = require('../../util/identifier');

const router = new express.Router();

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

const getGoogleConfig = () => config.services?.['google-oauth'] ?? {};

const getOriginUrl = () => new URL(config.origin);

const formatScopes = scopes => {
    if ( Array.isArray(scopes) && scopes.length > 0 ) {
        return scopes.join(' ');
    }
    if ( typeof scopes === 'string' && scopes.trim() !== '' ) {
        return scopes;
    }
    return 'openid email profile';
};

const resolveRedirectTarget = raw => {
    const fallback = config.origin;
    if ( ! raw ) return fallback;
    try {
        const base = getOriginUrl();
        const candidate = new URL(raw, base);
        if ( candidate.origin !== base.origin ) {
            return fallback;
        }
        return candidate.toString();
    } catch ( e ) {
        return fallback;
    }
};

const appendQueryParams = (target, params) => {
    let url;
    try {
        url = new URL(target);
    } catch ( e ) {
        url = new URL(config.origin);
    }
    for ( const [key, value] of Object.entries(params) ) {
        if ( typeof value === 'undefined' || value === null ) continue;
        url.searchParams.set(key, value);
    }
    return url.toString();
};

const buildStatePayload = ({ redirect, referral_code }) => {
    const payload = {
        nonce: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
        redirect,
    };
    if ( referral_code ) {
        payload.referral_code = referral_code;
    }
    return payload;
};

const sanitizeUsernameCandidate = candidate => {
    if ( ! candidate ) return '';
    return candidate
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '')
        .replace(/_{2,}/g, '_')
        .replace(/^_+/, '')
        .slice(0, config.username_max_length);
};

const randomUsername = () => sanitizeUsernameCandidate(generate_identifier());

const generateUsernameFromProfile = async (profile, email) => {
    const candidates = [];
    if ( profile?.preferred_username ) candidates.push(profile.preferred_username);
    if ( profile?.given_name && profile?.family_name ) {
        candidates.push(`${profile.given_name}.${profile.family_name}`);
        candidates.push(`${profile.given_name}${profile.family_name}`);
    }
    if ( profile?.given_name ) candidates.push(profile.given_name);
    if ( profile?.name ) candidates.push(profile.name);
    if ( typeof email === 'string' && email.includes('@') ) {
        candidates.push(email.split('@')[0]);
    }

    for ( const candidate of candidates ) {
        let base = sanitizeUsernameCandidate(candidate);
        if ( base.length < 3 ) continue;

        let attempt = 0;
        let username = base;
        while ( await username_exists(username) ) {
            attempt += 1;
            if ( attempt > 5 ) break;
            const suffix = crypto.randomInt(0, 10_000).toString().padStart(4, '0');
            username = sanitizeUsernameCandidate(`${base}_${suffix}`);
            if ( username.length < 3 ) {
                username = sanitizeUsernameCandidate(`${base}${suffix}`);
            }
            if ( username === '' ) {
                username = randomUsername();
            }
        }

        if ( username.length >= 3 && ! await username_exists(username) ) {
            return username;
        }
    }

    // Fallback strategy
    let fallback = randomUsername();
    while ( await username_exists(fallback) ) {
        fallback = randomUsername();
    }
    return fallback;
};

const coerceMetadata = existing => {
    if ( ! existing ) return {};
    if ( typeof existing === 'string' ) {
        try {
            return JSON.parse(existing);
        } catch ( _ ) {
            return {};
        }
    }
    if ( typeof existing === 'object' ) return { ...existing };
    return {};
};

const mergeGoogleMetadata = (existing, tokenInfo, tokenResponse) => {
    const metadata = coerceMetadata(existing);
    metadata.oauth_accounts = metadata.oauth_accounts ?? {};
    metadata.oauth_accounts.google = {
        sub: tokenInfo.sub,
        email: tokenInfo.email,
        picture: tokenInfo.picture ?? null,
        name: tokenInfo.name ?? null,
        given_name: tokenInfo.given_name ?? null,
        family_name: tokenInfo.family_name ?? null,
        hd: tokenInfo.hd ?? null,
        locale: tokenInfo.locale ?? null,
        scope: tokenResponse.scope ?? null,
        last_sign_in_at: new Date().toISOString(),
    };
    return metadata;
};

const domainFromEmail = email => {
    if ( typeof email !== 'string' ) return null;
    const parts = email.split('@');
    if ( parts.length !== 2 ) return null;
    return parts[1].toLowerCase();
};

const isDomainAllowed = (email, allowedDomains) => {
    if ( ! Array.isArray(allowedDomains) || allowedDomains.length === 0 ) return true;
    const cleaned = allowedDomains
        .filter(Boolean)
        .map(v => v.toLowerCase());
    if ( cleaned.length === 0 ) return true;
    const emailDomain = domainFromEmail(email);
    if ( ! emailDomain ) return false;
    return cleaned.includes(emailDomain);
};

const computeRedirectUri = providerConfig => {
    if ( typeof providerConfig.redirect_uri === 'string' && providerConfig.redirect_uri.trim() ) {
        return providerConfig.redirect_uri.trim();
    }
    const callbackPath = providerConfig.callback_path ?? '/auth/google/callback';
    const base = getOriginUrl();
    return new URL(callbackPath, base).toString();
};

const fetchJson = async (...args) => {
    const response = await fetch(...args);
    let body;
    try {
        body = await response.json();
    } catch ( _ ) {
        body = {};
    }
    return { response, body };
};

router.get('/auth/google', async (req, res) => {
    const provider = getGoogleConfig();

    if ( provider.enabled !== true ) {
        return res.status(404).send('Google SSO is not enabled.');
    }

    if ( ! provider.client_id || ! provider.client_secret ) {
        return res.status(500).send('Google SSO is misconfigured.');
    }

    const redirect = resolveRedirectTarget(req.query.redirect);
    const referral_code = typeof req.query.referral_code === 'string'
        ? req.query.referral_code
        : undefined;
    const statePayload = buildStatePayload({ redirect, referral_code });

    const svc_token = req.services.get('token');
    const stateToken = svc_token.sign('oauth-state', statePayload, { expiresIn: '10m' });

    const authUrl = new URL(GOOGLE_AUTH_URL);
    authUrl.searchParams.set('client_id', provider.client_id);
    authUrl.searchParams.set('redirect_uri', computeRedirectUri(provider));
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', formatScopes(provider.scopes));
    authUrl.searchParams.set('state', stateToken);

    if ( provider.access_type ) {
        authUrl.searchParams.set('access_type', provider.access_type);
    }
    if ( provider.prompt ) {
        authUrl.searchParams.set('prompt', provider.prompt);
    }

    const allowed = Array.isArray(provider.allowed_domains)
        ? provider.allowed_domains.filter(Boolean)
        : [];
    if ( allowed.length === 1 ) {
        authUrl.searchParams.set('hd', allowed[0]);
    } else if ( typeof provider.hosted_domain === 'string' && provider.hosted_domain.trim() ) {
        authUrl.searchParams.set('hd', provider.hosted_domain.trim());
    }

    return res.redirect(authUrl.toString());
});

router.get('/auth/google/callback', async (req, res) => {
    const provider = getGoogleConfig();

    const sendError = (redirectTarget, code, message) => {
        const target = appendQueryParams(redirectTarget, {
            error: code,
            message,
        });
        return res.redirect(target);
    };

    if ( provider.enabled !== true ) {
        return res.status(404).send('Google SSO is not enabled.');
    }

    if ( ! provider.client_id || ! provider.client_secret ) {
        return res.status(500).send('Google SSO is misconfigured.');
    }

    const svc_token = req.services.get('token');

    let statePayload;
    try {
        statePayload = svc_token.verify('oauth-state', req.query.state);
    } catch ( e ) {
        const fallback = resolveRedirectTarget(req.query.redirect);
        return sendError(fallback, 'google_state_invalid', 'Authentication state is invalid or expired.');
    }

    const redirectTarget = resolveRedirectTarget(statePayload.redirect);

    if ( ! req.query.code ) {
        return sendError(redirectTarget, 'google_missing_code', 'Missing authorization code.');
    }

    const redirectUri = computeRedirectUri(provider);

    const tokenRequestBody = new URLSearchParams({
        code: req.query.code,
        client_id: provider.client_id,
        client_secret: provider.client_secret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
    });

    let tokenData;
    try {
        const { response, body } = await fetchJson(GOOGLE_TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: tokenRequestBody,
        });
        tokenData = body;

        if ( ! response.ok ) {
            const description = body.error_description ?? 'Failed to exchange authorization code.';
            return sendError(redirectTarget, 'google_token_exchange_failed', description);
        }
    } catch ( e ) {
        return sendError(redirectTarget, 'google_token_exchange_failed', 'Failed to exchange authorization code.');
    }

    if ( typeof tokenData.id_token !== 'string' ) {
        return sendError(redirectTarget, 'google_missing_id_token', 'The identity token was not provided.');
    }

    let tokenInfo;
    try {
        const { response, body } = await fetchJson(`${GOOGLE_TOKENINFO_URL}?id_token=${encodeURIComponent(tokenData.id_token)}`);
        if ( ! response.ok ) {
            return sendError(redirectTarget, 'google_token_validation_failed', 'Unable to validate the Google identity token.');
        }
        tokenInfo = body;
    } catch ( e ) {
        return sendError(redirectTarget, 'google_token_validation_failed', 'Unable to validate the Google identity token.');
    }

    if ( tokenInfo.aud !== provider.client_id ) {
        return sendError(redirectTarget, 'google_audience_mismatch', 'Google authentication response is intended for a different application.');
    }

    const email = tokenInfo.email;
    const emailVerified = tokenInfo.email_verified === true || tokenInfo.email_verified === 'true';

    if ( ! email || ! emailVerified ) {
        return sendError(redirectTarget, 'google_email_unverified', 'Google account email is not verified.');
    }

    if ( ! isDomainAllowed(email, provider.allowed_domains) ) {
        return sendError(redirectTarget, 'google_domain_not_allowed', 'Google account domain is not allowed.');
    }

    const svc_cleanEmail = req.services.get('clean-email');
    const cleanEmail = svc_cleanEmail.clean(email);

    if ( ! await svc_cleanEmail.validate(cleanEmail) ) {
        return sendError(redirectTarget, 'google_email_invalid', 'Google account email is not allowed.');
    }

    const svc_getUser = req.services.get('get-user');

    let user = await svc_getUser.get_user({ email, cached: false });

    if ( ! user ) {
        const db = req.services.get('database').get(DB_WRITE, 'auth');
        const existing = await db.pread('SELECT id FROM `user` WHERE `clean_email` = ? LIMIT 1', [cleanEmail]);
        if ( Array.isArray(existing) && existing[0] ) {
            user = await svc_getUser.get_user({ id: existing[0].id, cached: false, force: true });
        }
    }

    const db = req.services.get('database').get(DB_WRITE, 'auth');
    const svc_auth = req.services.get('auth');

    const metadata = mergeGoogleMetadata(user?.metadata, tokenInfo, tokenData);

    if ( user ) {
        if ( user.suspended ) {
            return sendError(redirectTarget, 'google_account_suspended', 'This account is suspended.');
        }

        const emailMatches = (
            (user.email && user.email.toLowerCase() === email.toLowerCase()) ||
            (user.clean_email && user.clean_email.toLowerCase() === cleanEmail.toLowerCase())
        );

        if ( ! emailMatches ) {
            return sendError(redirectTarget, 'google_account_mismatch', 'Google account email does not match your Puter account.');
        }

        const updateFields = [];
        const values = [];

        if ( ! user.email || user.email.toLowerCase() !== email.toLowerCase() ) {
            updateFields.push('email = ?');
            values.push(email);
        }

        if ( ! user.clean_email || user.clean_email.toLowerCase() !== cleanEmail.toLowerCase() ) {
            updateFields.push('clean_email = ?');
            values.push(cleanEmail);
        }

        updateFields.push('email_confirmed = 1');
        updateFields.push('requires_email_confirmation = 0');

        updateFields.push('metadata = ?');
        values.push(JSON.stringify(metadata));

        values.push(user.id);

        await db.write(
            `UPDATE \`user\` SET ${updateFields.join(', ')} WHERE id = ?`,
            values
        );

        invalidate_cached_user_by_id(user.id);
        user = await svc_getUser.get_user({ id: user.id, cached: false, force: true });
    } else {
        if ( provider.allow_signup !== true ) {
            return sendError(redirectTarget, 'google_signup_disabled', 'Creating accounts via Google is disabled.');
        }

        const username = await generateUsernameFromProfile(tokenInfo, email);
        const userUuid = uuidv4();
        const emailConfirmToken = uuidv4();
        const emailConfirmCode = Math.floor(100000 + Math.random() * 900000);

        let referredById = null;
        const referralCode = typeof statePayload.referral_code === 'string'
            ? statePayload.referral_code
            : undefined;

        if ( referralCode ) {
            const referredBy = await svc_getUser.get_user({ referral_code: referralCode, cached: false });
            if ( referredBy ) {
                referredById = referredBy.id;
            }
        }

        const audit_metadata = {
            ip: req.connection.remoteAddress,
            ip_fwd: req.headers['x-forwarded-for'],
            user_agent: req.headers['user-agent'],
            origin: req.headers['origin'],
            server: config.server_id,
            provider: 'google',
        };

        const insertResult = await db.write(`INSERT INTO user
            (
                username, email, clean_email, password, uuid, referrer,
                email_confirm_code, email_confirm_token, free_storage,
                referred_by, audit_metadata, signup_ip, signup_ip_forwarded,
                signup_user_agent, signup_origin, signup_server
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            username,
            email,
            cleanEmail,
            null,
            userUuid,
            null,
            '' + emailConfirmCode,
            emailConfirmToken,
            config.storage_capacity,
            referredById,
            JSON.stringify(audit_metadata),
            req.connection.remoteAddress ?? null,
            req.headers['x-forwarded-for'] ?? null,
            req.headers['user-agent'] ?? null,
            req.headers['origin'] ?? null,
            config.server_id ?? null,
        ]);

        const userId = insertResult.insertId;

        await db.write(
            'UPDATE `user` SET email_confirmed = 1, requires_email_confirmation = 0, metadata = ? WHERE id = ?',
            [JSON.stringify(metadata), userId]
        );

        const svc_group = req.services.get('group');
        await svc_group.add_users({
            uid: config.default_user_group,
            users: [username],
        });

        invalidate_cached_user_by_id(userId);
        user = await svc_getUser.get_user({ id: userId, cached: false, force: true });

        const svc_user = req.services.get('user');
        await svc_user.generate_default_fsentries({ user });

        try {
            const svc_event = req.services.get('event');
            if ( svc_event ) {
                svc_event.emit('user.save_account', { user });
            }
        } catch ( _ ) {
            // Event service is optional; ignore if unavailable.
        }
    }

    const { token } = await svc_auth.create_session_token(user, { req });

    res.cookie(config.cookie_name, token, {
        sameSite: 'none',
        secure: true,
        httpOnly: true,
    });

    return res.redirect(redirectTarget);
});

module.exports = router;
