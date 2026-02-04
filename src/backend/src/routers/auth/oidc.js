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
const config = require('../../config');

const complete_ = async ({ req, res, user }) => {
    const svc_auth = req.services.get('auth');
    const { token } = await svc_auth.create_session_token(user, { req });
    res.cookie(config.cookie_name, token, {
        sameSite: 'none',
        secure: true,
        httpOnly: true,
    });
    return res.send({
        proceed: true,
        next_step: 'complete',
        token,
        user: {
            username: user.username,
            uuid: user.uuid,
            email: user.email,
            email_confirmed: user.email_confirmed,
            is_temp: (user.password === null && user.email === null),
        },
    });
};

// GET /auth/oidc/providers - list enabled provider ids for frontend
router.get('/auth/oidc/providers', async (req, res) => {
    if ( require('../../helpers').subdomain(req) !== 'api' && require('../../helpers').subdomain(req) !== '' ) {
        return res.status(404).end();
    }
    const svc_oidc = req.services.get('oidc');
    const providers = await svc_oidc.getEnabledProviderIds();
    return res.json({ providers });
});

// GET /auth/oidc/:provider/start - redirect to IdP authorization
router.get('/auth/oidc/:provider/start', async (req, res) => {
    if ( require('../../helpers').subdomain(req) !== 'api' && require('../../helpers').subdomain(req) !== '' ) {
        return res.status(404).end();
    }
    const svc_edgeRateLimit = req.services.get('edge-rate-limit');
    if ( ! svc_edgeRateLimit.check('login') ) {
        return res.status(429).send('Too many requests.');
    }
    const provider = req.params.provider;
    const svc_oidc = req.services.get('oidc');
    const cfg = await svc_oidc.getProviderConfig(provider);
    if ( ! cfg ) {
        return res.status(404).send('Provider not configured.');
    }
    const redirectUri = req.query.redirect_uri ? String(req.query.redirect_uri) : undefined;
    const statePayload = { provider, redirect_uri: redirectUri };
    const state = svc_oidc.signState(statePayload);
    const url = await svc_oidc.getAuthorizationUrl(provider, state, redirectUri ? undefined : undefined);
    if ( ! url ) {
        return res.status(502).send('Could not build authorization URL.');
    }
    return res.redirect(302, url);
});

// GET /auth/oidc/callback - handle IdP redirect (code + state)
router.get('/auth/oidc/callback', async (req, res) => {
    if ( require('../../helpers').subdomain(req) !== 'api' && require('../../helpers').subdomain(req) !== '' ) {
        return res.status(404).end();
    }
    const svc_edgeRateLimit = req.services.get('edge-rate-limit');
    if ( ! svc_edgeRateLimit.check('login') ) {
        return res.status(429).send('Too many requests.');
    }
    const code = req.query.code;
    const state = req.query.state;
    if ( !code || !state ) {
        return res.status(400).send('Missing code or state.');
    }
    const svc_oidc = req.services.get('oidc');
    const stateDecoded = svc_oidc.verifyState(state);
    if ( !stateDecoded || !stateDecoded.provider ) {
        return res.status(400).send('Invalid or expired state.');
    }
    const provider = stateDecoded.provider;
    const redirectUri = `${config.api_base_url}/auth/oidc/callback`;
    const tokens = await svc_oidc.exchangeCodeForTokens(provider, code, redirectUri);
    if ( !tokens || !tokens.access_token ) {
        return res.status(401).send('Token exchange failed.');
    }
    const userinfo = await svc_oidc.getUserInfo(provider, tokens.access_token);
    if ( !userinfo || !userinfo.sub ) {
        return res.status(401).send('Could not get user info.');
    }
    let user = await svc_oidc.findUserByProviderSub(provider, userinfo.sub);
    if ( user ) {
        if ( user.suspended ) {
            return res.status(401).send('This account is suspended.');
        }
        return await complete_({ req, res, user });
    }
    user = await svc_oidc.createUserFromOIDC(provider, userinfo);
    if ( ! user ) {
        return res.status(400).send('Email already registered. Please log in with your password and link your Google account, or use a different email.');
    }
    const accept = req.headers.accept || '';
    const wantsRedirect = accept.includes('text/html');
    if ( wantsRedirect ) {
        const svc_auth = req.services.get('auth');
        const { token } = await svc_auth.create_session_token(user, { req });
        res.cookie(config.cookie_name, token, {
            sameSite: 'none',
            secure: true,
            httpOnly: true,
        });
        let target = stateDecoded.redirect_uri || config.origin || '/';
        const origin = config.origin || '';
        if ( target && origin && !target.startsWith(origin) ) {
            target = origin;
        }
        return res.redirect(302, target);
    }
    return await complete_({ req, res, user });
});

module.exports = router;
