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
import type { AuthService } from '../../services/auth/AuthService.js';
import type { TokenService } from '../../services/auth/TokenService.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import type { IConfig } from '../../types.js';
import { sessionCookieFlags } from '../../util/cookieFlags.js';
import {
    buildUserDetails,
    scrubSensitive,
    type UserDetailsDeps,
} from '../../util/userDetails.js';

/** Lifetime of the `otp-login` JWT a first factor hands back. */
export const OTP_LOGIN_TOKEN_TTL = '5m';

/**
 * The challenge a first factor hands an account with 2FA on. `/login/otp` and
 * `/login/recovery-code` redeem it; `claims` rides along to them.
 */
export function signOtpLoginChallenge(
    token: TokenService,
    user: Pick<UserRow, 'uuid'>,
    claims: Record<string, unknown> = {},
): string {
    return token.sign(
        'otp',
        {
            ...claims,
            user_uid: user.uuid,
            purpose: 'otp-login',
            // Keeps each token distinct for the single-use check.
            jti: crypto.randomUUID(),
        },
        { expiresIn: OTP_LOGIN_TOKEN_TTL },
    );
}

/**
 * Open a web session for a sign-in this request completed, recording where it
 * came from, and set its HTTP-only cookie. Returns the GUI token, the only
 * credential the client sees.
 */
export async function startWebSession(
    req: Request,
    res: Response,
    user: UserRow,
    deps: { config: IConfig; auth: AuthService },
): Promise<string> {
    const { token, gui_token } = await deps.auth.createSessionToken(user, {
        ip: req.ip || req.socket?.remoteAddress,
        user_agent: req.headers?.['user-agent'],
        origin: req.headers?.origin,
        host: req.headers?.host,
    });
    res.cookie(deps.config.cookie_name ?? 'puter_token', token, {
        ...sessionCookieFlags(deps.config),
        httpOnly: true,
    });
    return gui_token;
}

/**
 * Finish a sign-in whose every factor passed: open the web session and build
 * the body `/login` answers with, so a no-reload login can store `user` as
 * `window.user` verbatim.
 */
export async function completeWebLogin(
    req: Request,
    res: Response,
    user: UserRow,
    deps: UserDetailsDeps & { services: { auth: AuthService } },
): Promise<{
    proceed: true;
    next_step: 'complete';
    token: string;
    user: Record<string, unknown>;
}> {
    const guiToken = await startWebSession(req, res, user, {
        config: deps.config,
        auth: deps.services.auth,
    });
    const details = await buildUserDetails(user, deps, { isUser: true });
    scrubSensitive(details);
    return {
        proceed: true,
        next_step: 'complete',
        token: guiToken,
        user: details,
    };
}
