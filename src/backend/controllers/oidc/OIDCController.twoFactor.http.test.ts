import { TOTP } from 'otpauth';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import {
    setupPuterTestEnv,
    createTestUser,
    type PuterTestEnv,
} from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { hashRecoveryCode } from '../../services/auth/OTPUtil.js';

describe('OIDC account second-factor login', () => {
    let env: PuterTestEnv;
    let claims: { sub: string; email: string; email_verified: boolean };
    beforeAll(async () => {
        env = await setupPuterTestEnv({
            cookie_name: 'puter_auth_token',
            oidc: {
                providers: {
                    custom: {
                        client_id: 'test-client',
                        client_secret: 'test-secret',
                        authorization_endpoint: 'https://idp.example/authorize',
                        token_endpoint: 'https://idp.example/token',
                        userinfo_endpoint: 'https://idp.example/userinfo',
                    },
                },
            },
        } as IConfig);
        vi.spyOn(
            env.server.services.oidc,
            'exchangeCodeForTokens',
        ).mockResolvedValue({ access_token: 'test-access' } as never);
        vi.spyOn(env.server.services.oidc, 'getUserInfo').mockImplementation(
            async () => claims,
        );
    }, 120_000);
    afterAll(async () => {
        await env?.shutdown();
    });

    const account = async (enabled = true, linked = true) => {
        const username = `oidc2fa-${uuidv4().slice(0, 8)}`;
        await createTestUser(env.server, {
            username,
            password: 'oidc-test-password',
        });
        const user = (await env.server.stores.user.getByUsername(username))!;
        const otp = new TOTP({
            issuer: 'puter.com',
            label: username,
            algorithm: 'SHA1',
            digits: 6,
        });
        claims = {
            sub: uuidv4(),
            email: `${username}@example.com`,
            email_verified: true,
        };
        await env.server.stores.user.update(user.id, {
            email: claims.email,
            email_confirmed: true,
            otp_enabled: enabled,
            otp_secret: otp.secret.base32,
            otp_recovery_codes: hashRecoveryCode('ABCDEFG2'),
        });
        if (linked) {
            await env.server.services.oidc.linkProviderToUser(
                user.id,
                'custom',
                claims,
            );
        }
        return { user, otp };
    };
    const callback = async (
        flow = 'login',
        extra: Record<string, string> = {},
    ) => {
        const start = new URL(
            `/auth/oidc/custom/start?flow=${flow}`,
            env.origin,
        );
        Object.entries(extra).forEach(([key, value]) =>
            start.searchParams.set(key, value),
        );
        const begun = await fetch(start, { redirect: 'manual' });
        expect(begun.status).toBe(302);
        const state = new URL(begun.headers.get('location')!).searchParams.get(
            'state',
        )!;
        const nonce = begun.headers
            .getSetCookie()
            .find((value) => value.startsWith('puter_oidc_nonce='))!
            .split(';')[0]!;
        return fetch(
            new URL(
                `/auth/oidc/callback/${flow}?code=test-code&state=${encodeURIComponent(state)}`,
                env.origin,
            ),
            { redirect: 'manual', headers: { cookie: nonce } },
        );
    };
    const verify = (token: string, code: string, recovery = false) =>
        fetch(
            new URL(
                recovery ? '/login/recovery-code' : '/login/otp',
                env.origin,
            ),
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ token, code }),
            },
        );
    const challenge = (response: Response) => {
        expect(response.status).toBe(302);
        expect(
            response.headers
                .getSetCookie()
                .some((value) => value.startsWith('puter_auth_token=')),
        ).toBe(false);
        const location = new URL(response.headers.get('location')!);
        expect(location.pathname).toBe('/action/oidc-2fa');
        const token = new URLSearchParams(location.hash.slice(1)).get('token');
        expect(token).toBeTruthy();
        return token!;
    };

    it.each(['login', 'signup'])(
        'requires the authenticator before completing existing-account %s',
        async (flow) => {
            const { otp } = await account();
            const token = challenge(
                await callback(flow, { return_to: '/dashboard' }),
            );
            const response = await verify(token, otp.generate());
            expect(response.status).toBe(200);
            expect(await response.json()).toMatchObject({
                proceed: true,
                next_step: 'complete',
                redirectUrl: `${env.origin}/dashboard${flow === 'signup' ? '?oidc_switched=login' : ''}`,
            });
            expect(
                response.headers
                    .getSetCookie()
                    .some((value) => value.startsWith('puter_auth_token=')),
            ).toBe(true);
            expect((await verify(token, otp.generate())).status).toBe(400);
        },
    );

    it('incorrect codes do not start a session and allow a valid recovery-code retry', async () => {
        const { otp } = await account();
        const token = challenge(await callback());
        const wrong = ['000000', '000001', '000002'].find(
            (code) => otp.validate({ token: code }) === null,
        )!;
        const rejected = await verify(token, wrong);
        expect(await rejected.json()).toMatchObject({ proceed: false });
        expect(rejected.headers.getSetCookie()).toHaveLength(0);
        const accepted = await verify(token, 'ABCDEFG2', true);
        expect(accepted.status).toBe(200);
        expect(await accepted.json()).toMatchObject({
            proceed: true,
            redirectUrl: env.origin,
        });
    });

    it('preserves an unauthenticated popup retry and attests login only after verification', async () => {
        const { otp, user } = await account();
        const response = await callback('login', {
            embedded_in_popup: 'true',
            msg_id: 'message-123',
            opener_origin: 'https://app.example',
        });
        const token = challenge(response);
        const fragment = new URLSearchParams(
            new URL(response.headers.get('location')!).hash.slice(1),
        );
        const retry = new URL(fragment.get('retryUrl')!);
        expect(retry.origin).toBe(env.origin);
        expect(retry.searchParams.get('action')).toBe('login');
        expect(retry.searchParams.get('embedded_in_popup')).toBe('true');
        expect(retry.searchParams.get('msg_id')).toBe('message-123');
        expect(retry.searchParams.has('auth_error')).toBe(false);
        const retryNonce = response.headers
            .get('set-cookie')!
            .match(/puter_oidc_popup_return=([^;, ]+)/)![1];
        const retried = await fetch(
            new URL('/auth/oidc/verify-popup-return', env.origin),
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    cookie: `puter_oidc_popup_return=${retryNonce}`,
                },
                body: JSON.stringify({
                    opener_state: retry.searchParams.get('opener_state'),
                }),
            },
        );
        expect(retried.status).toBe(200);
        expect(await retried.json()).toMatchObject({
            action: 'login',
            oidc_login: false,
            user_uuid: null,
            msg_id: 'message-123',
            opener_origin: 'https://app.example',
        });
        const accepted = await verify(token, otp.generate());
        const data = await accepted.json();
        const target = new URL(data.redirectUrl);
        expect(target.pathname).toBe('/action/sign-in');
        expect(target.searchParams.get('msg_id')).toBe('message-123');
        expect(target.searchParams.get('oidc_login')).toBe('true');
        const proof = env.server.services.oidc.verifyPopupReturn(
            target.searchParams.get('opener_state')!,
        );
        expect(proof).toMatchObject({
            user_uuid: user.uuid,
            opener_origin: 'https://app.example',
            msg_id: 'message-123',
            oidc_login: true,
        });
        expect(
            accepted.headers
                .getSetCookie()
                .some((value) => value.startsWith('puter_oidc_popup_return=')),
        ).toBe(true);
    });

    it('requires the authenticator when verified email first links an existing account', async () => {
        const { otp } = await account(true, false);
        const token = challenge(await callback());
        expect((await verify(token, otp.generate())).status).toBe(200);
    });

    it('requires the authenticator for an OIDC-only account', async () => {
        const { user, otp } = await account();
        await env.server.stores.user.update(user.id, { password: null });
        const token = challenge(await callback());
        const response = await verify(token, otp.generate());
        expect(await response.json()).toMatchObject({
            proceed: true,
            next_step: 'complete',
        });
    });

    it('uses distinct short-lived challenges and refuses a modified token', async () => {
        const { otp } = await account();
        const first = challenge(await callback());
        const second = challenge(await callback());
        expect(first).not.toBe(second);
        const decoded = env.server.services.token.verify<{
            purpose: string;
            jti: string;
            exp: number;
            iat: number;
        }>('otp', first);
        expect(decoded.purpose).toBe('otp-login');
        expect(decoded.jti).toBeTruthy();
        expect(decoded.exp - decoded.iat).toBe(300);
        const modified = `${first.slice(0, -4)}abcd`;
        const rejected = await verify(modified, otp.generate());
        expect(rejected.status).toBe(400);
        expect(rejected.headers.get('set-cookie')).toBeNull();
    });

    it('validates continuation account binding before creating any session', async () => {
        const { otp } = await account();
        const issued = challenge(await callback());
        const decoded = env.server.services.token.verify<
            Record<string, unknown>
        >('otp', issued);
        const continuation = decoded.oidcContinuation as Record<
            string,
            unknown
        >;
        const mismatched = env.server.services.token.sign('otp', {
            ...decoded,
            jti: uuidv4(),
            oidcContinuation: { ...continuation, userUuid: uuidv4() },
        });
        const rejected = await verify(mismatched, otp.generate());
        expect(rejected.status).toBe(400);
        expect(rejected.headers.get('set-cookie')).toBeNull();
    });

    it('clamps a signed continuation redirect to the configured origin', async () => {
        const { otp } = await account();
        const issued = challenge(await callback());
        const decoded = env.server.services.token.verify<
            Record<string, unknown>
        >('otp', issued);
        const continuation = decoded.oidcContinuation as Record<
            string,
            unknown
        >;
        const redirected = env.server.services.token.sign('otp', {
            ...decoded,
            jti: uuidv4(),
            oidcContinuation: {
                ...continuation,
                redirectUri: 'https://elsewhere.example/',
            },
        });
        const accepted = await verify(redirected, otp.generate());
        expect(await accepted.json()).toMatchObject({
            proceed: true,
            redirectUrl: env.origin,
        });
    });

    it('preserves ordinary OIDC login for accounts without 2FA', async () => {
        await account(false);
        const response = await callback('login', { return_to: '/desktop' });
        expect(response.headers.get('location')).toBe(`${env.origin}/desktop`);
        expect(
            response.headers.get('set-cookie')?.includes('puter_auth_token='),
        ).toBe(true);
    });
});
