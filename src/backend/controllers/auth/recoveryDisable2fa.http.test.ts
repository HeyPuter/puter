import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashRecoveryCode } from '../../services/auth/OTPUtil.js';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../../testUtil.js';

describe('2FA after signing in with a recovery code', () => {
    let env: PuterTestEnv;
    const password = 'lost-authenticator-password';

    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 120_000);
    afterAll(async () => {
        await env?.shutdown();
    });

    const post = (
        path: string,
        body: Record<string, unknown>,
        cookie?: string,
    ) =>
        fetch(new URL(path, env.origin), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(cookie ? { cookie } : {}),
            },
            body: JSON.stringify(body),
        });

    it('allows an unused recovery code to disable 2FA after password revalidation', async () => {
        const username = `lost2fa_${uuidv4().slice(0, 8)}`;
        await createTestUser(env.server, { username, password });
        const user = (await env.server.stores.user.getByUsername(username))!;
        await env.server.stores.user.update(user.id, {
            email: `${username}@example.com`,
            email_confirmed: true,
            otp_enabled: true,
            otp_secret: 'TESTSECRETBASE32',
            otp_recovery_codes: ['RECOVER1', 'RECOVER2', 'RECOVER3']
                .map(hashRecoveryCode)
                .join(','),
        });

        // Sign in with a recovery code: works, and yields a web session.
        const login = await post('/login', { username, password });
        expect(login.status).toBe(202);
        const { otp_jwt_token } = await login.json();
        const recovered = await post('/login/recovery-code', {
            token: otp_jwt_token,
            code: 'RECOVER1',
        });
        expect((await recovered.json()).next_step).toBe('complete');
        const cookie = recovered.headers
            .getSetCookie()
            .find((value) => value.startsWith('puter_auth_token='))!
            .split(';')[0]!;

        const reused = await post(
            '/user-protected/disable-2fa',
            { password, code: 'RECOVER1' },
            cookie,
        );
        expect(reused.status).toBe(401);
        expect(
            (await env.server.stores.user.getById(user.id, { force: true }))!
                .otp_enabled,
        ).toBeTruthy();

        const disable = await post(
            '/user-protected/disable-2fa',
            { password, code: 'RECOVER2' },
            cookie,
        );
        expect(disable.status).toBe(200);
        expect(await disable.json()).toMatchObject({ success: true });

        const after = await env.server.stores.user.getById(user.id, {
            force: true,
        });
        expect(after!.otp_enabled).toBeFalsy();
        expect(after!.otp_secret).toBeNull();
        expect(after!.otp_recovery_codes).toBeNull();
    });
});
