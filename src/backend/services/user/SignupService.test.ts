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

import type { Request } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PuterServer } from '../../server.js';
import { installSeatStub } from '../../testFixtures/seatStub.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import { setupTestServer } from '../../testUtil.js';

let server: PuterServer;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const req = {
    headers: { 'user-agent': 'signup-test' },
    ip: '198.51.100.7',
    socket: { remoteAddress: '198.51.100.7' },
} as unknown as Request;

const slug = () => Math.random().toString(36).slice(2, 10);

/** Collects every payload `name` carries while `run` executes. */
const capture = async <T>(
    name: 'puter.signup.validate' | 'puter.signup.success',
    run: () => Promise<T>,
): Promise<{ result: T; seen: Array<Record<string, unknown>> }> => {
    const seen: Array<Record<string, unknown>> = [];
    const record = (_k: string, data: unknown) => {
        seen.push({ ...(data as Record<string, unknown>) });
    };
    server.clients.event.on(name, record);
    try {
        return { result: await run(), seen };
    } finally {
        server.clients.event.off(name, record);
    }
};

describe('SignupService.runSignupGate', () => {
    it('tells listeners which source a signup came from, and only forwards a fingerprint the form collected', async () => {
        const email = `gate-${slug()}@example.com`;

        const form = await capture('puter.signup.validate', () =>
            server.services.signup.runSignupGate({
                req,
                data: { username: 'x' },
                email,
                isTemp: false,
                fingerprint: 'fp-1',
                bonusCode: null,
            }),
        );
        const oidc = await capture('puter.signup.validate', () =>
            server.services.signup.runSignupGate({
                req,
                source: 'oidc',
                data: { username: 'x' },
                email,
                isTemp: false,
                bonusCode: null,
            }),
        );

        expect(form.seen[0]).toMatchObject({
            ip: '198.51.100.7',
            fingerprint: 'fp-1',
            is_temp: false,
        });
        expect(form.seen[0]).not.toHaveProperty('source');
        expect(oidc.seen[0]).toMatchObject({ source: 'oidc' });
        expect(oidc.seen[0]).not.toHaveProperty('fingerprint');
        expect(form.result.verdict).toBe('allowed');
    });

    it('turns a veto into a blocked verdict carrying the trail id', async () => {
        const veto = (_k: string, data: unknown) => {
            Object.assign(data as object, {
                allow: false,
                message: 'nope',
                code: 'blocked_by_policy',
                trail_id: 'trail-7',
            });
        };
        server.clients.event.on('puter.signup.validate', veto);
        try {
            const outcome = await server.services.signup.runSignupGate({
                req,
                data: {},
                email: `veto-${slug()}@example.com`,
                isTemp: false,
                bonusCode: null,
            });
            expect(outcome).toEqual({
                verdict: 'blocked',
                message: 'nope',
                code: 'blocked_by_policy',
                requestCode: 'trail-7',
            });
        } finally {
            server.clients.event.off('puter.signup.validate', veto);
        }
    });

    it('an OIDC-only policy refuses form and temp signups before the validate hook, and lets OIDC and team provisioning through', async () => {
        const oidcOnly = (_k: string, data: unknown) => {
            Object.assign(data as object, { oidcOnly: true });
        };
        server.clients.event.on('puter.signup.policy', oidcOnly);
        try {
            const gate = (input: {
                isTemp: boolean;
                source?: 'oidc' | 'team_provision';
            }) =>
                capture('puter.signup.validate', () =>
                    server.services.signup.runSignupGate({
                        req,
                        data: {},
                        email: `policy-${slug()}@example.com`,
                        bonusCode: null,
                        ...input,
                    }),
                );
            const form = await gate({ isTemp: false });
            const temp = await gate({ isTemp: true });
            const oidc = await gate({ isTemp: false, source: 'oidc' });
            const team = await gate({
                isTemp: false,
                source: 'team_provision',
            });

            expect(form.result).toMatchObject({
                verdict: 'blocked',
                code: 'signup_oidc_only',
            });
            expect(temp.result).toEqual({
                verdict: 'no_temp_user',
                message: null,
                code: null,
            });
            expect(form.seen).toHaveLength(0);
            expect(temp.seen).toHaveLength(0);
            expect(oidc.result.verdict).toBe('allowed');
            expect(team.result.verdict).toBe('allowed');
            expect(await server.services.signup.signupPolicy()).toEqual({
                oidcOnly: true,
                message: null,
            });
        } finally {
            server.clients.event.off('puter.signup.policy', oidcOnly);
        }
        expect(await server.services.signup.signupPolicy()).toEqual({
            oidcOnly: false,
            message: null,
        });
    });

    it('refuses an unknown bonus code before the validate hook runs', async () => {
        const { result, seen } = await capture('puter.signup.validate', () =>
            server.services.signup.runSignupGate({
                req,
                data: {},
                email: `bonus-${slug()}@example.com`,
                isTemp: false,
                bonusCode: 'nosuchcode',
            }),
        );
        expect(result).toEqual({ verdict: 'bonus_code_invalid' });
        expect(seen).toHaveLength(0);
    });
});

