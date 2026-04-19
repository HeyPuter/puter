import type { Request, Response } from 'express';
import { HttpError } from '../../core/http/HttpError.js';
import type { PuterRouter } from '../../core/http/PuterRouter.js';
import { PuterController } from '../types.js';

const REVALIDATION_COOKIE_NAME = 'puter_revalidation';
const REVALIDATION_EXPIRY_SEC = 300;

const OIDC_ERROR_REDIRECT_MAP: Record<string, Record<string, string>> = {
    login: { account_not_found: 'signup', other: 'login' },
    signup: { account_already_exists: 'login', other: 'signup' },
};

function buildErrorRedirectUrl (
    origin: string,
    sourceFlow: string,
    errorCondition: string,
    message: string,
    stateDecoded?: Record<string, unknown>,
): string {
    const targetFlow = OIDC_ERROR_REDIRECT_MAP[sourceFlow]?.[errorCondition] ?? sourceFlow;
    const base = origin.replace(/\/$/, '') || '/';

    if ( stateDecoded?.embedded_in_popup && stateDecoded?.msg_id != null ) {
        const params = new URLSearchParams({
            embedded_in_popup: 'true',
            msg_id: String(stateDecoded.msg_id),
            auth_error: '1',
            message: message || 'Something went wrong.',
            action: targetFlow,
        });
        if ( stateDecoded?.opener_origin ) {
            params.set('opener_origin', String(stateDecoded.opener_origin));
        }
        return `${base}/?${params.toString()}`;
    }

    const params = new URLSearchParams({
        action: targetFlow,
        auth_error: '1',
        message: message || 'Something went wrong.',
    });
    return `${base}/?${params.toString()}`;
}

