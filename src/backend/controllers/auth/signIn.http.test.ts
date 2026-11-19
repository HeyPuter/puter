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

import { TOTP } from 'otpauth';
import { v4 as uuidv4 } from 'uuid';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import type { EventMap } from '../../clients/event/types.js';
import { hashRecoveryCode } from '../../services/auth/OTPUtil.js';
import { credentialExposureKey } from '../../services/auth/SignInService.js';
import { installSeatStub } from '../../testFixtures/seatStub.js';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import {
    KNOWN_DEVICE_COOKIE_NAME,
    knownDevicesMarkerKey,
} from './knownDevice.js';

const SIGNAL_SECRET = 'edge-proxy-secret';
const EXPOSED_HEADER = 'x-test-credential-exposed';
const BOT_HEADER = 'x-test-bot';
const DAY_MS = 24 * 60 * 60 * 1000;

type ValidateEvent = EventMap['puter.signin.validate'];
type AttemptEvent = EventMap['puter.signin.attempt'];
const bodyOf = (event: { req: unknown }) =>
    (event.req as { body: Record<string, unknown> }).body;
/** The raw bytes the JSON parser kept, if it kept any. */
const rawBodyOf = (event: { req: unknown }) =>
    (event.req as { rawBody?: Buffer }).rawBody;
type SentMail = {
    to: string;
    template: string;
    values: Record<string, unknown>;
};

const deviceCookieOf = (response: Response): string | undefined =>
    response.headers
        .getSetCookie()
        .join(', ')
        .match(
            new RegExp(`(?:^|,\\s*)(${KNOWN_DEVICE_COOKIE_NAME}=[^;]+)`),
        )?.[1];

const sqlTimestamp = (ms: number) =>
    new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/** Lets the work a sign-in leaves for after its response finish. */
const afterResponseWork = () => new Promise((r) => setTimeout(r, 150));

