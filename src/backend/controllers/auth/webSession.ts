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
    isCardOnFileStep,
    isPhoneOnFileStep,
} from '../../util/verificationOrder.js';
import {
    issueDeviceCookie,
    type KnownDeviceDeps,
    knownDeviceStatus,
    recordKnownDevice,
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
            // A sign-in that still owes proof of the phone or card on file
            // hasn't shown it is the owner's: its device isn't remembered, and
            // the session is noted so that proof from elsewhere ends it.
            if (
                isPhoneOnFileStep(sessionUser) ||
                isCardOnFileStep(sessionUser)
            ) {
                const now = Math.floor(Date.now() / 1000);
                await deps.kv.set({
                    key: unprovenSessionPrefix(user.uuid) + session.uuid,
                    value: {
                        deviceId: recordDevice
                            ? issueDeviceCookie(req, res, deps)
                            : null,
                    },
                    expireAt: now + UNPROVEN_SESSION_TTL_SECONDS,
                });
            } else if (recordDevice) {
                await rememberDevice(req, res, user.uuid, deps);
            }
            return { sessionUuid: String(session.uuid), guiToken: gui_token };
        },
        afterResponse: (task) => runAfterResponse(res, task),
    });
}

/** Sessions opened while the account owed proof of its phone or card on file. */
const unprovenSessionPrefix = (userUuid: string): string =>
    `signin-unproven:${userUuid}:`;
const UNPROVEN_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const UNPROVEN_SESSIONS_READ = 100;

/**
 * Call when a request proves the phone or card on file, before the gate is
 * cleared: the session that proved it keeps going and its device is remembered,
 * and every other session opened while the proof was owed is revoked, since
 * clearing the gate would otherwise let them in too. Rejects if one can't be
 * revoked, so the gate stays.
 */
export async function settleProofOnFile(
    req: Request,
    userUuid: string,
    deps: { auth: AuthService } & Pick<KnownDeviceDeps, 'kv'>,
): Promise<void> {
    const prefix = unprovenSessionPrefix(userUuid);
    const { res } = await deps.kv.list({
        pattern: prefix,
        as: 'entries',
        limit: UNPROVEN_SESSIONS_READ,
    });
    const entries = ((res as { items?: unknown[] })?.items ?? []) as Array<{
        key: string;
        value: { deviceId?: string | null } | null;
    }>;
    const session = req.actor?.session;
    const proving = new Set([session?.uid, session?.parentUid]);
    for (const { key, value } of entries) {
        const sessionUuid = key.slice(prefix.length);
        if (proving.has(sessionUuid)) {
            if (value?.deviceId)
                await recordKnownDevice(userUuid, value.deviceId, deps);
        } else {
            await deps.auth.revokeSession(sessionUuid);
        }
        await deps.kv.del({ key });
    }
}
