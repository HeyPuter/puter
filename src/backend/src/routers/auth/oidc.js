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
import express from 'express';
import jwt from 'jsonwebtoken';
import config from '../../config.js';
import { get_user, subdomain } from '../../helpers.js';
const router = express.Router();

const REVALIDATION_COOKIE_NAME = 'puter_revalidation';
const REVALIDATION_EXPIRY_SEC = 300; // 5 minutes

const MISSING_CODE_OR_STATE = Symbol('MISSING_CODE_OR_STATE');
const INVALID_OR_EXPIRED_STATE = Symbol('INVALID_OR_EXPIRED_STATE');
const TOKEN_EXCHANGE_FAILED = Symbol('TOKEN_EXCHANGE_FAILED');
const COULD_NOT_GET_USER_INFO = Symbol('COULD_NOT_GET_USER_INFO');

const OIDC_CALLBACK_ERROR_RESPONSES = {
    [MISSING_CODE_OR_STATE]: { status: 400, message: 'Missing code or state.' },
    [INVALID_OR_EXPIRED_STATE]: { status: 400, message: 'Invalid or expired state.' },
    [TOKEN_EXCHANGE_FAILED]: { status: 401, message: 'Token exchange failed.' },
    [COULD_NOT_GET_USER_INFO]: { status: 401, message: 'Could not get user info.' },
};

const OIDC_ERROR_REDIRECT_MAP = {
    login: {
        account_not_found: 'signup',
        other: 'login',
    },
    signup: {
        account_already_exists: 'login',
        other: 'signup',
    },
};

/**
 * The error redirect URL is the origin with a query parameter included to
 * display an error message on the login or signup page.
 * When stateDecoded contains embedded_in_popup and msg_id (popup flow), redirects
 * to the sign-in action URL so the popup can show the error and stay in popup context.
 * @param {string} sourceFlow - 'login' or 'signup'
 * @param {string} errorCondition - string that identifies the error message
 * @param {string} message - default error message (before i18n)
 * @param {object} [stateDecoded] - decoded OIDC state (may contain embedded_in_popup, msg_id for popup flow)
 * @returns {string} URL to redirect to
 */
function buildOIDCErrorRedirectUrl (sourceFlow, errorCondition, message, stateDecoded) {
    const targetFlow = OIDC_ERROR_REDIRECT_MAP[sourceFlow]?.[errorCondition] ?? sourceFlow;
    const origin = (config.origin || '').replace(/\/$/, '') || '/';
    const params = new URLSearchParams({ action: targetFlow, auth_error: '1', message: message || 'Something went wrong.' });
    if ( stateDecoded?.embedded_in_popup && stateDecoded?.msg_id != null ) {
        const popupParams = new URLSearchParams({
            embedded_in_popup: 'true',
            msg_id: String(stateDecoded.msg_id),
            auth_error: '1',
            message: message || 'Something went wrong.',
            action: targetFlow,
        });
        if ( stateDecoded?.opener_origin ) {
            popupParams.set('opener_origin', stateDecoded.opener_origin);
        }
        return `${origin}/?${popupParams.toString()}`;
    }
    return `${origin}/?${params.toString()}`;
}

/** Returns { session_token, target } for the caller to set cookie and redirect. */
const finishOidcSuccess_ = async (req, res, user, stateDecoded) => {
    const svc_auth = req.services.get('auth');
    const { token: session_token } = await svc_auth.create_session_token(user, { req });
    let target = stateDecoded.redirect_uri || config.origin || '/';
    const origin = config.origin || '';
    if ( target && origin && !target.startsWith(origin) ) {
        target = origin;
    }
    return { session_token, target };
};

/** Exchange code for tokens, get userinfo. Returns { provider, userinfo, stateDecoded } or { error } (symbol). */
const processOIDCCallbackRequest_ = async (req, callbackRedirectUri) => {
    const svc_oidc = req.services.get('oidc');
    const code = req.query.code;
    const state = req.query.state;
    if ( !code || !state ) {
        return { error: MISSING_CODE_OR_STATE };
    }
    const stateDecoded = svc_oidc.verifyState(state);
    if ( !stateDecoded || !stateDecoded.provider ) {
        return { error: INVALID_OR_EXPIRED_STATE };
    }
    const provider = stateDecoded.provider;
    const tokens = await svc_oidc.exchangeCodeForTokens(provider, code, callbackRedirectUri);
    if ( !tokens || !tokens.access_token ) {
        return { error: TOKEN_EXCHANGE_FAILED };
    }
    const userinfo = await svc_oidc.getUserInfo(provider, tokens.access_token);
    if ( !userinfo || !userinfo.sub ) {
        return { error: COULD_NOT_GET_USER_INFO };
    }
    return { provider, userinfo, stateDecoded };
};

