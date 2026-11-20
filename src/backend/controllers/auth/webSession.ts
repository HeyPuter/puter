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
import { HttpError } from '../../core/http/HttpError.js';
import type { UserRow, UserStore } from '../../stores/user/UserStore.js';
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
        user: Pick<UserStore, 'getById'>;
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
            // The proof signs every other session out. One that lands while
            // this sign-in runs would miss this session, so a sign-in that
            // finds the gate gone isn't kept, and gets no cookie.
            const owesProof = owesProofOnFile(sessionUser);
            if (owesProof) {
                const fresh = await deps.user.getById(user.id, { force: true });
                if (!fresh || !owesProofOnFile(fresh)) {
                    await deps.auth.revokeSession(String(session.uuid));
                    throw new HttpError(409, 'Please sign in again.', {
                        legacyCode: 'conflict',
                        code: 'signin_retry',
                    });
                }
            }
            res.cookie(deps.config.cookie_name ?? 'puter_token', token, {
                ...sessionCookieFlags(deps.config),
                httpOnly: true,
            });
            // A sign-in that still owes that proof hasn't shown it is the
            // owner's, so its device isn't remembered yet; the id is kept for
            // the request that proves it.
            if (owesProof && recordDevice) {
                try {
                    await deps.kv.set({
                        key: unprovenDeviceKey(String(session.uuid)),
                        value: issueDeviceCookie(req, res, deps),
                        expireAt:
                            Math.floor(Date.now() / 1000) +
                            UNPROVEN_DEVICE_TTL_SECONDS,
                    });
                } catch (e) {
                    console.warn('[known-device] pending id not kept:', e);
                }
            } else if (recordDevice) {
                await rememberDevice(req, res, user.uuid, deps);
            }
            return { sessionUuid: String(session.uuid), guiToken: gui_token };
        },
        afterResponse: (task) => runAfterResponse(res, task),
    });
}

const owesProofOnFile = (user: UserRow): boolean =>
    isPhoneOnFileStep(user) || isCardOnFileStep(user);

/**
 * The sign-in a request belongs to: its web session, or the one its token was
 * handed out under.
 */
export const signInOf = (req: Request): string | null =>
    req.actor?.session?.parentUid ?? req.actor?.session?.uid ?? null;

/** The device id of a session opened while proof on file was owed. */
const unprovenDeviceKey = (sessionUuid: string): string =>
    `signin-unproven-device:${sessionUuid}`;
// As long as an idle web session lasts.
const UNPROVEN_DEVICE_TTL_SECONDS = 180 * 24 * 60 * 60;

/**
 * Remember the device of the session that just proved the phone or card on
 * file. Best effort: a device that isn't recorded is only asked again.
 */
export async function rememberProvenDevice(
    req: Request,
    userUuid: string,
    deps: Pick<KnownDeviceDeps, 'kv'>,
): Promise<void> {
    const session = req.actor?.session;
    for (const sessionUuid of [session?.uid, session?.parentUid]) {
        if (!sessionUuid) continue;
        try {
            const key = unprovenDeviceKey(sessionUuid);
            const { res } = await deps.kv.get({ key });
            if (typeof res !== 'string' || !res) continue;
            await recordKnownDevice(userUuid, res, deps);
            await deps.kv.del({ key });
        } catch (e) {
            console.warn('[known-device] proven device not recorded:', e);
        }
    }
}