describe('SignupService.signup', () => {
    it('provisions a form signup and announces it with the form-only fields', async () => {
        const username = `su_${slug()}`;
        const {
            result: { user },
            seen,
        } = await capture('puter.signup.success', () =>
            server.services.signup.signup({
                req,
                body: {
                    username,
                    email: `${username}@example.com`,
                    password: 'correct horse battery',
                },
                isTemp: false,
                fingerprint: null,
                bonusCode: null,
            }),
        );

        expect(user.username).toBe(username);
        expect(user.trash_uuid).toBeTruthy();
        expect(seen).toEqual([
            {
                user_id: user.id,
                user_uuid: user.uuid,
                email: `${username}@example.com`,
                username,
                fingerprint: null,
                is_temp: false,
                ip: '198.51.100.7',
            },
        ]);
    });
});

describe('SignupService email gate last', () => {
    /** Signs up with the validate hook asking for `gates`; returns sent emails. */
    const signupWith = async (gates: Record<string, boolean>) => {
        const send = vi.fn(async () => true);
        const clients = server.clients as unknown as { email: unknown };
        const realEmail = clients.email;
        clients.email = { send };
        const require = (_k: string, data: unknown) => {
            Object.assign(data as Record<string, unknown>, gates);
        };
        server.clients.event.on('puter.signup.validate', require);
        const username = `egl_${slug()}`;
        try {
            const { user } = await server.services.signup.signup({
                req,
                body: {
                    username,
                    email: `${username}@example.com`,
                    password: 'correct horse battery',
                },
                isTemp: false,
                fingerprint: null,
                bonusCode: null,
            });
            return { user, send, restore: () => (clients.email = realEmail) };
        } finally {
            server.clients.event.off('puter.signup.validate', require);
        }
    };

    it('holds the confirmation email until card and phone are cleared, then sends it once', async () => {
        const { user, send, restore } = await signupWith({
            requires_phone_verification: true,
            requires_card_verification: true,
            email_gate_last: true,
        });
        try {
            expect(send).not.toHaveBeenCalled();
            const stored = await server.stores.user.getById(user.id, {
                force: true,
            });
            expect(stored!.metadata?.emailGateLast).toBe(true);

            await server.stores.user.update(user.id, {
                requires_card_verification: 0,
            });
            await server.services.signup.sendDeferredConfirmationEmail(user.id);
            expect(send).not.toHaveBeenCalled();

            await server.stores.user.update(user.id, {
                requires_phone_verification: 0,
            });
            await server.services.signup.sendDeferredConfirmationEmail(user.id);
            await server.services.signup.sendDeferredConfirmationEmail(user.id);
            expect(send).toHaveBeenCalledTimes(1);
            expect(send).toHaveBeenCalledWith(
                `${user.username}@example.com`,
                'email_verification_code',
                { code: stored!.email_confirm_code },
                { stream: 'signup' },
            );
        } finally {
            restore();
        }
    });

    it('ignores the flag when there is no phone or card gate', async () => {
        const { user, send, restore } = await signupWith({
            email_gate_last: true,
        });
        try {
            expect(send).toHaveBeenCalledTimes(1);
            const stored = await server.stores.user.getById(user.id, {
                force: true,
            });
            expect(stored!.metadata?.emailGateLast).toBeUndefined();
        } finally {
            restore();
        }
    });
});

