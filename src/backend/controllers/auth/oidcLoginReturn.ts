import crypto from 'node:crypto';
import type { Response } from 'express';
import { HttpError } from '../../core/http/HttpError.js';
import type { OIDCService } from '../../services/auth/OIDCService.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import type { IConfig } from '../../types.js';
import { sessionCookieFlags } from '../../util/cookieFlags.js';

export const OIDC_POPUP_RETURN_COOKIE_NAME = 'puter_oidc_popup_return';
export const OIDC_POPUP_RETURN_EXPIRY_SEC = 300;

export interface OidcLoginContinuation {
    userUuid: string;
    redirectUri: string;
    embeddedInPopup: boolean;
    openerOrigin: string | null;
    messageId: string | null;
    switchedToLogin: boolean;
}

interface OidcReturnDeps {
    config: IConfig;
    oidc: OIDCService;
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
    return deps.oidc.signPopupReturn({ action: 'sign-in', ...payload, nonce });
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
        typeof data.switchedToLogin !== 'boolean' ||
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
    if (data.switchedToLogin) append('oidc_switched', 'login');
    return target;
}
