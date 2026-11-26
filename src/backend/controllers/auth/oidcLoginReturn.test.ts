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
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configContainer } from '../../exports.js';
import type { OIDCService } from '../../services/auth/OIDCService.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import {
    finishOidcLogin,
    OIDC_POPUP_RETURN_COOKIE_NAME,
    type OidcLoginContinuation,
    signOidcPopupReturn,
    verifyOidcPopupReturn,
    type OidcFinishLoginOptions,
} from './oidcLoginReturn.js';
import { signRevalidation } from '../../core/http/middleware/userProtected.js';

const TEST_ORIGIN = 'http://test.local';

let server: PuterServer;

beforeAll(async () => {
    server = await setupTestServer({ origin: TEST_ORIGIN } as never);
});

afterAll(async () => {
    await server?.shutdown();
});

const token = () => server.services.token;
const oidc = (): OIDCService => server.services.oidc as unknown as OIDCService;

describe('popup-return proof', () => {
    it('round-trips a signed proof', () => {
        const proof = signOidcPopupReturn(token(), {
            opener_origin: 'https://app.test',
            logged_in: true,
        });
        expect(verifyOidcPopupReturn(token(), proof)).toMatchObject({
            opener_origin: 'https://app.test',
            logged_in: true,
        });
    });

    it('rejects garbage and tampered proofs', () => {
        expect(verifyOidcPopupReturn(token(), 'garbage')).toBeNull();
        const proof = signOidcPopupReturn(token(), { opener_origin: 'x' });
        expect(verifyOidcPopupReturn(token(), `${proof}x`)).toBeNull();
    });

    it('does not accept a state or a revalidation token as a proof', () => {
        expect(
            verifyOidcPopupReturn(
                token(),
                oidc().signState({
                    provider: 'google',
                    opener_origin: 'https://app.test',
                }),
            ),
        ).toBeNull();
        expect(
            verifyOidcPopupReturn(
                token(),
                signRevalidation(server.services.token, 'user-uuid-1'),
            ),
        ).toBeNull();
    });

    it('is not accepted as a state', () => {
        expect(
            oidc().verifyState(
                signOidcPopupReturn(token(), {
                    opener_origin: 'https://app.test',
                }),
            ),
        ).toBeNull();
    });
});

