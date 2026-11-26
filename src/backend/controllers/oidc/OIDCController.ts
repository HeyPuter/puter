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

import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { HttpError } from '../../core/http/HttpError.js';
import type { PuterRouter } from '../../core/http/PuterRouter.js';
import { PuterController } from '../types.js';
import { issueRevalidation } from '../../core/http/middleware/userProtected.js';
import {
    finishOidcLogin,
    mintOidcPopupReturn,
    type OidcLoginContinuation,
} from '../auth/oidcLoginReturn.js';
import {
    buildErrorRedirectUrl,
    resolutionErrorCode,
    sanitizeReturnTo,
} from '../auth/ssoRedirects.js';
import type { OIDCSignupOptions } from '../../services/auth/OIDCService.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import { sessionCookieFlags } from '../../util/cookieFlags.js';
import { secretsEqual } from '../../util/secureCompare.js';
import { normalizeBonusCode } from '../../util/signupBonus.js';

// Companion cookie that binds an OIDC flow to the browser that started it.
// Expiry mirrors STATE_EXPIRY_SEC in OIDCService — the state and its
// browser-binding cookie must expire together.
const OIDC_NONCE_COOKIE_NAME = 'puter_oidc_nonce';
const OIDC_NONCE_EXPIRY_SEC = 600;

// The popup branch below hard-codes this return target.
const POPUP_RETURN_ACTION = 'sign-in';

function signupOptionsFromState(
    stateDecoded: Record<string, unknown>,
): OIDCSignupOptions {
    return {
        referrer: (stateDecoded.referrer as string) ?? null,
        // Normalized when the state was signed; re-checked since this is the
        // value signup acts on.
        bonusCode: normalizeBonusCode(stateDecoded.bonus_code),
    };
}

/**
 * True iff `target` parses as a URL whose origin equals `origin`. Used to clamp
 * OIDC redirect targets — `startsWith` would accept
 * `https://puter.com.evil.com` against `https://puter.com`.
 */
function isSameOrigin(target: string, origin: string): boolean {
    if (!origin) return true;
    try {
        return new URL(target).origin === new URL(origin).origin;
    } catch {
        return false;
    }
}

/**
 * OIDC controller — provider listing, auth start, callbacks for
 * login/signup/revalidate, and revalidate-done landing page.
 */
