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
const { get_user } = require('../../helpers');

/** If Accept includes text/html, set session cookie and redirect to app; otherwise send JSON. */
const finishOidcSuccess_ = async (req, res, user, stateDecoded) => {
    console.log('okay finishOidSuccess_ is happening');
    const svc_auth = req.services.get('auth');
    const { session, token: session_token } = await svc_auth.create_session_token(user, { req });
    res.cookie(config.cookie_name, session_token, {
        sameSite: 'none',
        secure: true,
        httpOnly: true,
    });
    console.log('what are these values?', {
        stateDecoded,
    });
    let target = stateDecoded.redirect_uri || config.origin || '/';
    const origin = config.origin || '';
    console.log('okay what\'s target though?', { target, origin });
    if ( target && origin && !target.startsWith(origin) ) {
        target = origin;
    }
    return res.redirect(302, target);
};

/** Exchange code for tokens, get userinfo; returns { provider, userinfo, stateDecoded } or sends error and returns null. */
const oidcCallbackPreamble_ = async (req, res, callbackRedirectUri) => {
    const svc_oidc = req.services.get('oidc');
    const code = req.query.code;
    const state = req.query.state;
    if ( !code || !state ) {
        res.status(400).send('Missing code or state.');
        return null;
    }
    const stateDecoded = svc_oidc.verifyState(state);
    if ( !stateDecoded || !stateDecoded.provider ) {
        res.status(400).send('Invalid or expired state.');
        return null;
    }
    const provider = stateDecoded.provider;
    const tokens = await svc_oidc.exchangeCodeForTokens(provider, code, callbackRedirectUri);
    if ( !tokens || !tokens.access_token ) {
        res.status(401).send('Token exchange failed.');
        return null;
    }
    const userinfo = await svc_oidc.getUserInfo(provider, tokens.access_token);
    if ( !userinfo || !userinfo.sub ) {
        res.status(401).send('Could not get user info.');
        return null;
    }
    return { provider, userinfo, stateDecoded };
};

// GET /auth/oidc/providers - list enabled provider ids for frontend
router.get('/auth/oidc/providers', async (req, res) => {
    if ( require('../../helpers').subdomain(req) !== 'api' ) {
        return res.status(404).end();
    }
    const svc_oidc = req.services.get('oidc');
    const providers = await svc_oidc.getEnabledProviderIds();
    return res.json({ providers });
});

// GET /auth/oidc/:provider/start - redirect to IdP authorization
router.get('/auth/oidc/:provider/start', async (req, res) => {
    if ( require('../../helpers').subdomain(req) !== '' ) {
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
    const flow = req.query.flow ? String(req.query.flow) : undefined;
    const flowRedirects = {
        login: config.origin || '/',
        signup: config.origin || '/',
    };
    const appRedirectUri = (flow && flowRedirects[flow]) ? flowRedirects[flow] : (config.origin || '/');
    const statePayload = { provider, redirect_uri: appRedirectUri };
    const state = svc_oidc.signState(statePayload);
    const url = await svc_oidc.getAuthorizationUrl(provider, state, flow);
    if ( ! url ) {
        return res.status(502).send('Could not build authorization URL.');
    }
    return res.redirect(302, url);
});

// GET /auth/oidc/callback/login - login only: existing account or abort. Never creates a user.
router.get('/auth/oidc/callback/login', async (req, res) => {
    if ( require('../../helpers').subdomain(req) !== '' ) {
        return res.status(404).end();
    }
    const svc_edgeRateLimit = req.services.get('edge-rate-limit');
    if ( ! svc_edgeRateLimit.check('login') ) {
        return res.status(429).send('Too many requests.');
    }
    const svc_oidc = req.services.get('oidc');
    const callbackRedirectUri = svc_oidc.getCallbackUrlForFlow('login');
    const preamble = await oidcCallbackPreamble_(req, res, callbackRedirectUri);
    if ( ! preamble ) return;
    const { provider, userinfo, stateDecoded } = preamble;
    const user = await svc_oidc.findUserByProviderSub(provider, userinfo.sub);
    if ( ! user ) {
        return res.status(400).send('No account found. Sign up first.');
    }
    if ( user.suspended ) {
        return res.status(401).send('This account is suspended.');
    }
    return await finishOidcSuccess_(req, res, user, stateDecoded);
});

// GET /auth/oidc/callback/signup - signup only: create new account or abort. Never logs in to existing account.
router.get('/auth/oidc/callback/signup', async (req, res) => {
    if ( require('../../helpers').subdomain(req) !== '' ) {
        return res.status(404).end();
    }
    const svc_edgeRateLimit = req.services.get('edge-rate-limit');
    if ( ! svc_edgeRateLimit.check('login') ) {
        return res.status(429).send('Too many requests.');
    }
    const svc_oidc = req.services.get('oidc');
    const callbackRedirectUri = svc_oidc.getCallbackUrlForFlow('signup');
    const preamble = await oidcCallbackPreamble_(req, res, callbackRedirectUri);
    if ( ! preamble ) return;
    const { provider, userinfo, stateDecoded } = preamble;
    const existingUser = await svc_oidc.findUserByProviderSub(provider, userinfo.sub);
    if ( existingUser ) {
        return res.status(400).send('Account already exists. Log in instead.');
    }
    const outcome = await svc_oidc.createUserFromOIDC(provider, userinfo);
    if ( outcome.failed ) {
        console.log('it looks like the outcome failed...');
        return res.status(400).send(outcome.userMessage);
    }
    const user = await get_user({ id: outcome.infoObject.user_id });
    console.log('got user????', user);
    return await finishOidcSuccess_(req, res, user, stateDecoded);
});

module.exports = router;