// GET /auth/oidc/providers - list enabled provider ids for frontend
router.get('/auth/oidc/providers', async (req, res) => {
    if ( subdomain(req) !== 'api' ) {
        return res.status(404).end();
    }
    const svc_oidc = req.services.get('oidc');
    const providers = await svc_oidc.getEnabledProviderIds();
    return res.json({ providers });
});

// GET /auth/oidc/:provider/start - redirect to IdP authorization
router.get('/auth/oidc/:provider/start', async (req, res) => {
    if ( subdomain(req) !== '' ) {
        return res.status(404).end();
    }
    const svc_edgeRateLimit = req.services.get('edge-rate-limit');
    if ( ! svc_edgeRateLimit.check('oidc-general') ) {
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
        revalidate: `${(config.origin || '').replace(/\/$/, '')}/auth/revalidate-done`,
    };
    let appRedirectUri = (flow && flowRedirects[flow]) ? flowRedirects[flow] : (config.origin || '/');
    const embeddedInPopup = req.query.embedded_in_popup === 'true' || req.query.embedded_in_popup === '1';
    const msgId = req.query.msg_id != null && req.query.msg_id !== '' ? String(req.query.msg_id) : null;
    const openerOrigin = req.query.opener_origin != null && req.query.opener_origin !== '' ? String(req.query.opener_origin) : null;
    if ( embeddedInPopup && msgId ) {
        const origin = (config.origin || '').replace(/\/$/, '');
        appRedirectUri = `${origin}/action/sign-in?embedded_in_popup=true&msg_id=${encodeURIComponent(msgId)}`;
        if ( openerOrigin ) {
            appRedirectUri += `&opener_origin=${encodeURIComponent(openerOrigin)}`;
        }
    }
    const statePayload = { provider, redirect_uri: appRedirectUri };
    if ( embeddedInPopup && msgId ) {
        statePayload.embedded_in_popup = true;
        statePayload.msg_id = msgId;
        if ( openerOrigin ) {
            statePayload.opener_origin = openerOrigin;
        }
    }
    if ( flow === 'revalidate' ) {
        const user_id = req.query.user_id;
        if ( ! user_id ) {
            return res.status(400).send('user_id required for revalidate flow.');
        }
        statePayload.user_id = Number(user_id);
        statePayload.flow = 'revalidate';
    }
    const state = svc_oidc.signState(statePayload);
    const url = await svc_oidc.getAuthorizationUrl(provider, state, flow);
    if ( ! url ) {
        return res.status(502).send('Could not build authorization URL.');
    }
    return res.redirect(302, url);
});

// GET /auth/oidc/callback/login - login only: existing account or abort. Never creates a user.
router.get('/auth/oidc/callback/login', async (req, res) => {
    if ( subdomain(req) !== '' ) {
        return res.status(404).end();
    }
    const svc_edgeRateLimit = req.services.get('edge-rate-limit');
    if ( ! svc_edgeRateLimit.check('oidc-general') ) {
        return res.status(429).send('Too many requests.');
    }
    const svc_oidc = req.services.get('oidc');
    const callbackRedirectUri = svc_oidc.getCallbackUrlForFlow('login');
    const result = await processOIDCCallbackRequest_(req, callbackRedirectUri);
    if ( result.error ) {
        const { message } = OIDC_CALLBACK_ERROR_RESPONSES[result.error];
        return res.redirect(302, buildOIDCErrorRedirectUrl('login', 'other', message));
    }
    const { provider, userinfo, stateDecoded } = result;
    const user = await svc_oidc.findUserByProviderSub(provider, userinfo.sub);
    if ( ! user ) {
        return res.redirect(302, buildOIDCErrorRedirectUrl('login', 'account_not_found', 'No account found. Sign up first.', stateDecoded));
    }
    if ( user.suspended ) {
        return res.redirect(302, buildOIDCErrorRedirectUrl('login', 'other', 'This account is suspended.', stateDecoded));
    }
    const { session_token, target } = await finishOidcSuccess_(req, res, user, stateDecoded);
    res.cookie(config.cookie_name, session_token, {
        sameSite: 'none',
        secure: true,
        httpOnly: true,
    });
    return res.redirect(302, target);
});