describe('SignupService confirmation stream', () => {
    /** Signs up with a listener setting `email_stream`, then runs `check`. */
    const signupWithStream = async (
        emailStream: unknown,
        check: (signedUp: {
            stored: UserRow;
            send: ReturnType<typeof vi.fn>;
        }) => Promise<void>,
        extra = {},
    ) => {
        const send = vi.fn(async () => true);
        const clients = server.clients as unknown as { email: unknown };
        const realEmail = clients.email;
        clients.email = { send };
        const name = (_k: string, data: unknown) => {
            Object.assign(data as Record<string, unknown>, {
                email_stream: emailStream,
                ...extra,
            });
        };
        server.clients.event.on('puter.signup.validate', name);
        const username = `str_${slug()}`;
        try {
            const { user } = await server.services.signup.signup({
                req,
                body: {
                    username,
                    email: `${username}@example.com`,
                    password: 'correct horse battery',
                },
                isTemp: false,
                fingerprint: null,
                bonusCode: null,
            });
            const stored = await server.stores.user.getById(user.id, {
                force: true,
            });
            await check({ stored: stored!, send });
        } finally {
            server.clients.event.off('puter.signup.validate', name);
            clients.email = realEmail;
        }
    };

    it('sends the confirmation on the stream a listener names and remembers it', async () => {
        await signupWithStream('review:2', async ({ stored, send }) => {
            expect(send).toHaveBeenCalledWith(
                stored.email,
                'email_verification_code',
                { code: stored.email_confirm_code },
                { stream: 'review:2' },
            );
            expect(stored.metadata?.emailStream).toBe('review:2');
            expect(server.services.signup.confirmationStream(stored)).toBe(
                'review:2',
            );

            await server.services.signup.sendConfirmationEmail(
                stored,
                'resend',
                { code: '111111' },
            );
            expect(send).toHaveBeenLastCalledWith(
                stored.email,
                'email_verification_code',
                { code: '111111' },
                { stream: 'review:2' },
            );
        });
    });

    it('ignores a stream name that is not a short lowercase token, and says so', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            for (const bad of [
                'Upper',
                'has space',
                7,
                '-lead',
                'x'.repeat(65),
            ]) {
                await signupWithStream(bad, async ({ stored, send }) => {
                    expect(send).toHaveBeenCalledWith(
                        stored.email,
                        'email_verification_code',
                        { code: stored.email_confirm_code },
                        { stream: 'signup' },
                    );
                    expect(stored.metadata?.emailStream).toBeUndefined();
                });
                expect(warn).toHaveBeenCalledWith(
                    '[signup] ignored email_stream:',
                    bad,
                );
            }
        } finally {
            warn.mockRestore();
        }
    });

    it('records the gate order and the stream together', async () => {
        await signupWithStream(
            'held',
            async ({ stored, send }) => {
                expect(stored.metadata).toMatchObject({
                    emailGateLast: true,
                    emailStream: 'held',
                });
                expect(send).not.toHaveBeenCalled();
                await server.stores.user.update(stored.id, {
                    requires_phone_verification: 0,
                });
                await server.services.signup.sendDeferredConfirmationEmail(
                    stored.id,
                );
                expect(send).toHaveBeenCalledWith(
                    stored.email,
                    'email_verification_code',
                    { code: stored.email_confirm_code },
                    { stream: 'held' },
                );
            },
            { requires_phone_verification: true, email_gate_last: true },
        );
    });

    it('drops the stream a claimed row held when the signup names none', async () => {
        const username = `clm_${slug()}`;
        const email = `${username}@example.com`;
        const placeholder = await server.stores.user.create({
            username: `ph_${slug()}`,
            uuid: crypto.randomUUID(),
            password: null,
            email,
        });
        await server.stores.user.updateMetadata(placeholder.id, {
            emailStream: 'review',
        });
        const send = vi.fn(async () => true);
        const clients = server.clients as unknown as { email: unknown };
        const realEmail = clients.email;
        clients.email = { send };
        try {
            const { user } = await server.services.signup.signup({
                req,
                body: { username, email, password: 'correct horse battery' },
                isTemp: false,
                fingerprint: null,
                bonusCode: null,
            });
            expect(user.id).toBe(placeholder.id);
            expect(send).toHaveBeenCalledWith(
                email,
                'email_verification_code',
                expect.anything(),
                { stream: 'signup' },
            );
            const stored = await server.stores.user.getById(user.id, {
                force: true,
            });
            expect(server.services.signup.confirmationStream(stored!)).toBe(
                'signup',
            );
        } finally {
            clients.email = realEmail;
        }
    });

    it('falls back to the signup stream for an account without one', () => {
        expect(
            server.services.signup.confirmationStream({
                metadata: {},
            } as unknown as UserRow),
        ).toBe('signup');
    });
});