export class OIDCController extends PuterController {
    registerRoutes(router: PuterRouter): void {
        // -- GET /auth/oidc/providers --------------------------------
        // Public — list enabled provider IDs for the frontend.
        //
        // Every render of a login form reads this, and with no actor the
        // bucket is the address: one corporate egress, campus or carrier
        // gateway stands for every person behind it. Size it for that — a
        // large shared address is thousands of people, and a shift or class
        // change bunches their sign-ins into the same minute — but no
        // further. This is login surface, so the ceiling should still bound
        // someone enumerating which identity providers a deployment accepts.

        router.get(
            '/auth/oidc/providers',
            {
                subdomain: 'api',
                rateLimit: {
                    scope: 'oidc-providers',
                    limit: 1_200,
                    window: 60_000,
                    key: 'ip',
                },
            },
            async (_req: Request, res: Response) => {
                const [providers, policy] = await Promise.all([
                    this.services.oidc.getEnabledProviderIds(),
                    this.services.signup.signupPolicy(),
                ]);
                // The signup window drops its email form when this is set.
                res.json({ providers, signupOidcOnly: policy.oidcOnly });
            },
        );

        // -- GET /auth/oidc/:provider/start --------------------------
        // Redirect user to IdP authorization endpoint.

        router.get(
            '/auth/oidc/:provider/start',
            {
                subdomain: '',
                rateLimit: { scope: 'oidc-general', limit: 30, window: 60_000 },
            },
            async (req: Request, res: Response) => {
                const provider = String(req.params.provider);
                const cfg =
                    await this.services.oidc.getProviderConfig(provider);
                if (!cfg)
                    throw new HttpError(404, 'Provider not configured.', {
                        legacyCode: 'not_found',
                    });

                const flow = String(
                    Array.isArray(req.query.flow)
                        ? req.query.flow[0]
                        : (req.query.flow ?? 'login'),
                );
                const origin = (this.config.origin ?? '').replace(/\/$/, '');

                const flowRedirects: Record<string, string> = {
                    login: origin || '/',
                    signup: origin || '/',
                    revalidate: `${origin}/auth/revalidate-done`,
                };

                let appRedirectUri = flowRedirects[flow] ?? (origin || '/');

                // Optional GUI return path so login started from /dashboard,
                // an /app/<name> landing, or a share link lands back there.
                const rawReturnTo = Array.isArray(req.query.return_to)
                    ? req.query.return_to[0]
                    : req.query.return_to;
                const returnTo =
                    typeof rawReturnTo === 'string'
                        ? sanitizeReturnTo(rawReturnTo)
                        : null;
                if ((flow === 'login' || flow === 'signup') && returnTo) {
                    appRedirectUri = `${origin}${returnTo}`;
                }

                // Popup support
                const rawPopup = Array.isArray(req.query.embedded_in_popup)
                    ? req.query.embedded_in_popup[0]
                    : req.query.embedded_in_popup;
                const embeddedInPopup = rawPopup === 'true' || rawPopup === '1';
                const rawMsgId = Array.isArray(req.query.msg_id)
                    ? req.query.msg_id[0]
                    : req.query.msg_id;
                const msgId =
                    rawMsgId != null && rawMsgId !== ''
                        ? String(rawMsgId)
                        : null;
                const rawOpener = Array.isArray(req.query.opener_origin)
                    ? req.query.opener_origin[0]
                    : req.query.opener_origin;
                const openerOrigin =
                    rawOpener != null && rawOpener !== ''
                        ? String(rawOpener)
                        : null;

                if (embeddedInPopup && msgId) {
                    appRedirectUri = `${origin}/action/${POPUP_RETURN_ACTION}?embedded_in_popup=true&msg_id=${encodeURIComponent(msgId)}`;
                    if (openerOrigin) {
                        appRedirectUri += `&opener_origin=${encodeURIComponent(openerOrigin)}`;
                    }
                }

                const rawReferrer = Array.isArray(req.query.referrer)
                    ? req.query.referrer[0]
                    : req.query.referrer;
                const referrer =
                    rawReferrer != null && rawReferrer !== ''
                        ? String(rawReferrer)
                        : null;

                const statePayload: Record<string, unknown> = {
                    provider,
                    redirect_uri: appRedirectUri,
                };
                if (referrer) statePayload.referrer = referrer ?? openerOrigin;
                // Login can create an account too, so both flows carry it. A
                // malformed code is dropped here and never reaches signup.
                const rawBonusCode = Array.isArray(req.query.bonusCode)
                    ? req.query.bonusCode[0]
                    : req.query.bonusCode;
                const bonusCode = normalizeBonusCode(rawBonusCode);
                if (bonusCode && (flow === 'login' || flow === 'signup')) {
                    statePayload.bonus_code = bonusCode;
                }
                if (embeddedInPopup && msgId) {
                    statePayload.embedded_in_popup = true;
                    statePayload.msg_id = msgId;
                    if (openerOrigin) statePayload.opener_origin = openerOrigin;
                }
                if (flow === 'revalidate') {
                    const rawUserUuid = Array.isArray(req.query.user_uuid)
                        ? req.query.user_uuid[0]
                        : req.query.user_uuid;
                    if (typeof rawUserUuid !== 'string' || !rawUserUuid)
                        throw new HttpError(
                            400,
                            'user_uuid required for revalidate flow.',
                            { legacyCode: 'bad_request' },
                        );
                    statePayload.user_uuid = rawUserUuid;
                    statePayload.flow = 'revalidate';
                }

                // Bind this flow to the initiating browser: a single-use
                // nonce lives both in the signed `state` and in an HttpOnly
                // companion cookie. The callback requires them to match, so a
                // `state` captured from an attacker's own flow can't be
                // replayed in a victim's browser (login-CSRF / session
                // fixation).
                const browserNonce = crypto
                    .randomBytes(32)
                    .toString('base64url');
                statePayload.nonce = browserNonce;

                const state = this.services.oidc.signState(statePayload);
                const url = await this.services.oidc.getAuthorizationUrl(
                    provider,
                    state,
                    flow,
                );
                if (!url)
                    throw new HttpError(
                        500,
                        'Could not build authorization URL.',
                        { legacyCode: 'internal_error' },
                    );

                res.cookie(OIDC_NONCE_COOKIE_NAME, browserNonce, {
                    // Same flags as the session cookie: SameSite=None;Secure
                    // on HTTPS so the cookie survives Apple's cross-site
                    // form_post callback; Lax on plain-HTTP self-host.
                    ...sessionCookieFlags(this.config),
                    httpOnly: true,
                    maxAge: OIDC_NONCE_EXPIRY_SEC * 1000,
                    path: '/',
                });
                res.redirect(302, url);
            },
        );

        // -- /auth/oidc/callback/login (GET + POST) ----------------

        const cbOpts = {
            subdomain: '',
            rateLimit: { scope: 'oidc-general', limit: 30, window: 60_000 },
        };

        const loginCb = async (req: Request, res: Response) => {
            const origin = this.config.origin ?? '';
            const result = await this.#processCallback(req, res, 'login');
            if ('error' in result) {
                console.warn(`OIDC login callback error: ${result.error}`);
                return res.redirect(
                    302,
                    buildErrorRedirectUrl(
                        origin,
                        'login',
                        'other',
                        result.error,
                    ),
                );
            }

            const { provider, userinfo, stateDecoded } = result;

            const resolved = await this.services.oidc.resolveOrCreateUser(
                provider,
                userinfo,
                signupOptionsFromState(stateDecoded),
            );
            if ('error' in resolved) {
                console.warn(
                    `OIDC login user resolution error: ${resolved.error}`,
                );
                return res.redirect(
                    302,
                    buildErrorRedirectUrl(
                        origin,
                        'login',
                        'other',
                        resolutionErrorCode(resolved.code),
                        stateDecoded,
                        resolved.requestCode,
                        (p) => this.#mintPopupReturn(res, p),
                    ),
                );
            }
            const user = resolved.user;

            if (user.suspended) {
                console.warn(
                    `Suspended user tried to login via oidc: ${user.username}`,
                );
                return res.redirect(
                    302,
                    buildErrorRedirectUrl(
                        origin,
                        'login',
                        'other',
                        'account_suspended',
                        stateDecoded,
                        undefined,
                        (p) => this.#mintPopupReturn(res, p),
                    ),
                );
            }

            await this.#finishLogin(
                req,
                res,
                user,
                stateDecoded,
                'login',
                resolved.created ? 'signup' : 'oidc',
            );
        };
        router.get('/auth/oidc/callback/login', cbOpts, loginCb);
        router.post('/auth/oidc/callback/login', cbOpts, loginCb);

