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
import { onResponseClose } from '../../core/http/onResponseClose.js';
import type { AuthService } from '../../services/auth/AuthService.js';
import type {
    SignInDevice,
    SignInInput,
    SignInResult,
    SignInService,
} from '../../services/auth/SignInService.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import type { IConfig } from '../../types.js';
import { sessionCookieFlags } from '../../util/cookieFlags.js';
import {
    type KnownDeviceDeps,
    knownDeviceStatus,
    rememberDevice,
} from './knownDevice.js';

/** Run `task` once the response has gone out; a failure is only logged. */
export function runAfterResponse(
    res: Response,
    task: () => Promise<void>,
): void {
    onResponseClose(res, () => {
        void (async () => {
            try {
                await task();
            } catch (e) {
                console.warn('[auth] after-response task failed:', e);
            }
        })();
    });
}

/**
 * Complete an interactive sign-in this request proved: the sign-in pipeline
 * runs (and may refuse it), then a web session opens with its HTTP-only cookie.
 * Returns the GUI token, the only credential the client sees, and the row with
 * any verification gate the sign-in set.
 */
export async function startWebSession(
    req: Request,
    res: Response,
    user: UserRow,
    deps: {
        config: IConfig;
        auth: AuthService;
        signIn: SignInService;
    } & KnownDeviceDeps,
    method: SignInInput['method'],
): Promise<SignInResult> {
    // A temporary account has no credential to guard or address to notify.
    // A cross-site POST (a provider's form_post callback) can't carry the
    // Lax device cookie, so the device is unknowable there.
    const recordDevice =
        (user.password !== null || user.email !== null) &&
        !(
            req.method === 'POST' &&
            req.headers?.['sec-fetch-site'] === 'cross-site'
        );
    const device: Promise<SignInDevice | null> = recordDevice
        ? knownDeviceStatus(req, user.uuid, deps)
        : Promise.resolve(null);
    return deps.signIn.signIn({
        req,
        user,
        method,
        device,
        openSession: async (sessionUser) => {
            const { session, token, gui_token } =
                await deps.auth.createSessionToken(sessionUser, {
                    ip: req.ip || req.socket?.remoteAddress,
                    user_agent: req.headers?.['user-agent'],
                    origin: req.headers?.origin,
                    host: req.headers?.host,
                });
            res.cookie(deps.config.cookie_name ?? 'puter_token', token, {
                ...sessionCookieFlags(deps.config),
                httpOnly: true,
            });
            if (recordDevice) await rememberDevice(req, res, user.uuid, deps);
            return { sessionUuid: String(session.uuid), guiToken: gui_token };
        },
        afterResponse: (task) => runAfterResponse(res, task),
    });
}