describe('finishOidcLogin', () => {
    const makeUser = async (otpEnabled: boolean): Promise<UserRow> => {
        const username = `fol_${Math.random().toString(36).slice(2, 10)}`;
        const user = await server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
        });
        return { ...user, otp_enabled: otpEnabled ? 1 : 0 } as UserRow;
    };

    const makeRes = () => {
        const captured: {
            redirect?: string;
            cookies: string[];
            headers: Record<string, string>;
        } = { cookies: [], headers: {} };
        const res = {
            cookie: (name: string) => {
                captured.cookies.push(name);
            },
            set: (name: string, value: string) => {
                captured.headers[name] = value;
            },
            redirect: (_status: number, url: string) => {
                captured.redirect = url;
            },
        } as unknown as Response;
        return { res, captured };
    };

    const req = { headers: {} } as unknown as Request;

    const continuationFor = (
        user: UserRow,
        embeddedInPopup: boolean,
    ): OidcLoginContinuation => ({
        userUuid: user.uuid,
        redirectUri: `${TEST_ORIGIN}/dashboard`,
        embeddedInPopup,
        openerOrigin: embeddedInPopup ? 'https://app.test' : null,
        messageId: embeddedInPopup ? '7' : null,
    });

    const deps = () => ({
        config: configContainer as IConfig,
        token: server.services.token,
        auth: server.services.auth,
        signIn: server.services.signIn,
        kv: server.stores.kv,
        user: server.stores.user,
    });

    const options = (overrides: Partial<OidcFinishLoginOptions> = {}) => ({
        method: 'oidc' as const,
        popupRetryUrl: () => 'unused',
        refusedUrl: () => 'unused',
        ...overrides,
    });

    it('starts a session and redirects to the return target', async () => {
        const user = await makeUser(false);
        const { res, captured } = makeRes();
        let retryCalls = 0;

        await finishOidcLogin(
            req,
            res,
            user,
            continuationFor(user, false),
            deps(),
            options({
                popupRetryUrl: () => {
                    retryCalls++;
                    return 'unused';
                },
            }),
        );

        expect(captured.redirect).toBe(`${TEST_ORIGIN}/dashboard`);
        expect(captured.cookies).toContain(
            (configContainer as IConfig).cookie_name ?? 'puter_token',
        );
        expect(retryCalls).toBe(0);
    });

    it('sends a popup sign-in back with an attested proof', async () => {
        const user = await makeUser(false);
        const { res, captured } = makeRes();

        await finishOidcLogin(
            req,
            res,
            user,
            continuationFor(user, true),
            deps(),
            options(),
        );

        const target = new URL(captured.redirect!);
        expect(target.searchParams.get('oidc_login')).toBe('true');
        expect(captured.cookies).toContain(OIDC_POPUP_RETURN_COOKIE_NAME);
        expect(
            verifyOidcPopupReturn(
                token(),
                target.searchParams.get('opener_state')!,
            ),
        ).toMatchObject({
            user_uuid: user.uuid,
            opener_origin: 'https://app.test',
            msg_id: '7',
            oidc_login: true,
        });
    });

    it('sends a 2FA account to its challenge without starting a session', async () => {
        const user = await makeUser(true);
        const { res, captured } = makeRes();
        let retryCalls = 0;
        const continuation = continuationFor(user, false);

        await finishOidcLogin(
            req,
            res,
            user,
            continuation,
            deps(),
            options({
                popupRetryUrl: () => {
                    retryCalls++;
                    return 'unused';
                },
            }),
        );

        const target = new URL(captured.redirect!);
        expect(target.pathname).toBe('/action/oidc-2fa');
        const fragment = new URLSearchParams(target.hash.slice(1));
        expect(fragment.get('retryUrl')).toBe(`${TEST_ORIGIN}/action/login`);
        expect(token().verify('otp', fragment.get('token')!)).toMatchObject({
            purpose: 'otp-login',
            user_uid: user.uuid,
            oidcContinuation: continuation,
        });
        expect(captured.cookies).toHaveLength(0);
        expect(captured.headers['Cache-Control']).toBe('no-store');
        expect(retryCalls).toBe(0);
    });

    it('asks the caller for the retry URL on a 2FA challenge in a popup', async () => {
        const user = await makeUser(true);
        const { res, captured } = makeRes();

        await finishOidcLogin(
            req,
            res,
            user,
            continuationFor(user, true),
            deps(),
            options({ popupRetryUrl: () => 'https://retry.test/action/sign-in' }),
        );

        const fragment = new URLSearchParams(
            new URL(captured.redirect!).hash.slice(1),
        );
        expect(fragment.get('retryUrl')).toBe(
            'https://retry.test/action/sign-in',
        );
    });
    it('sends a refused sign-in to the caller\'s refusal URL without a session', async () => {
        const user = await makeUser(false);
        const { res, captured } = makeRes();
        const handler = (_k: unknown, data: unknown) => {
            const d = data as { user?: { uuid?: string }; allow?: boolean; trail_id?: string };
            if (d.user?.uuid !== user.uuid) return;
            d.allow = false;
            d.trail_id = 'trail-helper-1';
        };
        server.clients.event.on('puter.signin.validate', handler);
        const refusals: Array<[string, string | undefined]> = [];
        try {
            await finishOidcLogin(
                req,
                res,
                user,
                continuationFor(user, false),
                deps(),
                options({
                    refusedUrl: (code, requestCode) => {
                        refusals.push([code, requestCode]);
                        return 'https://refused.test/';
                    },
                }),
            );
        } finally {
            server.clients.event.off('puter.signin.validate', handler);
        }
        expect(refusals).toEqual([['signin_blocked', 'trail-helper-1']]);
        expect(captured.redirect).toBe('https://refused.test/');
        expect(captured.cookies).toHaveLength(0);
    });
});
