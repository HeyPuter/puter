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
        const { result: user, seen } = await capture(
            'puter.signup.success',
            () =>
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