describe('SignupService.announceSignup', () => {
    it('leaves out the form-only fields for a source that has none', async () => {
        const username = `an_${slug()}`;
        const user = await server.stores.user.create({
            username,
            uuid: crypto.randomUUID(),
            password: null,
            email: `${username}@example.com`,
        });
        const { seen } = await capture('puter.signup.success', async () =>
            server.services.signup.announceSignup(user, {
                ip: '198.51.100.7',
                bonusCode: 'abcd1234',
                emailConfirmed: true,
                saveAccount: true,
            }),
        );
        expect(seen).toEqual([
            {
                user_id: user.id,
                user_uuid: user.uuid,
                email: user.email,
                username,
                ip: '198.51.100.7',
                bonus_code: 'abcd1234',
            },
        ]);
    });
});

describe('SignupService.confirmEmail', () => {
    const makeUnconfirmed = async () => {
        const username = `ce_${slug()}`;
        const created = await server.stores.user.create({
            username,
            uuid: crypto.randomUUID(),
            password: null,
            email: `${username}@example.com`,
            requires_email_confirmation: true,
        });
        return (await server.stores.user.getById(created.id, {
            force: true,
        }))!;
    };

    it("tells the account's other tabs, naming the one that confirmed", async () => {
        const user = await makeUnconfirmed();
        const send = vi.spyOn(server.services.socket, 'send');
        try {
            await server.services.signup.confirmEmail(user, {
                originalClientSocketId: 'sock-1',
            });
            expect(send).toHaveBeenCalledWith(
                { room: user.id },
                'user.email_confirmed',
                { original_client_socket_id: 'sock-1' },
            );
        } finally {
            send.mockRestore();
        }
        const after = await server.stores.user.getById(user.id, {
            force: true,
        });
        expect(after!.email_confirmed).toBeTruthy();
        expect(after!.email_confirm_code).toBeNull();
    });

    it('refuses with a 400 when the address index already has an owner', async () => {
        const user = await makeUnconfirmed();
        // An owner row the address checks don't strip (no clean_email, a
        // spelling sqlite compares unequal) whose index key still collides.
        const rival = await server.stores.user.create({
            username: `ce_${slug()}`,
            uuid: crypto.randomUUID(),
            password: 'hashed',
            email: `x${slug()}@example.com`,
        });
        await server.clients.db.write(
            'UPDATE `user` SET `email` = ?, `clean_email` = NULL WHERE `id` = ?',
            [user.email!.toUpperCase(), rival.id],
        );

        await expect(
            server.services.signup.confirmEmail(user),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'email_already_in_use',
        });
        const after = await server.stores.user.getById(user.id, {
            force: true,
        });
        expect(after!.email_confirmed).toBeFalsy();
    });

    it('leaves another account no way to take the address through a pending change', async () => {
        const owner = await makeUnconfirmed();
        const other = await makeUnconfirmed();
        await server.stores.user.update(other.id, {
            unconfirmed_change_email: owner.email,
            change_email_confirm_token: 'pending-tok',
        });

        await server.services.signup.confirmEmail(owner);

        const token = server.services.token.sign(
            'otp',
            {
                token: 'pending-tok',
                user_id: other.id,
                purpose: 'change-email',
            },
            { expiresIn: '1h' },
        );
        await expect(
            server.controllers.auth.handleChangeEmailConfirm(
                { query: { token } } as unknown as Request,
                { send: vi.fn() } as never,
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'email_already_in_use',
        });
        const after = await server.stores.user.getById(other.id, {
            force: true,
        });
        expect(after!.email).toBe(other.email);
    });
});

describe('SignupService.validateEmail', () => {
    it('refuses Puter mailbox addresses before any listener runs', async () => {
        const listener = vi.fn();
        server.clients.event.on('email.validate', listener);
        try {
            for (const email of [
                'someone@puter.email',
                'Someone@PUTER.EMAIL',
                'someone@puterstaging.email',
            ]) {
                await expect(
                    server.services.signup.validateEmail(email),
                ).rejects.toMatchObject({ statusCode: 400 });
            }
            expect(listener).not.toHaveBeenCalled();
            await expect(
                server.services.signup.validateEmail(
                    `ok-${slug()}@example.com`,
                ),
            ).resolves.toBeUndefined();
        } finally {
            server.clients.event.off('email.validate', listener);
        }
    });
});

// -- Refusals and failing hooks ----------------------------------------

/** Runs `run` with `listener` on `name`, removing it afterwards. */
const withListener = async <T>(
    name:
        | 'email.validate'
        | 'puter.signup.policy'
        | 'puter.signup.validate'
        | 'puter.signup-bonus.check'
        | 'puter.signup-bonus.validate',
    listener: (key: string, data: unknown) => void,
    run: () => Promise<T>,
): Promise<T> => {
    server.clients.event.on(name, listener);
    try {
        return await run();
    } finally {
        server.clients.event.off(name, listener);
    }
};

