import type { Request, Response } from 'express';
import { makeActor } from '../../core/actor.js';
import type { PuterRouter } from '../../core/http/PuterRouter.js';
import {
    MAGIC_LINK_ERRORS,
    MagicLinkFailure,
    type MagicLinkError,
} from '../../services/auth/MagicLinkService.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import { sessionCookieFlags } from '../../util/cookieFlags.js';
import { PuterController } from '../types.js';
import { issueUserAppToken } from './userAppToken.js';

const SIGNIN_SESSION_PARAM = 'puter.signin_session';

const appendQueryParam = (url: string, key: string, value: string): string => {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
};

/**
 * Passwordless sign-in links for third-party sites. The popup on the GUI origin
 * requests a link and polls for the result; the emailed link lands on the
 * consume page, which signs the user in and redirects to the site.
 */
export class MagicLinkController extends PuterController {
    registerRoutes(router: PuterRouter): void {
        // -- POST /auth/magic-link/request ----------------------------
        // Only the GUI's own windows ask for links, so this is gated to the
        // GUI origin: an arbitrary site must not be able to mail anyone links.
        // `opener_origin` names the third-party site a popup is signing in;
        // without it the link signs the user in to Puter itself.
        router.post(
            '/auth/magic-link/request',
            {
                subdomain: 'api',
                guiOriginOnly: true,
                rateLimit: [
                    {
                        scope: 'magic-link-request',
                        limit: 10,
                        window: 15 * 60_000,
                        key: 'ip',
                    },
                    {
                        scope: 'magic-link-request-email',
                        limit: 5,
                        window: 15 * 60_000,
                        key: (req) =>
                            String(req.body?.email ?? '')
                                .trim()
                                .toLowerCase(),
                    },
                ],
            },
            async (req: Request, res: Response) => {
                const body = req.body ?? {};
                await this.services.magicLink.request({
                    email: body.email,
                    returnUrl: body.return_url,
                    openerOrigin: body.opener_origin,
                });
                // Same answer whether or not the address has an account.
                res.json({ success: true });
            },
        );

        // -- GET /auth/magic-link/consume -----------------------------
        // The emailed link. Lives on the GUI origin so the session cookie it
        // sets is the desktop's own, like the OIDC callback.
        router.get(
            '/auth/magic-link/consume',
            {
                subdomain: '',
                rateLimit: {
                    scope: 'magic-link-consume',
                    limit: 30,
                    window: 15 * 60_000,
                    key: 'ip',
                },
            },
            async (req: Request, res: Response) => {
                let consumed;
                try {
                    consumed = await this.services.magicLink.consume(
                        req.query?.token,
                        req,
                    );
                } catch (e) {
                    if (e instanceof MagicLinkFailure) {
                        res.redirect(302, this.#errorRedirect(e.code));
                        return;
                    }
                    throw e;
                }
                const { user, claims } = consumed;

                const meta = {
                    ip: req.ip || req.socket?.remoteAddress,
                    user_agent: req.headers?.['user-agent'],
                    origin: req.headers?.origin,
                    host: req.headers?.host,
                };
                const { session: guiSession, token: sessionToken } =
                    await this.services.auth.createSessionToken(
                        user as UserRow,
                        meta,
                    );
                res.cookie(
                    this.config.cookie_name ?? 'puter_token',
                    sessionToken,
                    {
                        ...sessionCookieFlags(this.config),
                        httpOnly: true,
                    },
                );

                if (!claims.opener_origin) {
                    // Puter's own sign-in: the cookie above is the whole
                    // result, and the desktop picks it up on landing.
                    res.redirect(302, claims.return_url);
                    return;
                }

                const actor = makeActor({
                    user,
                    session: {
                        uid: String(guiSession.uuid),
                        kind: 'web',
                    },
                });
                const issued = await issueUserAppToken(
                    {
                        clients: this.clients,
                        stores: this.stores,
                        services: this.services,
                    },
                    actor,
                    { origin: claims.opener_origin },
                );

                await this.services.magicLink.storeLandingPickup(
                    claims.session,
                    issued,
                );
                // Anyone already long-polling `/login/wait` hears it now.
                this.clients.event.emit(
                    `pubsub.login.${claims.session}`,
                    { authtoken: issued.token },
                    {},
                );

                res.redirect(
                    302,
                    appendQueryParam(
                        claims.return_url,
                        SIGNIN_SESSION_PARAM,
                        claims.session,
                    ),
                );
            },
        );
    }

    /** Land a failed link on the desktop's login window with a clamped code. */
    #errorRedirect(code: MagicLinkError): string {
        const origin = (this.config.origin ?? '').replace(/\/$/, '');
        const clamped = (MAGIC_LINK_ERRORS as readonly string[]).includes(code)
            ? code
            : 'unauthorized';
        const params = new URLSearchParams({
            action: 'login',
            auth_error: '1',
            message: clamped,
        });
        return `${origin}/?${params.toString()}`;
    }
}
