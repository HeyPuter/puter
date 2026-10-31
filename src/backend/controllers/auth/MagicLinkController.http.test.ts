import crypto from 'node:crypto';
import { TOTP } from 'otpauth';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../../testUtil.js';
import type { IConfig } from '../../types.js';

interface SentLink {
    to: string;
    link: string;
    appHost: string | null;
}

describe('magic link sign-in', () => {
    let env: PuterTestEnv;
    let sent: SentLink[] = [];
    let signupValidate: ((event: Record<string, unknown>) => void) | null =
        null;
    let emailValidate: ((event: Record<string, unknown>) => void) | null =
        null;

    beforeAll(async () => {
        env = await setupPuterTestEnv({
            cookie_name: 'puter_auth_token',
        } as IConfig);
        // The mail transport is the external boundary: keep what would be sent.
        vi.spyOn(env.server.clients.email, 'send').mockImplementation(
            async (to, template, values) => {
                if (template === 'magic_link_sign_in') {
                    const { link, app_host } = values as {
                        link: string;
                        app_host: string | null;
                    };
                    sent.push({ to: String(to), link, appHost: app_host });
                }
                return {} as never;
            },
        );
        env.server.clients.event.on('puter.signup.validate', (_k, data) =>
            signupValidate?.(data as unknown as Record<string, unknown>),
        );
        env.server.clients.event.on('email.validate', (_k, data) =>
            emailValidate?.(data as unknown as Record<string, unknown>),
        );
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    beforeEach(() => {
        sent = [];
        signupValidate = null;
        emailValidate = null;
    });

    const account = async ({ confirmed = true, otp = false } = {}) => {
        const username = `ml${uuidv4().replace(/-/g, '').slice(0, 10)}`;
        await createTestUser(env.server, {
            username,
            password: 'magic-test-password',
        });
        const user = (await env.server.stores.user.getByUsername(username))!;
        const email = `${username}@example.com`;
        const totp = new TOTP({
            issuer: 'puter.com',
            label: username,
            algorithm: 'SHA1',
            digits: 6,
        });
        await env.server.stores.user.update(user.id, {
            email,
            clean_email: email,
            email_confirmed: confirmed,
            otp_enabled: otp,
            otp_secret: totp.secret.base32,
        });
        return { user, email, totp };
    };

    const tokenOf = (link: string) =>
        new URLSearchParams(new URL(link).hash.slice(1)).get('token')!;

    /** A link as the browser holding `binding` would have asked for it. */
    const mint = async (email: string, appOrigin?: string) => {
        const binding = crypto.randomBytes(32).toString('base64url');
        const before = sent.length;
        const { requestId } = await env.server.services.magicLink.request({
            email,
            appOrigin,
            browserBinding: binding,
        });
        expect(sent.length).toBe(before + 1);
        const mail = sent.at(-1)!;
        return { token: tokenOf(mail.link), mail, binding, requestId };
    };

    const consume = (
        token: string,
        opts: {
            binding?: string;
            confirm?: boolean;
            body?: Record<string, unknown>;
        } = {},
    ) =>
        fetch(new URL('/auth/magic-link/consume', env.origin), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(opts.binding
                    ? { cookie: `puter_magic_link=${opts.binding}` }
                    : {}),
            },
            body: JSON.stringify({
                token,
                ...(opts.confirm ? { confirm: true } : {}),
                ...opts.body,
            }),
        });

    const requestLink = (
        body: Record<string, unknown>,
        headers: Record<string, string> = {},
    ) =>
        fetch(new URL('/auth/magic-link/request', env.origin), {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body: JSON.stringify(body),
        });

    const opensSession = (response: Response) =>
        response.headers
            .getSetCookie()
            .some((value) => value.startsWith('puter_auth_token='));

    it('signs in the browser that asked for the link', async () => {
        const { user, email } = await account();
        const { token, binding, requestId, mail } = await mint(email);
        expect(mail.to).toBe(email);
        expect(new URL(mail.link).pathname).toBe('/action/magic-link');

        const response = await consume(token, { binding });
        expect(response.status).toBe(200);
        expect(opensSession(response)).toBe(true);
        expect(await response.json()).toMatchObject({
            proceed: true,
            next_step: 'complete',
            user: { username: user.username },
            request_id: requestId,
            app_origin: null,
        });
    });

    it('asks another browser to confirm the account before spending the link', async () => {
        const { email } = await account();
        const { token } = await mint(email);
        const otherBinding = crypto.randomBytes(32).toString('base64url');

        for (const binding of [undefined, otherBinding]) {
            const asked = await consume(token, { binding });
            expect(asked.status).toBe(200);
            expect(opensSession(asked)).toBe(false);
            expect(await asked.json()).toEqual({
                proceed: false,
                next_step: 'confirm',
                email,
                app_origin: null,
            });
        }

        const confirmed = await consume(token, { confirm: true });
        expect(confirmed.status).toBe(200);
        expect(opensSession(confirmed)).toBe(true);
    });

    it('works once', async () => {
        const { email } = await account();
        const { token, binding } = await mint(email);
        expect((await consume(token, { binding })).status).toBe(200);
        const again = await consume(token, { binding });
        expect(again.status).toBe(400);
        expect(await again.json()).toMatchObject({ code: 'link_expired' });
    });

    it('refuses a tampered link and tokens minted for other jobs', async () => {
        const { email } = await account();
        const { token, binding } = await mint(email);
        const tampered = token.slice(0, -2) + (token.endsWith('A') ? 'BB' : 'AA');
        const otherJob = env.server.services.token.sign('magic-link', {
            purpose: 'otp-login',
            jti: uuidv4(),
            email,
            rid: uuidv4(),
            bnd: 'x',
        });
        for (const bad of [tampered, otherJob, '', 'not-a-jwt']) {
            const response = await consume(bad, { binding, confirm: true });
            expect(response.status).toBe(400);
            expect(await response.json()).toMatchObject({
                code: 'link_expired',
            });
        }

        // Nor does a link pass for a 2FA challenge.
        const asOtp = await fetch(new URL('/login/otp', env.origin), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token, code: '123456' }),
        });
        expect(asOtp.status).toBe(400);
    });

    it('still requires the second factor', async () => {
        const { email, totp } = await account({ otp: true });
        const { token, binding } = await mint(email);
        const response = await consume(token, { binding });
        expect(response.status).toBe(202);
        expect(opensSession(response)).toBe(false);
        const body = await response.json();
        expect(body).toMatchObject({ proceed: true, next_step: 'otp' });
        expect(body.token).toBeUndefined();

        const verified = await fetch(new URL('/login/otp', env.origin), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                token: body.otp_jwt_token,
                code: totp.generate(),
            }),
        });
        expect(verified.status).toBe(200);
        expect(opensSession(verified)).toBe(true);
        expect(await verified.json()).toMatchObject({ next_step: 'complete' });
    });

    it('refuses a suspended account and mails it nothing', async () => {
        const { user, email } = await account();
        const { token, binding } = await mint(email);
        await env.server.stores.user.update(user.id, { suspended: 1 });

        const response = await consume(token, { binding });
        expect(response.status).toBe(401);
        expect(await response.json()).toMatchObject({
            code: 'account_suspended',
        });

        const before = sent.length;
        await env.server.services.magicLink.request({
            email,
            appOrigin: undefined,
            browserBinding: binding,
        });
        expect(sent.length).toBe(before);
    });

    it('refuses an account whose address was never confirmed', async () => {
        const { user, email } = await account({ confirmed: false });
        const { token, binding } = await mint(email);
        const response = await consume(token, { binding });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
            code: 'email_unconfirmed',
        });
        const after = await env.server.stores.user.getById(user.id, {
            force: true,
        });
        expect(after?.email_confirmed).toBeFalsy();
    });

    it('creates a new account through the signup gate', async () => {
        const email = `new-${uuidv4().slice(0, 8)}@example.com`;
        let gate: Record<string, unknown> | null = null;
        signupValidate = (event) => {
            gate = event;
        };
        const { token, binding } = await mint(email);
        const fingerprint = 'a'.repeat(32);
        const response = await consume(token, {
            binding,
            body: { 'cf-turnstile-response': 'captcha-token', fingerprint },
        });
        expect(response.status).toBe(200);
        expect(opensSession(response)).toBe(true);

        expect(gate).toMatchObject({
            source: 'magic_link',
            email,
            is_temp: false,
            fingerprint,
            data: { 'cf-turnstile-response': 'captcha-token', email },
        });
        const created = await env.server.stores.user.findEmailOwner(email, {
            force: true,
        });
        expect(created).toMatchObject({ password: null });
        expect(created?.email_confirmed).toBeTruthy();
    });

    it('creates nothing when the signup gate blocks', async () => {
        const email = `blocked-${uuidv4().slice(0, 8)}@example.com`;
        signupValidate = (event) => {
            event.allow = false;
            event.message = 'Signup blocked.';
            event.trail_id = 'trail-123';
        };
        const { token, binding } = await mint(email);
        const response = await consume(token, { binding });
        expect(response.status).toBe(403);
        const body = await response.json();
        expect(body.code).toBe('signup_blocked');
        expect(body.message).toContain('Request Code: trail-123');
        expect(opensSession(response)).toBe(false);
        expect(
            await env.server.stores.user.findEmailOwner(email, { force: true }),
        ).toBeNull();
    });

    it('names the site it signs in to and refuses a non-http one', async () => {
        const { email } = await account();
        const { token, mail, binding } = await mint(
            email,
            'https://todo.example/some/page',
        );
        expect(mail.appHost).toBe('todo.example');
        const response = await consume(token, { binding });
        expect(await response.json()).toMatchObject({
            app_origin: 'https://todo.example',
        });

        await expect(
            env.server.services.magicLink.request({
                email,
                appOrigin: 'javascript:alert(1)',
                browserBinding: binding,
            }),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    describe('POST /auth/magic-link/request', () => {
        it('marks the browser and answers alike for addresses with no account', async () => {
            const email = `fresh-${uuidv4().slice(0, 8)}@example.com`;
            const first = await requestLink({ email });
            expect(first.status).toBe(200);
            const body = await first.json();
            expect(body).toEqual({
                success: true,
                request_id: expect.any(String),
            });
            const cookie = first.headers
                .getSetCookie()
                .find((value) => value.startsWith('puter_magic_link='))!;
            expect(cookie).toMatch(/HttpOnly/i);
            expect(sent.at(-1)?.to).toBe(email);

            // A browser keeps its mark across requests.
            const binding = cookie.split(';')[0]!;
            const second = await requestLink(
                { email },
                { cookie: binding },
            );
            expect(
                second.headers
                    .getSetCookie()
                    .find((value) => value.startsWith('puter_magic_link='))
                    ?.split(';')[0],
            ).toBe(binding);
        });

        it('refuses a page on another origin', async () => {
            const response = await requestLink(
                { email: `x-${uuidv4().slice(0, 8)}@example.com` },
                { origin: 'https://evil.example' },
            );
            expect(response.status).toBe(403);
            expect(sent).toEqual([]);
        });

        it('refuses an address the email checks block', async () => {
            emailValidate = (event) => {
                event.allow = false;
            };
            const response = await requestLink({
                email: `x-${uuidv4().slice(0, 8)}@blocked.example`,
            });
            expect(response.status).toBe(400);
            expect(sent).toEqual([]);
        });

        it('limits links to one address', async () => {
            const email = `limit-${uuidv4().slice(0, 8)}@example.com`;
            for (let i = 0; i < 3; i++) {
                expect((await requestLink({ email })).status).toBe(200);
            }
            expect((await requestLink({ email })).status).toBe(429);
            expect(sent.length).toBe(3);
        });
    });
});