// GET /auth/oidc/callback/signup - signup only: create new account or abort. Never logs in to existing account.
router.get('/auth/oidc/callback/signup', async (req, res) => {
    if ( subdomain(req) !== '' ) {
        return res.status(404).end();
    }
    const svc_edgeRateLimit = req.services.get('edge-rate-limit');
    if ( ! svc_edgeRateLimit.check('oidc-general') ) {
        return res.status(429).send('Too many requests.');
    }
    const svc_oidc = req.services.get('oidc');
    const callbackRedirectUri = svc_oidc.getCallbackUrlForFlow('signup');
    const result = await processOIDCCallbackRequest_(req, callbackRedirectUri);
    if ( result.error ) {
        const { message } = OIDC_CALLBACK_ERROR_RESPONSES[result.error];
        return res.redirect(302, buildOIDCErrorRedirectUrl('signup', 'other', message));
    }
    const { provider, userinfo, stateDecoded } = result;
    const existingUser = await svc_oidc.findUserByProviderSub(provider, userinfo.sub);
    if ( existingUser ) {
        return res.redirect(302, buildOIDCErrorRedirectUrl('signup', 'account_already_exists', 'Account already exists. Log in instead.', stateDecoded));
    }
    const outcome = await svc_oidc.createUserFromOIDC(provider, userinfo);
    if ( outcome.failed ) {
        return res.redirect(302, buildOIDCErrorRedirectUrl('signup', 'other', outcome.userMessage, stateDecoded));
    }
    const user = await get_user({ id: outcome.infoObject.user_id });
    const { session_token, target } = await finishOidcSuccess_(req, res, user, stateDecoded);
    res.cookie(config.cookie_name, session_token, {
        sameSite: 'none',
        secure: true,
        httpOnly: true,
    });
    return res.redirect(302, target);
});

// GET /auth/oidc/callback/revalidate - re-validate identity for protected actions (e.g. change username). Sets short-lived cookie and redirects.
router.get('/auth/oidc/callback/revalidate', async (req, res) => {
    if ( subdomain(req) !== '' ) {
        return res.status(404).end();
    }
    const svc_edgeRateLimit = req.services.get('edge-rate-limit');
    if ( ! svc_edgeRateLimit.check('oidc-general') ) {
        return res.status(429).send('Too many requests.');
    }
    const svc_oidc = req.services.get('oidc');
    const callbackRedirectUri = svc_oidc.getCallbackUrlForFlow('revalidate');
    const result = await processOIDCCallbackRequest_(req, callbackRedirectUri);
    if ( result.error ) {
        const { status, message } = OIDC_CALLBACK_ERROR_RESPONSES[result.error];
        return res.status(status).send(message);
    }
    const { provider, userinfo, stateDecoded } = result;
    if ( stateDecoded.flow !== 'revalidate' || stateDecoded.user_id == null ) {
        return res.status(400).send('Invalid revalidate state.');
    }
    const user = await svc_oidc.findUserByProviderSub(provider, userinfo.sub);
    if ( ! user ) {
        return res.status(400).send('No account found.');
    }
    if ( user.id !== stateDecoded.user_id ) {
        return res.status(403).send('Wrong account. Sign in with the account linked to this session.');
    }
    const token = jwt.sign(
        { user_id: user.id, purpose: 'revalidate' },
        config.jwt_secret,
        { expiresIn: REVALIDATION_EXPIRY_SEC },
    );
    res.cookie(REVALIDATION_COOKIE_NAME, token, {
        sameSite: 'lax',
        secure: true,
        httpOnly: true,
        maxAge: REVALIDATION_EXPIRY_SEC * 1000,
        path: '/',
    });
    const target = stateDecoded.redirect_uri || `${(config.origin || '').replace(/\/$/, '')}/auth/revalidate-done`;
    return res.redirect(302, target);
});

// GET /auth/revalidate-done - landing page after OIDC revalidate; posts to opener and closes (for popup flow).
router.get('/auth/revalidate-done', (req, res) => {
    if ( subdomain(req) !== '' ) {
        return res.status(404).end();
    }
    const origin = config.origin || '';
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html><html><head><title>Re-validated</title></head><body><script>
(function(){
var origin = ${JSON.stringify(origin)};
if (window.opener) {
  try { window.opener.postMessage({ type: 'puter-revalidate-done' }, origin); } catch (e) {}
  window.close();
} else {
  document.body.innerHTML = '<p>Re-validated. You can close this tab.</p>';
}
})();
</script><p>Re-validated. Closing&hellip;</p></body></html>`);
});

export default router;