function appendQueryParam (url: string, key: string, value: string): string {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

/**
 * OIDC controller — provider listing, auth start, callbacks for
 * login/signup/revalidate, and revalidate-done landing page.
 */
export class OIDCController extends PuterController {

    registerRoutes (router: PuterRouter): void {

        // ── GET /auth/oidc/providers ────────────────────────────────
        // Public — list enabled provider IDs for the frontend.

        router.get('/auth/oidc/providers', { subdomain: 'api' }, async (_req: Request, res: Response) => {
            const providers = await this.services.oidc.getEnabledProviderIds();
            res.json({ providers });
        });

        // ── GET /auth/oidc/:provider/start ──────────────────────────
        // Redirect user to IdP authorization endpoint.

        router.get('/auth/oidc/:provider/start', {
            subdomain: '',
            rateLimit: { scope: 'oidc-general', limit: 30, window: 60_000 },
        }, async (req: Request, res: Response) => {
            const provider = String(req.params.provider);
            const cfg = await this.services.oidc.getProviderConfig(provider);
            if ( ! cfg ) throw new HttpError(404, 'Provider not configured.');

            const flow = String(Array.isArray(req.query.flow) ? req.query.flow[0] : req.query.flow ?? 'login');
            const origin = (this.config.origin ?? '').replace(/\/$/, '');

            const flowRedirects: Record<string, string> = {
                login: origin || '/',
                signup: origin || '/',
                revalidate: `${origin}/auth/revalidate-done`,
            };

            let appRedirectUri = flowRedirects[flow] ?? (origin || '/');

            // Popup support
            const rawPopup = Array.isArray(req.query.embedded_in_popup) ? req.query.embedded_in_popup[0] : req.query.embedded_in_popup;
            const embeddedInPopup = rawPopup === 'true' || rawPopup === '1';
            const rawMsgId = Array.isArray(req.query.msg_id) ? req.query.msg_id[0] : req.query.msg_id;
            const msgId = rawMsgId != null && rawMsgId !== '' ? String(rawMsgId) : null;
            const rawOpener = Array.isArray(req.query.opener_origin) ? req.query.opener_origin[0] : req.query.opener_origin;
            const openerOrigin = rawOpener != null && rawOpener !== '' ? String(rawOpener) : null;

            if ( embeddedInPopup && msgId ) {
                appRedirectUri = `${origin}/action/sign-in?embedded_in_popup=true&msg_id=${encodeURIComponent(msgId)}`;
                if ( openerOrigin ) {
                    appRedirectUri += `&opener_origin=${encodeURIComponent(openerOrigin)}`;
                }
            }

            const statePayload: Record<string, unknown> = { provider, redirect_uri: appRedirectUri };
            if ( embeddedInPopup && msgId ) {
                statePayload.embedded_in_popup = true;
                statePayload.msg_id = msgId;
                if ( openerOrigin ) statePayload.opener_origin = openerOrigin;
            }
            if ( flow === 'revalidate' ) {
                const rawUserId = Array.isArray(req.query.user_id) ? req.query.user_id[0] : req.query.user_id;
                if ( ! rawUserId ) throw new HttpError(400, 'user_id required for revalidate flow.');
                statePayload.user_id = Number(rawUserId);
                statePayload.flow = 'revalidate';
            }

            const state = this.services.oidc.signState(statePayload);
            const url = await this.services.oidc.getAuthorizationUrl(provider, state, flow);
            if ( ! url ) throw new HttpError(502, 'Could not build authorization URL.');

            res.redirect(302, url);
        });

        // ── GET /auth/oidc/callback/login ───────────────────────────

        router.get('/auth/oidc/callback/login', {
            subdomain: '',
            rateLimit: { scope: 'oidc-general', limit: 30, window: 60_000 },
        }, async (req: Request, res: Response) => {
            const origin = this.config.origin ?? '';
            const result = await this.#processCallback(req, 'login');
            if ( 'error' in result ) {
                return res.redirect(302, buildErrorRedirectUrl(origin, 'login', 'other', result.error));
            }

            const { provider, userinfo, stateDecoded } = result;
            let user = await this.services.oidc.findUserByProviderSub(provider, userinfo.sub);

            if ( ! user ) {
                // No account found — create one (login flow auto-creates)
                const outcome = await this.services.oidc.createUserFromOIDC(provider, userinfo);
                if ( ! outcome.success ) {
                    return res.redirect(302, buildErrorRedirectUrl(origin, 'login', 'other', outcome.error ?? 'Account creation failed.', stateDecoded));
                }
                user = outcome.user!;
            }

            if ( user.suspended ) {
                return res.redirect(302, buildErrorRedirectUrl(origin, 'login', 'other', 'This account is suspended.', stateDecoded));
            }

            await this.#finishLogin(res, user, stateDecoded);
        });

        // ── GET /auth/oidc/callback/signup ──────────────────────────

        router.get('/auth/oidc/callback/signup', {
            subdomain: '',
            rateLimit: { scope: 'oidc-general', limit: 30, window: 60_000 },
        }, async (req: Request, res: Response) => {
            const origin = this.config.origin ?? '';
            const result = await this.#processCallback(req, 'signup');
            if ( 'error' in result ) {
                return res.redirect(302, buildErrorRedirectUrl(origin, 'signup', 'other', result.error));
            }

            const { provider, userinfo, stateDecoded } = result;
            const existingUser = await this.services.oidc.findUserByProviderSub(provider, userinfo.sub);

            if ( existingUser ) {
                // Already exists — log in instead (signup switches to login)
                if ( existingUser.suspended ) {
                    return res.redirect(302, buildErrorRedirectUrl(origin, 'signup', 'other', 'This account is suspended.', stateDecoded));
                }
                return this.#finishLogin(res, existingUser, stateDecoded, { oidc_switched: 'login' });
            }

            const outcome = await this.services.oidc.createUserFromOIDC(provider, userinfo);
            if ( ! outcome.success ) {
                return res.redirect(302, buildErrorRedirectUrl(origin, 'signup', 'other', outcome.error ?? 'Account creation failed.', stateDecoded));
            }

            await this.#finishLogin(res, outcome.user!, stateDecoded);
        });

        // ── GET /auth/oidc/callback/revalidate ──────────────────────

        router.get('/auth/oidc/callback/revalidate', {
            subdomain: '',
            rateLimit: { scope: 'oidc-general', limit: 30, window: 60_000 },
        }, async (req: Request, res: Response): Promise<void> => {
            const result = await this.#processCallback(req, 'revalidate');
            if ( 'error' in result ) {
                res.status(400).send(result.error);
                return;
            }

            const { provider, userinfo, stateDecoded } = result;
            if ( stateDecoded.flow !== 'revalidate' || stateDecoded.user_id == null ) {
                res.status(400).send('Invalid revalidate state.');
                return;
            }

            const user = await this.services.oidc.findUserByProviderSub(provider, userinfo.sub);
            if ( ! user ) {
                res.status(400).send('No account found.'); return;
            }
            if ( user.id !== stateDecoded.user_id ) {
                res.status(403).send('Wrong account. Sign in with the account linked to this session.');
                return;
            }

            const token = this.services.oidc.signRevalidation(user.id);
            res.cookie(REVALIDATION_COOKIE_NAME, token, {
                sameSite: 'lax',
                secure: true,
                httpOnly: true,
                maxAge: REVALIDATION_EXPIRY_SEC * 1000,
                path: '/',
            });

            const origin = (this.config.origin ?? '').replace(/\/$/, '');
            const target = (stateDecoded.redirect_uri as string) || `${origin}/auth/revalidate-done`;
            res.redirect(302, target);
        });

        // ── GET /auth/revalidate-done ───────────────────────────────
        // Landing page after revalidation; posts to opener for popup flow.

        router.get('/auth/revalidate-done', { subdomain: '' }, (_req: Request, res: Response) => {
            const origin = this.config.origin ?? '';
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
    }

    // ── Shared helpers ──────────────────────────────────────────────

    async #processCallback (req: Request, flow: string): Promise<
        | { error: string }
        | { provider: string; userinfo: { sub: string; [k: string]: unknown }; stateDecoded: Record<string, unknown> }
    > {
        const code = String(Array.isArray(req.query.code) ? req.query.code[0] : req.query.code ?? '');
        const state = String(Array.isArray(req.query.state) ? req.query.state[0] : req.query.state ?? '');
        if ( !code || !state ) return { error: 'Missing code or state.' };

        const stateDecoded = this.services.oidc.verifyState(state);
        if ( !stateDecoded || !stateDecoded.provider ) return { error: 'Invalid or expired state.' };

        const provider = String(stateDecoded.provider);
        const callbackUrl = this.services.oidc.getCallbackUrl(flow);
        if ( ! callbackUrl ) return { error: 'Invalid flow.' };

        const tokens = await this.services.oidc.exchangeCodeForTokens(provider, code, callbackUrl);
        if ( !tokens || !tokens.access_token ) return { error: 'Token exchange failed.' };

        const userinfo = await this.services.oidc.getUserInfo(provider, tokens.access_token);
        if ( !userinfo || !userinfo.sub ) return { error: 'Could not get user info.' };

        return { provider, userinfo, stateDecoded };
    }

    async #finishLogin (
        res: Response,
        user: { id: number; uuid: string; username: string; email?: string | null; [k: string]: unknown },
        stateDecoded: Record<string, unknown>,
        extraQueryParams?: Record<string, string>,
    ): Promise<void> {
        const { token: sessionToken } = await this.services.auth.createSessionToken(
            user as import('../../stores/user/UserStore.js').UserRow,
        );

        const cookieName = this.config.cookie_name ?? 'puter_token';
        res.cookie(cookieName, sessionToken, {
            sameSite: 'none',
            secure: true,
            httpOnly: true,
        });

        const origin = (this.config.origin ?? '').replace(/\/$/, '');
        let target = (stateDecoded.redirect_uri as string) || origin || '/';

        // Security: don't redirect off-origin
        if ( origin && !target.startsWith(origin) ) {
            target = origin;
        }

        if ( extraQueryParams ) {
            for ( const [k, v] of Object.entries(extraQueryParams) ) {
                if ( v != null ) target = appendQueryParam(target, k, v);
            }
        }

        res.redirect(302, target);
    }
}
