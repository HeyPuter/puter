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
import type { PuterRouter } from '../../core/http/PuterRouter.js';
import { MAGIC_LINK_TTL_SECONDS } from '../../services/auth/MagicLinkService.js';
import { cleanEmail } from '../../util/email.js';
import { sessionCookieFlags } from '../../util/cookieFlags.js';
import { PuterController } from '../types.js';
import { completeWebLogin, signOtpLoginChallenge } from './webSession.js';

/** Marks the browser that asked for a link; the link's own browser check. */
export const MAGIC_LINK_BINDING_COOKIE = 'puter_magic_link';
const BINDING_SHAPE = /^[A-Za-z0-9_-]{43}$/;

const REQUEST_WINDOW_MS = 15 * 60_000;

const requestEmailKey = (req: Request): string => {
    const email = req.body?.email;
    return typeof email === 'string' ? cleanEmail(email.trim()) : '';
};

const bindingFrom = (req: Request): string | null => {
    const value = req.cookies?.[MAGIC_LINK_BINDING_COOKIE];
    return typeof value === 'string' && BINDING_SHAPE.test(value)
        ? value
        : null;
};

/**
 * Sign-in links. Both routes are called by the GUI on its own origin: one mails
 * the link, the other spends it from the page the link opens.
 */
export class MagicLinkController extends PuterController {
    registerRoutes(router: PuterRouter): void {
        // -- POST /auth/magic-link/request ----------------------------
        // Mails a link, so an off-origin page must not be able to call it.
        router.post(
            '/auth/magic-link/request',
            {
                guiOriginOnly: true,
                rateLimit: [
                    {
                        scope: 'magic-link-request',
                        limit: 10,
                        window: REQUEST_WINDOW_MS,
                        key: 'ip',
                    },
                    {
                        scope: 'magic-link-request-email',
                        limit: 3,
                        window: REQUEST_WINDOW_MS,
                        key: requestEmailKey,
                    },
                    {
                        scope: 'magic-link-request-email-day',
                        limit: 10,
                        window: 24 * 60 * 60_000,
                        key: requestEmailKey,
                    },
                ],
            },
            async (req: Request, res: Response) => {
                const binding =
                    bindingFrom(req) ??
                    crypto.randomBytes(32).toString('base64url');
                const { requestId } = await this.services.magicLink.request({
                    email: req.body?.email,
                    appOrigin: req.body?.app_origin,
                    browserBinding: binding,
                });
                res.cookie(MAGIC_LINK_BINDING_COOKIE, binding, {
                    ...sessionCookieFlags(this.config, { crossSite: false }),
                    httpOnly: true,
                    maxAge: MAGIC_LINK_TTL_SECONDS * 1000,
                    path: '/',
                });
                res.json({ success: true, request_id: requestId });
            },
        );

        // -- POST /auth/magic-link/consume ----------------------------
        // Answers like `/login`: a session, or the 2FA challenge. A browser
        // that didn't ask for the link gets `confirm` until it resends with
        // `confirm: true`.
        router.post(
            '/auth/magic-link/consume',
            {
                guiOriginOnly: true,
                rateLimit: {
                    scope: 'magic-link-consume',
                    limit: 30,
                    window: REQUEST_WINDOW_MS,
                    key: 'ip',
                },
            },
            async (req: Request, res: Response) => {
                const body = req.body ?? {};
                const redemption = await this.services.magicLink.redeem(
                    body.token,
                    {
                        browserBinding: bindingFrom(req),
                        confirmed: body.confirm === true,
                    },
                );
                if (redemption.status === 'confirm') {
                    res.json({
                        proceed: false,
                        next_step: 'confirm',
                        email: redemption.email,
                        app_origin: redemption.appOrigin,
                    });
                    return;
                }

                const { claims } = redemption;
                const fingerprint =
                    typeof body.fingerprint === 'string'
                        ? body.fingerprint
                        : null;
                const user = await this.services.magicLink.resolveUser(
                    claims.email,
                    req,
                    {
                        data: {
                            'cf-turnstile-response':
                                body['cf-turnstile-response'] ?? null,
                        },
                        fingerprint,
                    },
                );
                const link = {
                    request_id: claims.rid,
                    app_origin: claims.app,
                };

                if (user.otp_enabled) {
                    res.status(202).json({
                        proceed: true,
                        next_step: 'otp',
                        otp_jwt_token: signOtpLoginChallenge(
                            this.services.token,
                            user,
                        ),
                        ...link,
                    });
                    return;
                }

                const login = await completeWebLogin(req, res, user, {
                    config: this.config,
                    clients: this.clients,
                    stores: this.stores,
                    services: this.services,
                });
                res.json({ ...login, ...link });
            },
        );
    }
}