describe('sign-in pipeline', () => {
    let env: PuterTestEnv;
    const password = 'sign-in-pipeline-password';
    const sent: SentMail[] = [];
    let nextAddress = 0;
    const cleanups: Array<() => void> = [];

    beforeAll(async () => {
        env = await setupPuterTestEnv({
            trust_proxy: true,
            requestSignalHeaders: {
                [EXPOSED_HEADER]: 'credential_exposed',
                [BOT_HEADER]: 'bot',
            },
            requestSignalValue: SIGNAL_SECRET,
        } as IConfig);
    }, 120_000);
    afterAll(async () => {
        await env?.shutdown();
    });
    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup();
        vi.restoreAllMocks();
        vi.useRealTimers();
        sent.length = 0;
    });

    const captureEmail = () =>
        vi
            .spyOn(env.server.clients.email, 'send')
            .mockImplementation(async (to, template, values) => {
                sent.push({
                    to,
                    template,
                    values: values as Record<string, unknown>,
                });
                return {} as never;
            });

    /** Listen for the test's duration. */
    const listen = <K extends keyof EventMap>(
        key: K,
        listener: (data: EventMap[K]) => void | Promise<void>,
    ) => {
        const handler = async (_key: string, data: unknown) =>
            listener(data as EventMap[K]);
        env.server.clients.event.on(key, handler as never);
        cleanups.push(() =>
            env.server.clients.event.off(key, handler as never),
        );
    };

    const freshAddress = () => {
        nextAddress++;
        return `10.20.${(nextAddress >> 8) & 255}.${nextAddress & 255}`;
    };

    const login = async (
        username: string,
        opts: {
            cookie?: string;
            headers?: Record<string, string>;
            body?: Record<string, unknown>;
        } = {},
    ) => {
        const ip = freshAddress();
        const response = await fetch(new URL('/login', env.origin), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-forwarded-for': ip,
                'user-agent':
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                ...(opts.cookie ? { cookie: opts.cookie } : {}),
                ...opts.headers,
            },
            body: JSON.stringify({ username, password, ...opts.body }),
        });
        return {
            ip,
            status: response.status,
            body: (await response.json()) as Record<string, unknown> & {
                user?: Record<string, unknown>;
            },
            deviceCookie: deviceCookieOf(response),
        };
    };

    const account = async (
        opts: { confirmed?: boolean; inactiveDays?: number } = {},
    ) => {
        const username = `signin_${uuidv4().slice(0, 8)}`;
        await createTestUser(env.server, { username, password });
        const created = (await env.server.stores.user.getByUsername(username))!;
        await env.server.stores.user.update(created.id, {
            email: `${username}@example.com`,
            email_confirmed: opts.confirmed ?? true,
            ...(opts.inactiveDays === undefined
                ? {}
                : {
                      last_activity_ts: sqlTimestamp(
                          Date.now() - opts.inactiveDays * DAY_MS,
                      ),
                  }),
        });
        const user = (await env.server.stores.user.getById(created.id, {
            force: true,
        }))!;
        return { username, user };
    };

    /** Mail to one account; work an earlier test left can still land. */
    const mailTo = (username: string) =>
        sent.filter((m) => m.to === `${username}@example.com`);

    const sessionCount = async (userId: number) =>
        ((await env.server.stores.session.getByUserId(userId)) as unknown[])
            .length;

    const reread = (userId: number) =>
        env.server.stores.user.getById(userId, { force: true });

    describe('puter.signin.validate', () => {
        it('runs before the session exists, with the documented payload', async () => {
            const { username, user } = await account();
            const before = await sessionCount(user.id);
            let seen: ValidateEvent | undefined;
            let bodyAtValidate: Record<string, unknown> | undefined;
            let rawAtValidate: Buffer | undefined;
            let sessionsAtValidate = -1;
            listen('puter.signin.validate', async (event) => {
                if (event.user.uuid !== user.uuid) return;
                seen = { ...event };
                bodyAtValidate = { ...bodyOf(event) };
                rawAtValidate = rawBodyOf(event);
                sessionsAtValidate = await sessionCount(user.id);
            });
            const announced: EventMap['puter.signin'][] = [];
            listen('puter.signin', (event) => {
                if (event.user_uuid === user.uuid) announced.push(event);
            });

            const { status, ip } = await login(username, {
                body: { fingerprint: 'device-fp-12345678', captcha: 'tok' },
            });

            expect(status).toBe(200);
            expect(sessionsAtValidate).toBe(before);
            expect(seen).toMatchObject({
                method: 'password',
                ip,
                user_agent: expect.stringContaining('Chrome/131'),
                tls_fingerprint: null,
                fingerprint: 'device-fp-12345678',
                dormant_days: 0,
                is_dormant: false,
                known_device: false,
                credential_exposed: false,
                account: {
                    has_verified_phone: false,
                    has_verified_card: false,
                    otp_enabled: false,
                    oidc_linked: false,
                    email_confirmed: true,
                    is_org_seat: false,
                    is_temp: false,
                },
                allow: true,
                message: null,
                code: null,
                requires_phone_verification: false,
                requires_card_verification: false,
                trail_id: undefined,
            });
            expect(seen!.data).toEqual({
                username,
                fingerprint: 'device-fp-12345678',
                captcha: 'tok',
            });
            // The verified password is gone from the request by then, parsed
            // and raw.
            expect(bodyAtValidate).toEqual({
                username,
                fingerprint: 'device-fp-12345678',
                captcha: 'tok',
            });
            expect(rawAtValidate).toBeUndefined();

            expect(await sessionCount(user.id)).toBe(before + 1);
            expect(announced).toHaveLength(1);
            const sessions = (await env.server.stores.session.getByUserId(
                user.id,
            )) as Array<{ uuid: string }>;
            expect(sessions.map((s) => s.uuid)).toContain(
                announced[0]!.session_uuid,
            );
            expect(announced[0]).toMatchObject({
                user_id: user.id,
                username,
                method: 'password',
                ip,
                known_device: false,
                is_dormant: false,
                dormant_days: 0,
            });
        });

        it('hands listeners the account row without its secrets', async () => {
            const { username, user } = await account();
            const secrets = {
                otp_secret: 'JBSWY3DPEHPK3PXP',
                otp_recovery_codes: 'hashed-a,hashed-b',
                pass_recovery_token: uuidv4(),
                email_confirm_code: '123456',
                email_confirm_token: uuidv4(),
                change_email_confirm_token: uuidv4(),
            };
            await env.server.stores.user.update(user.id, secrets);
            await env.server.stores.user.updateMetadata(user.id, {
                tmp_password: 'admin-temp',
                theme: 'dark',
            });
            const stored = (await reread(user.id))!;
            let seenUser: Record<string, unknown> | undefined;
            listen('puter.signin.validate', (event) => {
                if (event.user.uuid === user.uuid) seenUser = event.user;
            });

            expect((await login(username)).status).toBe(200);

            for (const column of ['password', ...Object.keys(secrets)]) {
                expect(stored[column], column).toBeTruthy();
                expect(seenUser, column).not.toHaveProperty(column);
            }
            expect(seenUser!.metadata).toEqual({ theme: 'dark' });
            const kept = Object.keys(stored).filter(
                (k) => k !== 'password' && k !== 'metadata' && !(k in secrets),
            );
            for (const column of kept) {
                expect(seenUser![column], column).toEqual(stored[column]);
            }
            expect(seenUser).toMatchObject({ username, hasPassword: true });
        });

        it('logs one line per sign-in, without secrets', async () => {
            const { username, user } = await account();
            const lines: string[] = [];
            vi.spyOn(console, 'log').mockImplementation((...args) => {
                lines.push(args.map(String).join(' '));
            });
            const { ip } = await login(username, {
                headers: { 'user-agent': 'Bad"Agent\tx' },
            });
            const signIns = lines.filter((l) =>
                l.startsWith(`[auth] sign-in user=${user.uuid} `),
            );
            expect(signIns).toEqual([
                `[auth] sign-in user=${user.uuid} method=password ip=${ip} tls=- known_device=0 dormant_days=0 ua="Bad Agent x"`,
            ]);
            expect(lines.join('\n')).not.toContain(password);
        });

        it('sees the device cookie of a device that signed in before', async () => {
            const { username, user } = await account();
            const first = await login(username);
            const known: boolean[] = [];
            listen('puter.signin.validate', (event) => {
                if (event.user.uuid === user.uuid)
                    known.push(event.known_device);
            });
            await login(username, { cookie: first.deviceCookie });
            await login(username);
            expect(known).toEqual([true, false]);
        });

        it('runs once for a 2FA account, at the second factor, without its credentials', async () => {
            const { username, user } = await account();
            const secret = 'JBSWY3DPEHPK3PXP';
            await env.server.stores.user.update(user.id, {
                otp_enabled: true,
                otp_secret: secret,
            });
            const seen: ValidateEvent[] = [];
            const bodies: Array<Record<string, unknown>> = [];
            const raws: Array<Buffer | undefined> = [];
            listen('puter.signin.validate', (event) => {
                if (event.user.uuid !== user.uuid) return;
                seen.push({ ...event });
                bodies.push({ ...bodyOf(event) });
                raws.push(rawBodyOf(event));
            });
            const first = await login(username);
            expect(first.status).toBe(202);
            expect(seen).toHaveLength(0);

            const code = new TOTP({
                issuer: 'puter.com',
                label: username,
                algorithm: 'SHA1',
                digits: 6,
                secret,
            }).generate();
            const response = await fetch(new URL('/login/otp', env.origin), {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-forwarded-for': freshAddress(),
                },
                body: JSON.stringify({
                    token: first.body.otp_jwt_token,
                    code,
                }),
            });
            expect(response.status).toBe(200);
            expect(seen).toHaveLength(1);
            expect(seen[0]).toMatchObject({
                method: 'otp',
                data: {},
                account: { otp_enabled: true },
            });
            expect(seen[0]!.user).not.toHaveProperty('otp_secret');
            expect(bodies).toEqual([{}]);
            expect(raws).toEqual([undefined]);
        });

        it('a listener that throws is logged and the sign-in goes through', async () => {
            const { username, user } = await account();
            vi.spyOn(console, 'error').mockImplementation(() => {});
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            listen('puter.signin.validate', (event) => {
                if (event.user.uuid === user.uuid) throw new Error('down');
            });
            const { status, body } = await login(username);
            expect(status).toBe(200);
            expect(body.next_step).toBe('complete');
            expect(
                warn.mock.calls.some((args) =>
                    String(args[0]).includes(user.uuid),
                ),
            ).toBe(true);
        });

        it("keeps a completed listener's decision and drops a failed one's", async () => {
            const { username, user } = await account();
            vi.spyOn(console, 'error').mockImplementation(() => {});
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            listen('puter.signin.validate', (event) => {
                if (event.user.uuid === user.uuid)
                    event.requires_phone_verification = true;
            });
            listen('puter.signin.validate', (event) => {
                if (event.user.uuid !== user.uuid) return;
                event.allow = false;
                event.requires_card_verification = true;
                throw new Error('scoring service down');
            });
            const { status, body } = await login(username);
            expect(status).toBe(200);
            expect(body.user).toMatchObject({
                requires_phone_verification: true,
                requires_card_verification: false,
            });
        });

        it('a refusal answers 403 with the request code and mints nothing', async () => {
            const { username, user } = await account();
            const first = await login(username);
            const before = await sessionCount(user.id);
            const devicesBefore = (
                await env.server.stores.kv.get({
                    key: knownDevicesMarkerKey(user.uuid),
                })
            ).res;
            listen('puter.signin.validate', (event) => {
                if (event.user.uuid !== user.uuid) return;
                event.allow = false;
                event.message = 'Sign-in refused.';
                event.code = 'signin_suspicious';
                event.trail_id = 'trail-123';
            });

            const refused = await fetch(new URL('/login', env.origin), {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-forwarded-for': freshAddress(),
                },
                body: JSON.stringify({ username, password }),
            });
            const body = (await refused.json()) as Record<string, unknown>;
            expect(refused.status).toBe(403);
            expect(body).toMatchObject({
                code: 'signin_suspicious',
                message: 'Sign-in refused. Request Code: trail-123',
                request_code: 'trail-123',
            });
            expect(body.token).toBeUndefined();
            expect(refused.headers.getSetCookie()).toEqual([]);
            expect(await sessionCount(user.id)).toBe(before);
            expect(
                (
                    await env.server.stores.kv.get({
                        key: knownDevicesMarkerKey(user.uuid),
                    })
                ).res,
            ).toEqual(devicesBefore);
            expect(first.status).toBe(200);
        });

        it('a refusal without a code or trail still reads as blocked', async () => {
            const { username, user } = await account();
            listen('puter.signin.validate', (event) => {
                if (event.user.uuid === user.uuid) event.allow = false;
            });
            const { status, body } = await login(username);
            expect(status).toBe(403);
            expect(body.code).toBe('signin_blocked');
            expect(body.request_code).toBeUndefined();
        });

        it('persists the gates a listener asks for and returns them on the sign-in', async () => {
            const { username, user } = await account();
            listen('puter.signin.validate', (event) => {
                if (event.user.uuid !== user.uuid) return;
                event.requires_phone_verification = true;
                event.requires_card_verification = true;
            });
            const { status, body } = await login(username);
            expect(status).toBe(200);
            expect(body.user).toMatchObject({
                requires_phone_verification: true,
                requires_card_verification: true,
            });
            expect(await reread(user.id)).toMatchObject({
                requires_phone_verification: true,
                requires_card_verification: true,
            });
        });

        it('never clears a gate, and writes nothing when the gates are already set', async () => {
            const { username, user } = await account();
            await env.server.stores.user.update(user.id, {
                requires_phone_verification: true,
            });
            listen('puter.signin.validate', (event) => {
                if (event.user.uuid === user.uuid)
                    event.requires_phone_verification = true;
            });
            const update = vi.spyOn(env.server.stores.user, 'update');
            const { body } = await login(username);
            expect(body.user?.requires_phone_verification).toBe(true);
            expect(update).not.toHaveBeenCalled();

            // A sign-in no listener gates leaves the flag where it was.
            cleanups.splice(0).forEach((c) => c());
            await login(username);
            expect((await reread(user.id))?.requires_phone_verification).toBe(
                true,
            );
        });

        it('is not emitted for the sign-in a signup makes', async () => {
            const validated: string[] = [];
            const announced: EventMap['puter.signin'][] = [];
            listen('puter.signin.validate', (event) => {
                validated.push(String(event.user.username));
            });
            const username = `signup_${uuidv4().slice(0, 8)}`;
            listen('puter.signin', (event) => {
                if (event.username === username) announced.push(event);
            });
            captureEmail();
            const response = await fetch(new URL('/signup', env.origin), {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-forwarded-for': freshAddress(),
                },
                body: JSON.stringify({
                    username,
                    email: `${username}@example.com`,
                    password,
                }),
            });
            expect(response.status).toBe(200);
            await afterResponseWork();
            expect(validated).not.toContain(username);
            expect(announced).toHaveLength(1);
            expect(announced[0]!.method).toBe('signup');
            expect(
                mailTo(username).filter(
                    (m) => m.template === 'new_sign_in_notification',
                ),
            ).toHaveLength(0);
        });
    });

    describe('puter.signin.attempt', () => {
        it('runs before the account lookup, without the password, and refuses every account alike', async () => {
            const { username } = await account();
            const seen: AttemptEvent[] = [];
            const bodies: Array<Record<string, unknown>> = [];
            const raws: Array<Buffer | undefined> = [];
            listen('puter.signin.attempt', (event) => {
                seen.push({ ...event });
                bodies.push({ ...bodyOf(event) });
                raws.push(rawBodyOf(event));
                event.allow = false;
                event.message = 'Complete the captcha.';
                event.code = 'captcha_required';
                event.trail_id = 'trail-attempt';
            });
            const lookups = [
                vi.spyOn(env.server.stores.user, 'getByUsername'),
                vi.spyOn(env.server.stores.user, 'getByEmail'),
            ];

            const known = await login(username, {
                body: { fingerprint: 'device-fp-12345678', captcha: 'tok' },
            });
            const unknown = await login(`nobody_${uuidv4().slice(0, 8)}`, {
                body: { fingerprint: 'device-fp-12345678', captcha: 'tok' },
            });

            for (const refused of [known, unknown]) {
                expect(refused.status).toBe(403);
                expect(refused.body).toEqual({
                    error: 'Complete the captcha. Request Code: trail-attempt',
                    message: 'Complete the captcha. Request Code: trail-attempt',
                    code: 'captcha_required',
                    request_code: 'trail-attempt',
                });
            }
            for (const lookup of lookups) expect(lookup).not.toHaveBeenCalled();
            expect(seen).toHaveLength(2);
            expect(seen[0]).toMatchObject({
                ip: known.ip,
                user_agent: expect.stringContaining('Chrome/131'),
                tls_fingerprint: null,
                fingerprint: 'device-fp-12345678',
                data: {
                    username,
                    fingerprint: 'device-fp-12345678',
                    captcha: 'tok',
                },
            });
            expect(bodies[0]).toEqual(seen[0]!.data);
            expect(raws).toEqual([undefined, undefined]);
        });

        it('a refusal without a code or trail still reads as blocked', async () => {
            const { username } = await account();
            listen('puter.signin.attempt', (event) => {
                event.allow = false;
            });
            const { status, body } = await login(username);
            expect(status).toBe(403);
            expect(body).toMatchObject({
                code: 'signin_blocked',
                message: 'This sign-in was blocked.',
            });
            expect(body.request_code).toBeUndefined();
        });

        it('a listener that throws has no opinion, and the sign-in goes through', async () => {
            const { username } = await account();
            vi.spyOn(console, 'error').mockImplementation(() => {});
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            listen('puter.signin.attempt', (event) => {
                event.allow = false;
                throw new Error('captcha service down');
            });
            const { status, body, ip } = await login(username);
            expect(status).toBe(200);
            expect(body.next_step).toBe('complete');
            expect(
                warn.mock.calls.some((args) =>
                    String(args[0]).includes(`attempt listener failed ip=${ip}`),
                ),
            ).toBe(true);
        });

        it('runs once for a 2FA account, at the password, and not at its code or recovery code', async () => {
            const { username, user } = await account();
            const secret = 'JBSWY3DPEHPK3PXP';
            await env.server.stores.user.update(user.id, {
                otp_enabled: true,
                otp_secret: secret,
                otp_recovery_codes: hashRecoveryCode('ABCDEFG2'),
            });
            let attempts = 0;
            listen('puter.signin.attempt', () => {
                attempts++;
            });
            const secondLeg = async (route: string, json: unknown) =>
                fetch(new URL(route, env.origin), {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'x-forwarded-for': freshAddress(),
                    },
                    body: JSON.stringify(json),
                });

            const first = await login(username);
            expect(first.status).toBe(202);
            const code = new TOTP({
                issuer: 'puter.com',
                label: username,
                algorithm: 'SHA1',
                digits: 6,
                secret,
            }).generate();
            expect(
                (
                    await secondLeg('/login/otp', {
                        token: first.body.otp_jwt_token,
                        code,
                    })
                ).status,
            ).toBe(200);

            const again = await login(username);
            expect(
                (
                    await secondLeg('/login/recovery-code', {
                        token: again.body.otp_jwt_token,
                        code: 'ABCDEFG2',
                    })
                ).status,
            ).toBe(200);
            expect(attempts).toBe(2);
        });
    });

    describe('dormant sign-ins', () => {
        const signInConfig = () =>
            (env.server.services.signIn as unknown as { config: IConfig })
                .config;
        // The email step-up needs a deployment that can send mail.
        beforeEach(() => {
            const config = signInConfig();
            const original = config.email;
            config.email = { jsonTransport: true };
            return () => {
                config.email = original;
            };
        });

        it('gate an unconfirmed email and mail a code to the address on file', async () => {
            captureEmail();
            const { username, user } = await account({
                confirmed: false,
                inactiveDays: 200,
            });
            let seen: ValidateEvent | undefined;
            listen('puter.signin.validate', (event) => {
                if (event.user.uuid === user.uuid) seen = { ...event };
            });

            const { status, body } = await login(username);
            expect(status).toBe(200);
            expect(seen).toMatchObject({
                dormant_days: expect.any(Number),
                is_dormant: true,
            });
            expect(seen!.dormant_days).toBeGreaterThanOrEqual(199);
            expect(body.user).toMatchObject({
                requires_email_confirmation: true,
                email_confirmed: false,
            });

            const row = await reread(user.id);
            expect(row?.requires_email_confirmation).toBe(true);
            await vi.waitFor(() =>
                expect(
                    sent.find((m) => m.template === 'email_verification_code'),
                ).toBeDefined(),
            );
            const code = sent.find(
                (m) => m.template === 'email_verification_code',
            )!;
            expect(code.to).toBe(`${username}@example.com`);
            expect(code.values.code).toBe(String(row?.email_confirm_code));
            expect(
                await env.server.services.signup.isConfirmationCodeCurrent(
                    user.id,
                ),
            ).toBe(true);
        });

        it('can confirm the address but not change it while gated', async () => {
            captureEmail();
            const { username, user } = await account({
                confirmed: false,
                inactiveDays: 200,
            });
            const { body } = await login(username);
            const auth = { authorization: `Bearer ${String(body.token)}` };
            const call = (base: string, path: string, json?: unknown) =>
                fetch(new URL(path, base), {
                    method: json === undefined ? 'GET' : 'POST',
                    headers: { 'content-type': 'application/json', ...auth },
                    ...(json === undefined
                        ? {}
                        : { body: JSON.stringify(json) }),
                });

            expect((await call(env.apiOrigin, '/whoami')).status).toBe(200);
            // With nothing else verified, only the emailed code clears it.
            const change = await fetch(
                new URL('/user-protected/change-email', env.origin),
                {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        cookie: `puter_auth_token=${String(body.token)}`,
                    },
                    body: JSON.stringify({
                        new_email: `elsewhere-${username}@example.com`,
                        password,
                    }),
                },
            );
            expect(change.status).toBe(403);
            expect(((await change.json()) as { code?: string }).code).toBe(
                'email_confirmation_required',
            );

            await vi.waitFor(async () =>
                expect(
                    await env.server.services.signup.isConfirmationCodeCurrent(
                        user.id,
                    ),
                ).toBe(true),
            );
            const row = await reread(user.id);
            const confirm = await call(env.apiOrigin, '/confirm-email', {
                code: row?.email_confirm_code,
            });
            expect(confirm.status).toBe(200);
            expect(await confirm.json()).toMatchObject({
                email_confirmed: true,
            });
            expect((await reread(user.id))?.email_confirmed).toBe(true);
        });

        it('leave an unconfirmed email ungated where no mail can be sent', async () => {
            captureEmail();
            delete signInConfig().email;
            const { username, user } = await account({
                confirmed: false,
                inactiveDays: 200,
            });
            let seen: ValidateEvent | undefined;
            listen('puter.signin.validate', (event) => {
                if (event.user.uuid === user.uuid) seen = { ...event };
            });

            const { status, body } = await login(username);
            expect(status).toBe(200);
            expect(seen?.is_dormant).toBe(true);
            expect(body.user?.requires_email_confirmation).toBeFalsy();
            expect((await reread(user.id))?.requires_email_confirmation).toBe(
                false,
            );
            await afterResponseWork();
            expect(
                mailTo(username).filter(
                    (m) => m.template === 'email_verification_code',
                ),
            ).toHaveLength(0);
        });

        it('leave a confirmed email ungated', async () => {
            const { username, user } = await account({ inactiveDays: 200 });
            const { body } = await login(username);
            expect(body.user?.requires_email_confirmation).toBeFalsy();
            expect((await reread(user.id))?.requires_email_confirmation).toBe(
                false,
            );
        });

        it('do not count for a seat a team provisioned', async () => {
            captureEmail();
            const { username, user } = await account({
                confirmed: false,
                inactiveDays: 200,
            });
            cleanups.push(installSeatStub(env.server, [user.id]));
            let seen: ValidateEvent | undefined;
            listen('puter.signin.validate', (event) => {
                if (event.user.uuid === user.uuid) seen = { ...event };
            });
            const { status, body } = await login(username);
            expect(status).toBe(200);
            expect(seen?.is_dormant).toBe(false);
            expect(seen?.account.is_org_seat).toBe(true);
            expect(body.user?.requires_email_confirmation).toBeFalsy();
            await afterResponseWork();
            expect(mailTo(username)).toHaveLength(0);
        });

        it('are off with dormantSignInDays: 0', async () => {
            const config = env.server.services.signIn as unknown as {
                config: IConfig;
            };
            const original = config.config.dormantSignInDays;
            config.config.dormantSignInDays = 0;
            cleanups.push(() => {
                config.config.dormantSignInDays = original;
            });
            const { username, user } = await account({
                confirmed: false,
                inactiveDays: 400,
            });
            let seen: ValidateEvent | undefined;
            listen('puter.signin.validate', (event) => {
                if (event.user.uuid === user.uuid) seen = { ...event };
            });
            const { body } = await login(username);
            expect(seen?.is_dormant).toBe(false);
            expect(seen?.dormant_days).toBeGreaterThanOrEqual(399);
            expect(body.user?.requires_email_confirmation).toBeFalsy();
        });

        it('count from signup when the account has no recorded activity', async () => {
            captureEmail();
            const { username, user } = await account({ confirmed: false });
            await env.server.stores.user.update(user.id, {
                last_activity_ts: null,
                timestamp: sqlTimestamp(Date.now() - 200 * DAY_MS),
            });
            let seen: ValidateEvent | undefined;
            listen('puter.signin.validate', (event) => {
                if (event.user.uuid === user.uuid) seen = { ...event };
            });
            const { body } = await login(username);
            expect(seen?.is_dormant).toBe(true);
            expect(seen!.dormant_days).toBeGreaterThanOrEqual(199);
            expect(body.user?.requires_email_confirmation).toBe(true);
        });

        it('a brand-new account is zero days dormant', async () => {
            const { username, user } = await account();
            let seen: ValidateEvent | undefined;
            listen('puter.signin.validate', (event) => {
                if (event.user.uuid === user.uuid) seen = { ...event };
            });
            await login(username);
            expect(seen).toMatchObject({ dormant_days: 0, is_dormant: false });
        });

        it('a recent account is not dormant', async () => {
            const { username, user } = await account({ inactiveDays: 10 });
            let seen: ValidateEvent | undefined;
            listen('puter.signin.validate', (event) => {
                if (event.user.uuid === user.uuid) seen = { ...event };
            });
            await login(username);
            expect(seen).toMatchObject({ is_dormant: false });
            expect(seen!.dormant_days).toBeGreaterThanOrEqual(9);
            expect(seen!.dormant_days).toBeLessThanOrEqual(11);
        });
    });

    describe('new sign-in email', () => {
        let recipient = '';
        const notices = () =>
            mailTo(recipient).filter(
                (m) => m.template === 'new_sign_in_notification',
            );
        const noticedAccount = async (
            opts: Parameters<typeof account>[0] = {},
        ) => {
            const created = await account(opts);
            recipient = created.username;
            return created;
        };

        it('is not sent while the account has no recorded device', async () => {
            captureEmail();
            const { username } = await noticedAccount();
            await login(username);
            await afterResponseWork();
            expect(notices()).toHaveLength(0);
        });

        it('goes out once for sign-ins from new devices at the same moment', async () => {
            captureEmail();
            const { username } = await noticedAccount();
            await login(username);
            await afterResponseWork();
            await Promise.all([
                login(username),
                login(username),
                login(username),
            ]);
            await afterResponseWork();
            expect(notices()).toHaveLength(1);
        });

        it('is skipped when the notice cannot be claimed', async () => {
            captureEmail();
            const { username } = await noticedAccount();
            await login(username);
            await afterResponseWork();
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            vi.spyOn(console, 'error').mockImplementation(() => {});
            const kv = env.server.stores.kv;
            const set = kv.set.bind(kv);
            vi.spyOn(kv, 'set').mockImplementation(async (args, opts) => {
                if (String(args.key).includes('signin-notice')) {
                    throw new Error('kv down');
                }
                return set(args, opts);
            });
            await login(username);
            await afterResponseWork();
            expect(notices()).toHaveLength(0);
        });

        it('goes out for a new device once a device is recorded, at most hourly', async () => {
            captureEmail();
            const { username } = await noticedAccount();
            const first = await login(username);
            await afterResponseWork();

            // The device that signed in before raises nothing.
            await login(username, { cookie: first.deviceCookie });
            await afterResponseWork();
            expect(notices()).toHaveLength(0);

            const second = await login(username);
            await vi.waitFor(() => expect(notices()).toHaveLength(1));
            expect(notices()[0]).toMatchObject({
                to: `${username}@example.com`,
                values: {
                    username,
                    ip: second.ip,
                    device: 'Chrome 131 on Mac OS 10.15.7',
                    time: expect.stringMatching(
                        /^\d{4}-\d\d-\d\d \d\d:\d\d UTC$/,
                    ),
                    security_link: `${env.origin}/dashboard#security`,
                    reset_link: `${env.origin}/action/password-recovery`,
                },
            });

            await login(username);
            await afterResponseWork();
            expect(notices()).toHaveLength(1);
        });

        it('goes out for a dormant sign-in, even from a known device', async () => {
            captureEmail();
            const { username, user } = await noticedAccount();
            const first = await login(username);
            await env.server.stores.user.update(user.id, {
                last_activity_ts: sqlTimestamp(Date.now() - 200 * DAY_MS),
            });
            await login(username, { cookie: first.deviceCookie });
            await vi.waitFor(() => expect(notices()).toHaveLength(1));
        });

        it('is not sent without an email on file', async () => {
            captureEmail();
            const username = `noemail_${uuidv4().slice(0, 8)}`;
            await createTestUser(env.server, { username, password });
            await login(username);
            await login(username);
            await afterResponseWork();
            expect(
                sent.filter((m) => m.values.username === username),
            ).toHaveLength(0);
        });
    });

    describe('request signals', () => {
        it('announce a flagged request of a signed-in actor', async () => {
            const flagged: EventMap['puter.request.flagged'][] = [];
            listen('puter.request.flagged', (event) => {
                flagged.push(event);
            });
            const ip = freshAddress();
            const response = await fetch(new URL('/whoami', env.apiOrigin), {
                headers: {
                    authorization: `Bearer ${env.users.user.token}`,
                    'x-forwarded-for': ip,
                    [BOT_HEADER]: SIGNAL_SECRET,
                },
            });
            expect(response.status).toBe(200);
            await vi.waitFor(() => expect(flagged).toHaveLength(1));
            const user = (await env.server.stores.user.getByUsername(
                env.users.user.username,
            ))!;
            expect(flagged[0]).toEqual({
                signals: ['bot'],
                user_id: user.id,
                user_uuid: user.uuid,
                username: user.username,
                app_uid: null,
                method: 'GET',
                route: '/whoami',
                ip,
                tls_fingerprint: null,
            });
        });

        it('ignore a header without the configured value, and unflagged requests', async () => {
            const flagged: unknown[] = [];
            listen('puter.request.flagged', (event) => {
                flagged.push(event);
            });
            for (const headers of [{ [BOT_HEADER]: 'forged' }, {}]) {
                const response = await fetch(
                    new URL('/whoami', env.apiOrigin),
                    {
                        headers: {
                            authorization: `Bearer ${env.users.user.token}`,
                            ...headers,
                        },
                    },
                );
                expect(response.status).toBe(200);
            }
            await afterResponseWork();
            expect(flagged).toHaveLength(0);
        });

        it('ignore a request with no actor', async () => {
            const flagged: unknown[] = [];
            listen('puter.request.flagged', (event) => {
                flagged.push(event);
            });
            await fetch(new URL('/whoami', env.apiOrigin), {
                headers: { [BOT_HEADER]: SIGNAL_SECRET },
            });
            await afterResponseWork();
            expect(flagged).toHaveLength(0);
        });
    });

    describe('credential exposure from the edge proxy', () => {
        const exposureNotices = () =>
            sent.filter(
                (m) => m.template === 'credential_exposure_notification',
            );

        it('tells validate listeners before the session is minted', async () => {
            const { username, user } = await account();
            const seen: boolean[] = [];
            listen('puter.signin.validate', (event) => {
                if (event.user.uuid === user.uuid)
                    seen.push(event.credential_exposed);
            });
            await login(username, {
                headers: { [EXPOSED_HEADER]: SIGNAL_SECRET },
            });
            await login(username);
            expect(seen).toEqual([true, false]);
        });

        it('records, alarms and emails once per password after the password verifies', async () => {
            captureEmail();
            const alarm = vi.spyOn(env.server.clients.alarm, 'create');
            const events: EventMap['puter.signin.credential_exposed'][] = [];
            const { username, user } = await account();
            listen('puter.signin.credential_exposed', (event) => {
                if (event.user_uuid === user.uuid) events.push(event);
            });
            const headers = { [EXPOSED_HEADER]: SIGNAL_SECRET };

            const { status } = await login(username, { headers });
            expect(status).toBe(200);
            await vi.waitFor(() => expect(events).toHaveLength(1));
            expect(events[0]).toEqual({
                user_id: user.id,
                user_uuid: user.uuid,
                username,
                source: 'edge',
                notified: true,
            });
            expect(exposureNotices()).toEqual([
                {
                    to: `${username}@example.com`,
                    template: 'credential_exposure_notification',
                    values: {
                        username,
                        security_link: `${env.origin}/dashboard#security`,
                    },
                },
            ]);
            const raised = alarm.mock.calls.filter(
                ([id]) => id === `auth:credential-exposed:${user.uuid}`,
            );
            expect(raised).toHaveLength(1);
            expect(raised[0]!.slice(2)).toEqual([
                { username, user_uuid: user.uuid },
                'critical',
                { dedup: true },
            ]);
            const record = (
                await env.server.stores.kv.get({
                    key: credentialExposureKey(user.uuid),
                })
            ).res as Record<string, unknown>;
            expect(record).toMatchObject({
                sources: ['edge'],
                passwordTag: expect.stringMatching(/^[0-9a-f]{16}$/),
            });
            expect(JSON.stringify(record)).not.toContain(password);

            // The same password again: recorded and announced, not mailed.
            await login(username, { headers });
            await vi.waitFor(() => expect(events).toHaveLength(2));
            expect(events[1]!.notified).toBe(false);
            expect(exposureNotices()).toHaveLength(1);
        });

        it('acts on a wrong password not at all', async () => {
            const { username, user } = await account();
            const events: unknown[] = [];
            listen('puter.signin.credential_exposed', (event) => {
                if (event.user_uuid === user.uuid) events.push(event);
            });
            const response = await login(username, {
                headers: { [EXPOSED_HEADER]: SIGNAL_SECRET },
                body: { password: 'not-the-password' },
            });
            expect(response.status).toBe(401);
            await afterResponseWork();
            expect(events).toHaveLength(0);
        });

        it('runs at the password step of an account with 2FA, and ignores a forged signal', async () => {
            const { username, user } = await account();
            await env.server.stores.user.update(user.id, {
                otp_enabled: true,
                otp_secret: 'JBSWY3DPEHPK3PXP',
            });
            const events: unknown[] = [];
            listen('puter.signin.credential_exposed', (event) => {
                if (event.user_uuid === user.uuid) events.push(event);
            });
            const forged = await login(username, {
                headers: { [EXPOSED_HEADER]: 'forged' },
            });
            expect(forged.status).toBe(202);
            await afterResponseWork();
            expect(events).toHaveLength(0);

            const flagged = await login(username, {
                headers: { [EXPOSED_HEADER]: SIGNAL_SECRET },
            });
            expect(flagged.status).toBe(202);
            await vi.waitFor(() => expect(events).toHaveLength(1));
        });
    });
});
