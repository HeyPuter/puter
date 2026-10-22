import { TOTP } from 'otpauth';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { installSeatStub } from '../../testFixtures/seatStub.js';

describe('account change second-factor verification', () => {
    let env: PuterTestEnv;
    const password = 'email-change-password';
    const links = new Map<string, string>();

    beforeAll(async () => {
        env = await setupPuterTestEnv({ teams_enabled: true } as IConfig);
        vi.spyOn(env.server.clients.email, 'send').mockImplementation(
            async (to, template, values) => {
                if (template === 'email_verification_link')
                    links.set(to, String(values?.link));
                return null;
            },
        );
    }, 120_000);
    afterAll(async () => {
        await env?.shutdown();
    });

    const account = async (enabled = true, oidcOnly = false) => {
        const username = `email2fa_${uuidv4().slice(0, 8)}`;
        const credentials = await createTestUser(env.server, {
            username,
            password,
        });
        const user = (await env.server.stores.user.getByUsername(username))!;
        const otp = new TOTP({
            issuer: 'puter.com',
            label: username,
            algorithm: 'SHA1',
            digits: 6,
        });
        await env.server.stores.user.update(user.id, {
            email: `${username}@example.com`,
            email_confirmed: true,
            otp_enabled: enabled,
            otp_secret: otp.secret.base32,
            ...(oidcOnly ? { password: null } : {}),
        });
        return { ...credentials, id: user.id, uuid: user.uuid, otp };
    };

    const change = (
        token: string,
        body: Record<string, unknown>,
        revalidation?: string,
        path = '/user-protected/change-email',
    ) =>
        fetch(new URL(path, env.origin), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                cookie: `puter_auth_token=${token}${revalidation ? `; puter_revalidation=${revalidation}` : ''}`,
            },
            body: JSON.stringify(body),
        });

    it.each([undefined, 'invalid-code', 123456, {}])(
        'rejects an enabled account with code %j before staging a change',
        async (code) => {
            const user = await account();
            const response = await change(user.token, {
                password,
                new_email: 'changed@example.com',
                code,
            });
            expect(response.status).toBeGreaterThanOrEqual(400);
            expect(response.status).toBeLessThan(500);
            expect(await response.json()).toMatchObject({ factor: 'otp' });
            const after = await env.server.stores.user.getById(user.id, {
                force: true,
            });
            expect(after!.change_email_confirm_token).toBeFalsy();
            expect(after!.unconfirmed_change_email).toBeFalsy();
        },
    );

    it('rejects an incorrect six-digit code without staging the address', async () => {
        const user = await account();
        const code = ['000000', '000001', '000002', '000003'].find(
            (token) => user.otp.validate({ token, window: 1 }) === null,
        );
        const response = await change(user.token, {
            password,
            new_email: 'wrong-code@example.com',
            code,
        });
        expect(response.status).toBe(401);
        expect(await response.json()).toMatchObject({
            code: 'code_mismatch',
            factor: 'otp',
        });
        expect(
            (await env.server.stores.user.getById(user.id, { force: true }))!
                .change_email_confirm_token,
        ).toBeFalsy();
    });

    it('refuses a change when the enabled account secret is unavailable', async () => {
        const user = await account();
        await env.server.stores.user.update(user.id, {
            otp_secret: 'invalid!',
        });
        expect(
            (
                await change(user.token, {
                    password,
                    new_email: 'bad-secret@example.com',
                    code: '000000',
                })
            ).status,
        ).toBe(401);
    });

    it('requires a code even after OIDC revalidation', async () => {
        const user = await account(true, true);
        const proof = env.server.services.token.sign(
            'oidc-state',
            {
                user_uuid: user.uuid,
                purpose: 'revalidate',
            },
            { expiresIn: '5m' },
        );
        expect(
            (
                await change(
                    user.token,
                    { new_email: 'oidc-changed@example.com' },
                    proof,
                )
            ).status,
        ).toBe(400);
        expect(
            (
                await change(
                    user.token,
                    {
                        new_email: 'oidc-changed@example.com',
                        code: user.otp.generate(),
                    },
                    proof,
                )
            ).status,
        ).toBe(200);
    });

    it.each([true, false])(
        'completes the change with the required factors (2FA enabled: %s)',
        async (enabled) => {
            const user = await account(enabled);
            const newEmail = `${uuidv4()}@example.com`;
            expect(
                (
                    await change(user.token, {
                        password,
                        new_email: newEmail,
                        ...(enabled ? { code: user.otp.generate() } : {}),
                    })
                ).status,
            ).toBe(200);
            const link = links.get(newEmail)!;
            expect(link).toBeTruthy();
            expect((await fetch(link, { redirect: 'manual' })).status).toBe(
                200,
            );
            expect(
                (await env.server.stores.user.getById(user.id, {
                    force: true,
                }))!.email,
            ).toBe(newEmail);
        },
    );

    it('requires a new request if 2FA is enabled after the link was issued', async () => {
        const user = await account(false);
        const newEmail = `${uuidv4()}@example.com`;
        expect(
            (await change(user.token, { password, new_email: newEmail }))
                .status,
        ).toBe(200);
        await env.server.stores.user.update(user.id, { otp_enabled: true });
        expect(
            (await fetch(links.get(newEmail)!, { redirect: 'manual' })).status,
        ).toBe(400);
        expect(
            (await env.server.stores.user.getById(user.id, { force: true }))!
                .email,
        ).not.toBe(newEmail);
    });

    it('refuses an existing confirmation link that never verified 2FA', async () => {
        const user = await account();
        const token = uuidv4();
        await env.server.stores.user.update(user.id, {
            change_email_confirm_token: token,
            unconfirmed_change_email: 'legacy-change@example.com',
        });
        const link = env.server.services.token.sign(
            'otp',
            {
                token,
                user_id: user.id,
                purpose: 'change-email',
            },
            { expiresIn: '1h' },
        );
        const response = await fetch(
            new URL(`/change_email/confirm?token=${link}`, env.origin),
            { redirect: 'manual' },
        );
        expect(response.status).toBe(400);
        expect(
            (await env.server.stores.user.getById(user.id, { force: true }))!
                .email,
        ).toBe(`${user.username}@example.com`);
    });
    describe('disabling 2FA', () => {
        it.each([undefined, 'invalid-code', 123456, {}])(
            'refuses code %j and retains the second-factor configuration',
            async (code) => {
                const user = await account();
                await env.server.stores.user.update(user.id, {
                    otp_recovery_codes: 'one,two,three',
                });
                const response = await change(
                    user.token,
                    { password, code },
                    undefined,
                    '/user-protected/disable-2fa',
                );
                expect(response.status).toBe(400);
                expect(await response.json()).toMatchObject({ factor: 'otp' });
                const after = await env.server.stores.user.getById(user.id, {
                    force: true,
                });
                expect(after!.otp_enabled).toBeTruthy();
                expect(after!.otp_secret).toBe(user.otp.secret.base32);
                expect(after!.otp_recovery_codes).toBe('one,two,three');
            },
        );

        it('rejects an incorrect six-digit code', async () => {
            const user = await account();
            const code = ['000000', '000001', '000002', '000003'].find(
                (token) => user.otp.validate({ token, window: 1 }) === null,
            );
            const response = await change(
                user.token,
                { password, code },
                undefined,
                '/user-protected/disable-2fa',
            );
            expect(response.status).toBe(401);
            expect(await response.json()).toMatchObject({
                code: 'code_mismatch',
                factor: 'otp',
            });
            expect(
                (await env.server.stores.user.getById(user.id, {
                    force: true,
                }))!.otp_enabled,
            ).toBeTruthy();
        });

        it.each([false, true])(
            'accepts a current code after proving identity (OIDC-only: %s)',
            async (oidcOnly) => {
                const user = await account(true, oidcOnly);
                const proof = oidcOnly
                    ? env.server.services.token.sign(
                          'oidc-state',
                          {
                              user_uuid: user.uuid,
                              purpose: 'revalidate',
                          },
                          { expiresIn: '5m' },
                      )
                    : undefined;
                const missing = await change(
                    user.token,
                    oidcOnly ? {} : { password },
                    proof,
                    '/user-protected/disable-2fa',
                );
                expect(missing.status).toBe(400);
                const response = await change(
                    user.token,
                    {
                        ...(oidcOnly ? {} : { password }),
                        code: user.otp.generate(),
                    },
                    proof,
                    '/user-protected/disable-2fa',
                );
                expect(response.status).toBe(200);
                const after = await env.server.stores.user.getById(user.id, {
                    force: true,
                });
                expect(after!.otp_enabled).toBeFalsy();
                expect(after!.otp_secret).toBeNull();
                expect(after!.otp_recovery_codes).toBeNull();
            },
        );

        it('does not accept a code without password or OIDC revalidation', async () => {
            const user = await account();
            const response = await change(
                user.token,
                { code: user.otp.generate() },
                undefined,
                '/user-protected/disable-2fa',
            );
            expect(response.status).toBe(403);
            expect(await response.json()).toMatchObject({
                code: 'password_required',
            });
            expect(
                (await env.server.stores.user.getById(user.id, {
                    force: true,
                }))!.otp_enabled,
            ).toBeTruthy();
        });

        it('does not let a valid code override a team requirement for 2FA', async () => {
            const member = await account(true, true);
            installSeatStub(env.server as never, [member.id], {
                require2fa: true,
            });
            const proof = env.server.services.token.sign('oidc-state', {
                user_uuid: member.uuid, purpose: 'revalidate',
            }, { expiresIn: '5m' });
            const response = await change(
                member.token,
                { code: member.otp.generate() },
                proof,
                '/user-protected/disable-2fa',
            );
            expect(response.status).toBe(409);
            expect(
                (await env.server.stores.user.getById(member.id, {
                    force: true,
                }))!.otp_enabled,
            ).toBeTruthy();
        });

        it('remains idempotent for an account with 2FA already disabled', async () => {
            const user = await account(false);
            expect(
                (
                    await change(
                        user.token,
                        { password },
                        undefined,
                        '/user-protected/disable-2fa',
                    )
                ).status,
            ).toBe(200);
        });
    });
});
