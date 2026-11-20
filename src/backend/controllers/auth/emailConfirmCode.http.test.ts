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
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../../testUtil.js';

const MINUTE = 60_000;

describe('email confirmation codes', () => {
    let env: PuterTestEnv;
    const codes = new Map<string, string>();

    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 120_000);
    afterAll(async () => {
        await env?.shutdown();
    });
    beforeEach(() => {
        vi.spyOn(env.server.clients.email, 'send').mockImplementation(
            async (to, template, values) => {
                if (template === 'email_verification_code') {
                    codes.set(to, String(values?.code));
                }
                return null;
            },
        );
        vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    const later = (ms: number) => vi.setSystemTime(Date.now() + ms);

    const account = async () => {
        const username = `confirm_${uuidv4().slice(0, 8)}`;
        const email = `${username}@example.com`;
        const { token } = await createTestUser(env.server, {
            username,
            password: 'confirm-code-password',
        });
        const user = (await env.server.stores.user.getByUsername(username))!;
        await env.server.stores.user.update(user.id, {
            email,
            email_confirmed: false,
            requires_email_confirmation: true,
        });
        const call = (path: string, body: Record<string, unknown> = {}) =>
            fetch(new URL(path, env.apiOrigin), {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(body),
            });
        const send = async () => {
            expect((await call('/send-confirm-email')).status).toBe(200);
            return codes.get(email)!;
        };
        const confirm = async (code: string) => {
            const response = await call('/confirm-email', { code });
            return {
                status: response.status,
                body: (await response.json()) as Record<string, unknown>,
            };
        };
        const miss = async (times: number, code: string) => {
            for (let i = 0; i < times; i++) {
                const wrong = code === '000000' ? '111111' : '000000';
                expect(await confirm(wrong)).toEqual({
                    status: 200,
                    body: { email_confirmed: false },
                });
            }
        };
        const confirmed = async () =>
            Boolean(
                (await env.server.stores.user.getById(user.id, {
                    force: true,
                }))!.email_confirmed,
            );
        return { send, confirm, miss, confirmed };
    };

    it('honors a code for an hour from its send', async () => {
        const { send, confirm, confirmed } = await account();
        const code = await send();
        later(59 * MINUTE);
        expect((await confirm(code)).body.email_confirmed).toBe(true);
        expect(await confirmed()).toBe(true);
    });

    it('refuses an expired code with an error the resend path recovers from', async () => {
        const { send, confirm, confirmed } = await account();
        const code = await send();
        later(61 * MINUTE);
        expect(await confirm(code)).toMatchObject({
            status: 400,
            body: { code: 'confirmation_code_expired' },
        });
        expect(await confirmed()).toBe(false);

        const fresh = await send();
        expect((await confirm(fresh)).body.email_confirmed).toBe(true);
    });

    it('refuses a code that was never mailed', async () => {
        const { confirm } = await account();
        expect((await confirm('123456')).body).toMatchObject({
            code: 'confirmation_code_expired',
        });
    });

    it('confirms after nine wrong codes', async () => {
        const { send, confirm, miss } = await account();
        const code = await send();
        await miss(9, code);
        expect((await confirm(code)).body.email_confirmed).toBe(true);
    });

    it('after ten wrong codes refuses even the right one until the hour passes', async () => {
        const { send, confirm, miss, confirmed } = await account();
        const code = await send();
        await miss(10, code);
        // Past the route's own ten-minute window, so only the code budget answers.
        later(11 * MINUTE);
        expect((await confirm(code)).status).toBe(429);
        expect(await confirmed()).toBe(false);

        later(50 * MINUTE);
        const fresh = await send();
        expect((await confirm(fresh)).body.email_confirmed).toBe(true);
    });

    it('after twenty wrong codes in a day refuses until the day passes', async () => {
        const { send, confirm, miss } = await account();
        await miss(10, await send());
        later(61 * MINUTE);
        await miss(10, await send());
        later(61 * MINUTE);
        expect((await confirm(await send())).status).toBe(429);

        later(24 * 60 * MINUTE);
        expect((await confirm(await send())).body.email_confirmed).toBe(true);
    });

    it('honors the code when the marker cannot be read', async () => {
        const { send, confirm } = await account();
        const code = await send();
        const get = env.server.stores.kv.get.bind(env.server.stores.kv);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(env.server.stores.kv, 'get').mockImplementation(
            async (args, opts) => {
                if (
                    typeof args.key === 'string' &&
                    args.key.startsWith('email-confirm-code-sent:')
                ) {
                    throw new Error('kv down');
                }
                return get(args, opts);
            },
        );
        later(2 * 60 * MINUTE);
        expect((await confirm(code)).body.email_confirmed).toBe(true);
    });
});