const patch = (fields: Record<string, unknown>) => (_k: string, data: unknown) => {
    Object.assign(data as object, fields);
};

const throwing = () => {
    throw new Error('listener down');
};

const signupBody = (username = `rf_${slug()}`) => ({
    username,
    email: `${username}@example.com`,
    password: 'correct horse battery',
});

const formSignup = (body: ReturnType<typeof signupBody>, isTemp = false) =>
    server.services.signup.signup({
        req,
        body,
        isTemp,
        fingerprint: null,
        bonusCode: null,
    });

describe('SignupService.validateEmail refusals', () => {
    it("answers with a listener's own message when it rejects the address", async () => {
        await withListener(
            'email.validate',
            patch({ allow: false, message: 'Disposable addresses are refused.' }),
            async () => {
                await expect(
                    server.services.signup.validateEmail(
                        `veto-${slug()}@example.com`,
                    ),
                ).rejects.toMatchObject({
                    statusCode: 400,
                    legacyCode: 'bad_request',
                    message: 'Disposable addresses are refused.',
                });
            },
        );
    });

    it('refuses the address when a listener gives no reason, or fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            for (const listener of [patch({ allow: false }), throwing]) {
                await withListener('email.validate', listener, async () => {
                    await expect(
                        server.services.signup.validateEmail(
                            `veto-${slug()}@example.com`,
                        ),
                    ).rejects.toMatchObject({
                        statusCode: 400,
                        message:
                            'This email cannot be used. Please try a different email address.',
                    });
                });
            }
        } finally {
            warn.mockRestore();
        }
    });

    it('refuses an address on a blocked domain', async () => {
        const config = server.services.signup as unknown as {
            config: { blockedEmailDomains?: string[] };
        };
        const original = config.config.blockedEmailDomains;
        config.config.blockedEmailDomains = ['blocked.example'];
        try {
            await expect(
                server.services.signup.validateEmail(
                    `someone-${slug()}@blocked.example`,
                ),
            ).rejects.toMatchObject({
                statusCode: 400,
                legacyCode: 'email_not_allowed',
                message: 'This email is not allowed.',
            });
        } finally {
            config.config.blockedEmailDomains = original;
        }
    });
});

describe('SignupService gate with failing or refusing hooks', () => {
    const gate = (isTemp = false) =>
        server.services.signup.runSignupGate({
            req,
            data: {},
            email: `hook-${slug()}@example.com`,
            isTemp,
            bonusCode: null,
        });

    it('restricts nothing when the policy hook fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            await withListener('puter.signup.policy', throwing, async () => {
                expect(await server.services.signup.signupPolicy()).toEqual({
                    oidcOnly: false,
                    message: null,
                });
            });
        } finally {
            warn.mockRestore();
        }
    });

    it('keeps only a string policy message', async () => {
        await withListener(
            'puter.signup.policy',
            patch({ oidcOnly: true, message: 42 }),
            async () => {
                expect(await server.services.signup.signupPolicy()).toEqual({
                    oidcOnly: true,
                    message: null,
                });
            },
        );
        await withListener(
            'puter.signup.policy',
            patch({ oidcOnly: true, message: 'Providers only.' }),
            async () => {
                expect(await gate()).toEqual({
                    verdict: 'blocked',
                    message: 'Providers only.',
                    code: 'signup_oidc_only',
                });
            },
        );
    });

    it('blocks the signup when the validate hook fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            await withListener('puter.signup.validate', throwing, async () => {
                expect(await gate()).toMatchObject({ verdict: 'blocked' });
            });
        } finally {
            warn.mockRestore();
        }
    });

    it('refuses only temp accounts when a listener sets no_temp_user', async () => {
        await withListener(
            'puter.signup.validate',
            patch({ no_temp_user: true, message: 'Sign up first.', code: 'c1' }),
            async () => {
                expect(await gate(true)).toEqual({
                    verdict: 'no_temp_user',
                    message: 'Sign up first.',
                    code: 'c1',
                });
                expect((await gate(false)).verdict).toBe('allowed');
            },
        );
    });
});

