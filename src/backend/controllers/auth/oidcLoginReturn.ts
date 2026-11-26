import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { HttpError } from '../../core/http/HttpError.js';
import type { OIDCService } from '../../services/auth/OIDCService.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import type { IConfig } from '../../types.js';
import { sessionCookieFlags } from '../../util/cookieFlags.js';
import {
    embedHostOrigin,
    type EmbedFramingConfig,
} from '../../util/embedHost.js';

export const OIDC_POPUP_RETURN_COOKIE_NAME = 'puter_oidc_popup_return';
export const OIDC_POPUP_RETURN_EXPIRY_SEC = 300;

export interface OidcLoginContinuation {
    userUuid: string;
    redirectUri: string;
    embeddedInPopup: boolean;
    /**
     * Puter's sign-in screen started the flow, so the account picker may be
     * skipped.
     */
    startedInPuterSignIn?: boolean;
    openerOrigin: string | null;
    messageId: string | null;
}

interface OidcReturnDeps {
    config: IConfig;
    oidc: OIDCService;
}

/**
 * Whether Puter's own sign-in screen sent the browser to the OIDC start route:
 * its popup on the GUI origin, or its frame on a first-party page, which opens
 * the popup from that page. Only such a flow may skip the account picker on
 * return, since a page that opens the route itself shows no Puter screen.
 */
export function startedInPuterSignIn(
    req: Request,
    openerOrigin: string | null,
    config: EmbedFramingConfig,
): boolean {
    const site = req.headers?.['sec-fetch-site'];
    if (site === 'same-origin') return true;
    return (
        site === 'same-site' &&
        openerOrigin !== null &&
        embedHostOrigin(config, openerOrigin) === openerOrigin
    );
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
                    oidc_login: data.startedInPuterSignIn === true,
                    user_uuid: user.uuid,
                },
                deps,
            ),
        );
    }
    return target;
}