        // -- /auth/oidc/callback/signup (GET + POST) ----------------

        const signupCb = async (req: Request, res: Response) => {
            const origin = this.config.origin ?? '';
            const result = await this.#processCallback(req, res, 'signup');
            if ('error' in result) {
                console.warn(`OIDC signup callback error: ${result.error}`);
                return res.redirect(
                    302,
                    buildErrorRedirectUrl(
                        origin,
                        'signup',
                        'other',
                        'unauthorized',
                    ),
                );
            }

            const { provider, userinfo, stateDecoded } = result;

            const resolved = await this.services.oidc.resolveOrCreateUser(
                provider,
                userinfo,
                signupOptionsFromState(stateDecoded),
            );
            if ('error' in resolved) {
                console.warn(
                    `OIDC signup user resolution error: ${resolved.error}`,
                );
                return res.redirect(
                    302,
                    buildErrorRedirectUrl(
                        origin,
                        'signup',
                        'other',
                        resolutionErrorCode(resolved.code),
                        stateDecoded,
                        resolved.requestCode,
                        (p) => this.#mintPopupReturn(res, p),
                    ),
                );
            }
            const user = resolved.user;

            if (user.suspended) {
                return res.redirect(
                    302,
                    buildErrorRedirectUrl(
                        origin,
                        'signup',
                        'other',
                        'account_suspended',
                        stateDecoded,
                        undefined,
                        (p) => this.#mintPopupReturn(res, p),
                    ),
                );
            }

            await this.#finishLogin(
                req,
                res,
                user,
                stateDecoded,
                'signup',
                resolved.created ? 'signup' : 'oidc',
            );
        };
        router.get('/auth/oidc/callback/signup', cbOpts, signupCb);
        router.post('/auth/oidc/callback/signup', cbOpts, signupCb);

        // -- /auth/oidc/callback/revalidate (GET + POST) ------------

        const revalidateCb = async (
            req: Request,
            res: Response,
        ): Promise<void> => {
            const result = await this.#processCallback(req, res, 'revalidate');
            if ('error' in result) {
                res.status(400).send(result.error);
                return;
            }

            const { provider, userinfo, stateDecoded } = result;
            if (
                stateDecoded.flow !== 'revalidate' ||
                typeof stateDecoded.user_uuid !== 'string' ||
                stateDecoded.user_uuid.length === 0
            ) {
                res.status(400).send('Invalid revalidate state.');
                return;
            }

            const user = await this.services.oidc.findUserByProviderSub(
                provider,
                userinfo.sub,
            );
            if (!user) {
                res.status(400).send('No account found.');
                return;
            }
            if (user.uuid !== stateDecoded.user_uuid) {
                res.status(403).send(
                    'Wrong account. Sign in with the account linked to this session.',
                );
                return;
            }

            issueRevalidation(res, user.uuid, {
                config: this.config,
                token: this.services.token,
            });

            const origin = (this.config.origin ?? '').replace(/\/$/, '');
            const requested =
                (stateDecoded.redirect_uri as string) ||
                `${origin}/auth/revalidate-done`;
            const target = isSameOrigin(requested, origin)
                ? requested
                : `${origin}/auth/revalidate-done`;
            res.redirect(302, target);
        };
        router.get('/auth/oidc/callback/revalidate', cbOpts, revalidateCb);
        router.post('/auth/oidc/callback/revalidate', cbOpts, revalidateCb);
    }

    // -- Shared helpers ----------------------------------------------

    /** Sign a popup-return proof, bound to this browser and this popup. */
    #mintPopupReturn(res: Response, payload: Record<string, unknown>): string {
        return mintOidcPopupReturn(res, payload, {
            config: this.config,
            token: this.services.token,
        });
    }

    async #processCallback(
        req: Request,
        res: Response,
        flow: string,
    ): Promise<
        | { error: string }
        | {
              provider: string;
              userinfo: { sub: string; [k: string]: unknown };
              stateDecoded: Record<string, unknown>;
          }
    > {
        // Apple uses response_mode=form_post, so params arrive in the body.
        const src = req.method === 'POST' && req.body ? req.body : req.query;
        const code = String(
            Array.isArray(src.code) ? src.code[0] : (src.code ?? ''),
        );
        const state = String(
            Array.isArray(src.state) ? src.state[0] : (src.state ?? ''),
        );
        if (!code || !state) return { error: 'Missing code or state.' };

        const stateDecoded = this.services.oidc.verifyState(state);
        if (!stateDecoded || !stateDecoded.provider)
            return { error: 'Invalid or expired state.' };

        // Enforce the browser binding set at /start. Every state minted by
        // the current /start carries a nonce, so this covers all live flows.
        // States signed before this shipped have no nonce and pass through
        // until they expire (STATE_EXPIRY, 10 min) so in-flight logins don't
        // break on deploy — a caller can't forge a nonce-less state because
        // /start always adds one and the state is server-signed.
        const expectedNonce =
            typeof stateDecoded.nonce === 'string' ? stateDecoded.nonce : '';
        if (expectedNonce) {
            const cookieNonce = req.cookies?.[OIDC_NONCE_COOKIE_NAME];
            // Single-use: drop the cookie regardless of the outcome.
            res.clearCookie(OIDC_NONCE_COOKIE_NAME, { path: '/' });
            if (
                typeof cookieNonce !== 'string' ||
                !secretsEqual(cookieNonce, expectedNonce)
            ) {
                return {
                    error: 'This sign-in could not be verified for your browser. Please start again.',
                };
            }
        }

        const provider = String(stateDecoded.provider);
        const callbackUrl = this.services.oidc.getCallbackUrl(flow);
        if (!callbackUrl) return { error: 'Invalid flow.' };

        try {
            const tokens = await this.services.oidc.exchangeCodeForTokens(
                provider,
                code,
                callbackUrl,
            );
            if (!tokens || !tokens.access_token)
                return { error: 'Token exchange failed.' };

            const userinfo = await this.services.oidc.getUserInfo(
                provider,
                tokens.access_token,
                typeof tokens.id_token === 'string'
                    ? tokens.id_token
                    : undefined,
            );
            if (!userinfo || !userinfo.sub)
                return { error: 'Could not get user info.' };

            return { provider, userinfo, stateDecoded };
        } catch (e) {
            // Network failures reaching the provider; the user can retry.
            console.warn(`[oidc] ${provider} request failed`, e);
            return {
                error: 'Could not reach the sign-in provider. Please try again.',
            };
        }
    }

    async #finishLogin(
        req: Request,
        res: Response,
        user: UserRow,
        stateDecoded: Record<string, unknown>,
        sourceFlow: 'login' | 'signup',
        method: 'oidc' | 'signup',
    ): Promise<void> {
        const origin = (this.config.origin ?? '').replace(/\/$/, '');
        const continuation: OidcLoginContinuation = {
            userUuid: user.uuid,
            redirectUri:
                typeof stateDecoded.redirect_uri === 'string'
                    ? stateDecoded.redirect_uri
                    : origin || '/',
            embeddedInPopup: stateDecoded.embedded_in_popup === true,
            openerOrigin:
                typeof stateDecoded.opener_origin === 'string'
                    ? stateDecoded.opener_origin
                    : null,
            messageId:
                stateDecoded.msg_id == null
                    ? null
                    : String(stateDecoded.msg_id),
        };
        await finishOidcLogin(
            req,
            res,
            user,
            continuation,
            {
                config: this.config,
                auth: this.services.auth,
                signIn: this.services.signIn,
                token: this.services.token,
                kv: this.stores.kv,
                user: this.stores.user,
            },
            {
                method,
                popupRetryUrl: () => {
                    const retry = new URL(
                        buildErrorRedirectUrl(
                            origin,
                            'login',
                            'other',
                            'unauthorized',
                            stateDecoded,
                            undefined,
                            (payload) => this.#mintPopupReturn(res, payload),
                        ),
                    );
                    retry.searchParams.delete('auth_error');
                    retry.searchParams.delete('message');
                    return retry.href;
                },
                refusedUrl: (code, requestCode) =>
                    buildErrorRedirectUrl(
                        origin,
                        sourceFlow,
                        'other',
                        code,
                        stateDecoded,
                        requestCode,
                        (p) => this.#mintPopupReturn(res, p),
                    ),
            },
        );
    }
}