describe('SignupService.signup refusals', () => {
    it('refuses a username that is already taken', async () => {
        const taken = signupBody();
        await formSignup(taken);
        await expect(
            formSignup({ ...signupBody(), username: taken.username }),
        ).rejects.toMatchObject({
            statusCode: 400,
            message:
                'This username already exists in our database. Please use another one.',
        });
    });

    it('refuses an address an account with a password already holds', async () => {
        const first = signupBody();
        await formSignup(first);
        const second = { ...signupBody(), email: first.email };
        await expect(formSignup(second)).rejects.toMatchObject({
            statusCode: 400,
            message:
                'This email already exists in our database. Please use another one.',
        });
        expect(
            await server.stores.user.getByUsername(second.username),
        ).toBeNull();
    });

    it('answers a blocked signup with 403, the listener code and the request code', async () => {
        const body = signupBody();
        await withListener(
            'puter.signup.validate',
            patch({
                allow: false,
                message: 'Not from here.',
                code: 'blocked_by_policy',
                trail_id: 'trail-9',
            }),
            async () => {
                await expect(formSignup(body)).rejects.toMatchObject({
                    statusCode: 403,
                    legacyCode: 'blocked_by_policy',
                    message: 'Not from here. Request Code: trail-9',
                });
            },
        );
        expect(await server.stores.user.getByUsername(body.username)).toBeNull();
    });

    it('answers a blocked signup that names no reason with a generic 403', async () => {
        await withListener(
            'puter.signup.validate',
            patch({ allow: false }),
            async () => {
                await expect(formSignup(signupBody())).rejects.toMatchObject({
                    statusCode: 403,
                    message: 'Signup blocked',
                });
            },
        );
    });

    it('sends a refused temp signup to login or signup', async () => {
        const body = signupBody();
        await withListener(
            'puter.signup.validate',
            patch({ no_temp_user: true }),
            async () => {
                await expect(formSignup(body, true)).rejects.toMatchObject({
                    statusCode: 403,
                    legacyCode: 'must_login_or_signup',
                    message: 'Temporary accounts are disabled',
                });
            },
        );
        expect(await server.stores.user.getByUsername(body.username)).toBeNull();
    });

    it('refuses a signup carrying a dead bonus code', async () => {
        const body = signupBody();
        await expect(
            server.services.signup.signup({
                req,
                body,
                isTemp: false,
                fingerprint: null,
                bonusCode: 'nosuchcode',
            }),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(await server.stores.user.getByUsername(body.username)).toBeNull();
    });

    it('provisions a temp account with no address or password', async () => {
        const body = signupBody();
        const { user } = await formSignup(body, true);
        expect(user).toMatchObject({
            username: body.username,
            email: null,
            password: null,
        });
    });

    describe('with registration disabled', () => {
        const config = () =>
            (
                server.services.signup as unknown as {
                    config: { disable_user_signup?: boolean };
                }
            ).config;

        const disabled = async (run: () => Promise<void>) => {
            const original = config().disable_user_signup;
            config().disable_user_signup = true;
            try {
                await run();
            } finally {
                config().disable_user_signup = original;
            }
        };

        it('refuses form and temp signups', async () => {
            await disabled(async () => {
                for (const isTemp of [false, true]) {
                    const body = signupBody();
                    await expect(
                        formSignup(body, isTemp),
                    ).rejects.toMatchObject({
                        statusCode: 403,
                        legacyCode: 'signup_disabled',
                    });
                    expect(
                        await server.stores.user.getByUsername(body.username),
                    ).toBeNull();
                }
            });
        });

        it('still lets a signup claim a placeholder row holding its address', async () => {
            const body = signupBody();
            const placeholder = await server.stores.user.create({
                username: `ph_${slug()}`,
                uuid: crypto.randomUUID(),
                password: null,
                email: body.email,
                clean_email: body.email,
            });
            await disabled(async () => {
                const { user } = await formSignup(body);
                expect(user.id).toBe(placeholder.id);
                expect(user.username).toBe(body.username);
                expect(user.password).toEqual(expect.any(String));
            });
        });
    });
});

describe('SignupService confirmation email delivery', () => {
    const makeUser = async (overrides: Record<string, unknown> = {}) => {
        const username = `ce_${slug()}`;
        return server.stores.user.create({
            username,
            uuid: crypto.randomUUID(),
            password: 'hashed',
            email: `${username}@example.com`,
            ...overrides,
        } as never);
    };

    /** Swaps in an email client and collects the alarms raised meanwhile. */
    const withEmail = async (
        send: (...args: unknown[]) => Promise<unknown>,
        run: (alarms: unknown[][]) => Promise<void>,
    ) => {
        const clients = server.clients as unknown as { email: unknown };
        const realEmail = clients.email;
        clients.email = { send };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const alarm = vi
            .spyOn(server.clients.alarm, 'create')
            .mockImplementation((() => undefined) as never);
        try {
            await run(alarm.mock.calls as unknown[][]);
        } finally {
            clients.email = realEmail;
            warn.mockRestore();
            alarm.mockRestore();
        }
    };

    it('sends a link when given a token, on the signup stream by default', async () => {
        const user = await makeUser();
        const send = vi.fn(async () => true);
        await withEmail(send, async (alarms) => {
            expect(
                await server.services.signup.sendConfirmationEmail(
                    user,
                    'resend',
                    { token: 'tok-1' },
                ),
            ).toBe(true);
            expect(alarms).toHaveLength(0);
        });
        expect(send).toHaveBeenCalledWith(
            user.email,
            'email_verification_link',
            {
                link: expect.stringContaining(
                    `/confirm-email-by-token?token=tok-1&user_uuid=${user.uuid}`,
                ),
            },
            { stream: 'signup' },
        );
    });

    it('sends nothing for an account without an address', async () => {
        const user = await makeUser({ email: null });
        const send = vi.fn(async () => true);
        await withEmail(send, async () => {
            expect(
                await server.services.signup.sendConfirmationEmail(
                    user,
                    'signup',
                    { code: '123456' },
                ),
            ).toBe(false);
        });
        expect(send).not.toHaveBeenCalled();
    });

    it('alarms, without throwing, when the message is dropped or the transport fails', async () => {
        const user = await makeUser();
        const outcomes: Array<[() => Promise<unknown>, string]> = [
            [async () => null, 'no transport configured (message dropped)'],
            [
                async () => {
                    throw new Error('smtp refused');
                },
                'smtp refused',
            ],
        ];
        for (const [send, detail] of outcomes) {
            await withEmail(send, async (alarms) => {
                expect(
                    await server.services.signup.sendConfirmationEmail(
                        user,
                        'resend',
                        { code: '123456' },
                    ),
                ).toBe(false);
                expect(alarms).toHaveLength(1);
                expect(alarms[0][0]).toBe(
                    'auth:confirmation-email-send-failed:resend',
                );
                expect(alarms[0][2]).toMatchObject({
                    stage: 'resend',
                    user_uid: user.uuid,
                    email: user.email,
                    email_domain: 'example.com',
                    sole_gate: true,
                    detail,
                });
            });
        }
    });

    it('sends no deferred confirmation to an account that is not email-gate-last', async () => {
        const user = await makeUser({ requires_email_confirmation: true });
        const send = vi.fn(async () => true);
        await withEmail(send, async () => {
            await server.services.signup.sendDeferredConfirmationEmail(user.id);
            await server.services.signup.sendDeferredConfirmationEmail(
                999_999_999,
            );
        });
        expect(send).not.toHaveBeenCalled();
    });
});

describe('SignupService bonus codes', () => {
    const CODE = 'welcome2026';

    const gateWith = (
        validate: Record<string, unknown>,
        gates: Record<string, unknown> = {},
    ) =>
        withListener('puter.signup-bonus.check', patch({ valid: true }), () =>
            withListener('puter.signup-bonus.validate', patch(validate), () =>
                withListener('puter.signup.validate', patch(gates), () =>
                    server.services.signup.runSignupGate({
                        req,
                        data: {},
                        email: `bonus-${slug()}@example.com`,
                        isTemp: false,
                        fingerprint: 'fp-1',
                        bonusCode: CODE,
                    }),
                ),
            ),
        );

    it('adds the verification a redeemed code asks for', async () => {
        const outcome = await gateWith({
            accepted: true,
            requires_card_verification: true,
        });
        expect(outcome).toMatchObject({
            verdict: 'allowed',
            requiresPhoneVerification: false,
            requiresCardVerification: true,
        });
    });

    it('keeps a gate the validate hook already set when the code asks for none', async () => {
        const outcome = await gateWith(
            { accepted: true },
            { requires_phone_verification: true },
        );
        expect(outcome).toMatchObject({
            verdict: 'allowed',
            requiresPhoneVerification: true,
            requiresCardVerification: false,
        });
    });

    it('refuses a code that checks out but is not accepted for this signup', async () => {
        expect(await gateWith({ accepted: false })).toEqual({
            verdict: 'bonus_code_invalid',
        });
    });
});

describe('SignupService address and username conflicts', () => {
    it('refuses a free username whose home path is already occupied', async () => {
        const body = signupBody();
        const squatter = await server.stores.user.create({
            username: `sq_${slug()}`,
            uuid: crypto.randomUUID(),
            password: 'hashed',
            email: null,
        });
        await server.clients.db.write(
            'INSERT INTO `fsentries` (`uuid`, `name`, `path`, `user_id`, `is_dir`, `modified`) VALUES (?, ?, ?, ?, ?, ?)',
            [
                crypto.randomUUID(),
                body.username,
                `/${body.username}`,
                squatter.id,
                server.clients.db.booleanValue(true),
                Math.floor(Date.now() / 1000),
            ],
        );

        await expect(formSignup(body)).rejects.toMatchObject({
            statusCode: 400,
            message: 'This username is not available.',
        });
        expect(await server.stores.user.getByUsername(body.username)).toBeNull();
    });

    it('refuses to confirm an address another account already confirmed', async () => {
        const email = `rival-${slug()}@example.com`;
        const placeholder = await server.stores.user.create({
            username: `pl_${slug()}`,
            uuid: crypto.randomUUID(),
            password: null,
            email,
            clean_email: email,
            requires_email_confirmation: true,
        });
        const rival = await server.stores.user.create({
            username: `rv_${slug()}`,
            uuid: crypto.randomUUID(),
            password: 'hashed',
            email,
            clean_email: email,
        });
        await server.stores.user.update(rival.id, { email_confirmed: true });
        const user = (await server.stores.user.getById(placeholder.id, {
            force: true,
        }))!;

        await expect(
            server.services.signup.confirmEmail(user),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'email_already_in_use',
        });
        expect(
            (await server.stores.user.getById(placeholder.id, { force: true }))
                ?.email_confirmed,
        ).toBeFalsy();
    });

    describe('an address held by an unconfirmed team seat', () => {
        const makeSeat = async () => {
            const email = `seat-${slug()}@example.com`;
            const seat = await server.stores.user.create({
                username: `st_${slug()}`,
                uuid: crypto.randomUUID(),
                password: null,
                email,
                clean_email: email,
            });
            return { seat, email };
        };

        it('does not count as a holder unless the signup is about to take it', async () => {
            const { seat, email } = await makeSeat();
            installSeatStub(server as never, [seat.id]);

            expect(
                await server.services.signup.signupEmailHolder(email),
            ).toBeNull();
            expect(
                (await server.stores.user.getById(seat.id, { force: true }))
                    ?.email,
            ).toBe(email);
        });

        it('stays the holder when the seat will not give the address up', async () => {
            const { seat, email } = await makeSeat();
            installSeatStub(server as never, [seat.id], { released: false });

            const holder = await server.services.signup.signupEmailHolder(
                email,
                { releaseSeat: true },
            );
            expect(holder?.id).toBe(seat.id);
        });

        it('frees the address once the seat releases it', async () => {
            const { seat, email } = await makeSeat();
            installSeatStub(server as never, [seat.id]);

            expect(
                await server.services.signup.signupEmailHolder(email, {
                    releaseSeat: true,
                }),
            ).toBeNull();
            expect(
                (await server.stores.user.getById(seat.id, { force: true }))
                    ?.email,
            ).toBeNull();
        });
    });
});

describe('SignupService deferred confirmation code', () => {
    it('mints and stores a code for an email-gate-last account that has none', async () => {
        const username = `dc_${slug()}`;
        const created = await server.stores.user.create({
            username,
            uuid: crypto.randomUUID(),
            password: 'hashed',
            email: `${username}@example.com`,
            requires_email_confirmation: true,
        });
        await server.stores.user.updateMetadata(created.id, {
            emailGateLast: true,
        });
        const send = vi.fn(async () => true);
        const clients = server.clients as unknown as { email: unknown };
        const realEmail = clients.email;
        clients.email = { send };
        try {
            await server.services.signup.sendDeferredConfirmationEmail(
                created.id,
            );
            // Once per account.
            await server.services.signup.sendDeferredConfirmationEmail(
                created.id,
            );
        } finally {
            clients.email = realEmail;
        }

        const stored = await server.stores.user.getById(created.id, {
            force: true,
        });
        expect(stored?.email_confirm_code).toMatch(/^\d{6}$/);
        expect(stored?.metadata).toMatchObject({ emailGateLastSent: true });
        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith(
            `${username}@example.com`,
            'email_verification_code',
            { code: stored?.email_confirm_code },
            { stream: 'signup' },
        );
    });
});
