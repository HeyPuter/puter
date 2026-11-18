import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { HttpError } from '../../core/http/HttpError.js';
import type { AuthService } from '../../services/auth/AuthService.js';
import type { TokenService } from '../../services/auth/TokenService.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import type { IConfig } from '../../types.js';
import { sessionCookieFlags } from '../../util/cookieFlags.js';
import { startWebSession } from './webSession.js';

export const OIDC_POPUP_RETURN_COOKIE_NAME = 'puter_oidc_popup_return';
export const OIDC_POPUP_RETURN_EXPIRY_SEC = 300;

// Shares the `oidc-state` signing scope with OIDC `state`; the purpose keeps a
// proof from being accepted as a state and vice versa.
const POPUP_RETURN_TOKEN_SCOPE = 'oidc-state';
const POPUP_RETURN_PURPOSE = 'popup-return';

export interface OidcLoginContinuation {
    userUuid: string;
    redirectUri: string;
    embeddedInPopup: boolean;
    openerOrigin: string | null;
    messageId: string | null;
}

interface OidcReturnDeps {
    config: IConfig;
    token: TokenService;
}

interface OidcFinishLoginDeps extends OidcReturnDeps {
    auth: AuthService;
}

/** Sign the facts a popup needs back from an SSO round trip. */
export function signOidcPopupReturn(
    token: TokenService,
    payload: Record<string, unknown>,
): string {
    return token.sign(
        POPUP_RETURN_TOKEN_SCOPE,
        { ...payload, purpose: POPUP_RETURN_PURPOSE },
        { expiresIn: OIDC_POPUP_RETURN_EXPIRY_SEC },
    );
}

/** Verify a popup-return proof. Returns null on a bad or expired one. */
export function verifyOidcPopupReturn(
    token: TokenService,
    proof: string,
): Record<string, unknown> | null {
    let decoded: Record<string, unknown>;
    try {
        decoded = token.verify<Record<string, unknown>>(
            POPUP_RETURN_TOKEN_SCOPE,
            proof,
        );
    } catch {
        return null;
    }
    return decoded?.purpose === POPUP_RETURN_PURPOSE ? decoded : null;
}

/** Bind an attested popup return to the browser that completed sign-in. */
export function mintOidcPopupReturn(
    res: Response,
    payload: Record<string, unknown>,
    deps: OidcReturnDeps,
): string {
    const nonce = crypto.randomBytes(32).toString('base64url');
    res.cookie(OIDC_POPUP_RETURN_COOKIE_NAME, nonce, {
        ...sessionCookieFlags(deps.config, { crossSite: false }),
        httpOnly: true,
        maxAge: OIDC_POPUP_RETURN_EXPIRY_SEC * 1000,
        path: '/',
    });
    return signOidcPopupReturn(deps.token, {
        action: 'sign-in',
        ...payload,
        nonce,
    });
}

/**
 * Finish a sign-in an identity provider has vouched for: send a 2FA account to
 * its challenge, otherwise start the web session and redirect back.
 * `popupRetryUrl` is only called for a 2FA challenge inside a popup.
 */
export async function finishOidcLogin(
    req: Request,
    res: Response,
    user: UserRow,
    continuation: OidcLoginContinuation,
    deps: OidcFinishLoginDeps,
    popupRetryUrl: () => string,
): Promise<void> {
    const origin = (deps.config.origin ?? '').replace(/\/$/, '');
    if (user.otp_enabled) {
        const challenge = deps.token.sign(
            'otp',
            {
                purpose: 'otp-login',
                user_uid: user.uuid,
                jti: crypto.randomUUID(),
                oidcContinuation: continuation,
            },
            { expiresIn: '5m' },
        );
        res.set('Cache-Control', 'no-store');
        res.set('Referrer-Policy', 'no-referrer');
        const retryUrl = continuation.embeddedInPopup
            ? popupRetryUrl()
            : `${origin}/action/login`;
        const fragment = new URLSearchParams({
            token: challenge,
            retryUrl,
        });
        res.redirect(302, `${origin}/action/oidc-2fa#${fragment}`);
        return;
    }
    await startWebSession(req, res, user, deps);
    res.redirect(302, completeOidcLoginReturn(res, user, continuation, deps));
}

/** Call only after both the provider and the account's second factor succeed. */
export function completeOidcLoginReturn(
    res: Response,
    user: Pick<UserRow, 'uuid'>,
    continuation: unknown,
    deps: OidcReturnDeps,
): string {
    if (!continuation || typeof continuation !== 'object') {
        throw new HttpError(400, 'Invalid login continuation.', {
            legacyCode: 'bad_request',
        });
    }
    const data = continuation as OidcLoginContinuation;
    if (
        data.userUuid !== user.uuid ||
        typeof data.redirectUri !== 'string' ||
        typeof data.embeddedInPopup !== 'boolean' ||
        (data.openerOrigin !== null && typeof data.openerOrigin !== 'string') ||
        (data.messageId !== null && typeof data.messageId !== 'string')
    ) {
        throw new HttpError(400, 'Invalid login continuation.', {
            legacyCode: 'bad_request',
        });
    }
    const origin = (deps.config.origin ?? '').replace(/\/$/, '');
    let target = data.redirectUri || origin || '/';
    try {
        if (origin && new URL(target).origin !== new URL(origin).origin)
            target = origin;
    } catch {
        target = origin || '/';
    }
    const append = (key: string, value: string) => {
        target += `${target.includes('?') ? '&' : '?'}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    };
    if (data.embeddedInPopup) {
        append('oidc_login', 'true');
        append(
            'opener_state',
            mintOidcPopupReturn(
                res,
                {
                    opener_origin: data.openerOrigin,
                    msg_id: data.messageId,
                    oidc_login: true,
                    user_uuid: user.uuid,
                },
                deps,
            ),
        );
    }
    return target;
}
