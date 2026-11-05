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

import type { Request, Response } from 'express';
import type { AuthService } from '../../services/auth/AuthService.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import type { IConfig } from '../../types.js';
import { sessionCookieFlags } from '../../util/cookieFlags.js';

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
