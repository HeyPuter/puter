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

/**
 * Signup bonus codes through the real controller: the check route, the signup
 * hand-off to `puter.signup-bonus.validate`, and the awaited
 * `user.card-verified` a grant on card verification depends on. Tests stand in
 * for the extension with shared listeners (EventClient has no `off()`).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../../core/actor.js';
import type { EventMap } from '../../clients/event/types.js';
import type { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';

let server: PuterServer;
let controller: any;

type Handler<K extends keyof EventMap> = ((data: EventMap[K]) => void) | null;

let onBonusCheck: Handler<'puter.signup-bonus.check'> = null;
let onBonusValidate: Handler<'puter.signup-bonus.validate'> = null;
let onSignupValidate: ((data: Record<string, unknown>) => void) | null = null;
let onCardConfirm: ((data: Record<string, unknown>) => void) | null = null;
let onCardVerified: (() => Promise<void>) | null = null;
const heardSignupSuccess: Array<Record<string, unknown>> = [];

beforeAll(async () => {
    server = await setupTestServer();
    controller = server.controllers.auth;
    const events = server.clients.event;
    events.on('puter.signup-bonus.check', (_k, data) => onBonusCheck?.(data));
    events.on('puter.signup-bonus.validate', (_k, data) =>
        onBonusValidate?.(data),
    );
    events.on('puter.signup.validate', (_k, data) =>
        onSignupValidate?.(data as Record<string, unknown>),
    );
    events.on('puter.signup.success', (_k, data) => {
        heardSignupSuccess.push(data as Record<string, unknown>);
    });
    events.on('puter.card-verification.confirm', (_k, data) =>
        onCardConfirm?.(data as Record<string, unknown>),
    );
    events.on('user.card-verified' as never, async () => {
        await onCardVerified?.();
    });
});

afterAll(async () => {
    await server?.shutdown();
});

afterEach(() => {
    onBonusCheck = null;
    onBonusValidate = null;
    onSignupValidate = null;
    onCardConfirm = null;
    onCardVerified = null;
});

const uniq = () => Math.random().toString(36).slice(2, 10);

/** A check listener that finds the code open, as an extension would. */
const openCheck: Handler<'puter.signup-bonus.check'> = (data) => {
    data.valid = true;
    data.display = { title: 'T', description: 'D' };
};

const makeReq = (
    body: Record<string, unknown> = {},
    extra: { actor?: Actor; ip?: string } = {},
) => ({
    body,
    headers: {},
    connection: { remoteAddress: extra.ip ?? '127.0.0.1' },
    socket: { remoteAddress: extra.ip ?? '127.0.0.1' },
    ip: extra.ip ?? '127.0.0.1',
    params: {},
    actor: extra.actor,
});

const makeRes = () => {
    const res = {
        statusCode: 200,
        body: undefined as unknown,
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        json(b: unknown) {
            this.body = b;
            return this;
        },
        cookie() {
            return this;
        },
        clearCookie() {
            return this;
        },
        send() {
            return this;
        },
        end() {
            return this;
        },
    };
    return res;
};

const signupBody = (extra: Record<string, unknown> = {}) => {
    const username = `b_${uniq()}`;
    return {
        username,
        email: `${username}@test.local`,
        password: 'correct-horse-battery',
        ...extra,
    };
};

const signup = async (body: Record<string, unknown>) => {
    const res = makeRes();
    await controller.handleSignup(makeReq(body), res);
    return res;
};

const findUser = (username: unknown) =>
    server.stores.user.getByUsername(username as string, { force: true });

/** `puter.signup.success` is fire-and-forget; wait for it to land. */
const waitForSuccess = async (userUuid: string) => {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
        const hit = heardSignupSuccess.find((e) => e.user_uuid === userUuid);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('puter.signup.success never arrived');
};

// -- POST /signup/bonus-code/check -----------------------------------

describe('AuthController.handleSignupBonusCheck', () => {
    const check = async (body: Record<string, unknown>) => {
        const res = makeRes();
        await controller.handleSignupBonusCheck(makeReq(body), res);
        return res.body;
    };

    it('answers invalid when no extension is listening', async () => {
        expect(await check({ bonusCode: 'startup3m-abcd1234' })).toEqual({
            valid: false,
        });
    });

    it('returns the display and requirements a listener fills in', async () => {
        let seen: EventMap['puter.signup-bonus.check'] | null = null;
        onBonusCheck = (data) => {
            seen = { ...data };
            data.valid = true;
            data.display = { title: '3 months of Basic', description: 'Free' };
            data.requirements = { phone: true, card: false };
        };
        expect(
            await check({
                bonusCode: 'Startup3M-ABCD1234',
                fingerprint: 'fp1',
            }),
        ).toEqual({
            valid: true,
            display: { title: '3 months of Basic', description: 'Free' },
            requirements: { phone: true, card: false },
        });
        // Listeners only ever see the canonical form.
        expect(seen).toMatchObject({
            code: 'startup3mabcd1234',
            fingerprint: 'fp1',
            ip: '127.0.0.1',
        });
    });

    it('forwards an opaque reason for a refused code', async () => {
        onBonusCheck = (data) => {
            data.reason = 'ended';
        };
        expect(await check({ bonusCode: 'startup3m-abcd1234' })).toEqual({
            valid: false,
            reason: 'ended',
        });
    });

    it('treats valid without display as invalid', async () => {
        onBonusCheck = (data) => {
            data.valid = true;
        };
        expect(await check({ bonusCode: 'startup3m-abcd1234' })).toEqual({
            valid: false,
        });
    });

    it('answers a malformed code without consulting listeners', async () => {
        let called = false;
        onBonusCheck = () => {
            called = true;
        };
        expect(await check({ bonusCode: 'a:b' })).toEqual({ valid: false });
        expect(called).toBe(false);
    });

    it('400s a non-string bonusCode', async () => {
        await expect(
            controller.handleSignupBonusCheck(
                makeReq({ bonusCode: 42 }),
                makeRes(),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});

// -- POST /signup with bonusCode -------------------------------------

describe('AuthController.handleSignup with a bonus code', () => {
    it('refuses the signup when nothing accepts the code', async () => {
        const body = signupBody({ bonusCode: 'startup3m-abcd1234' });
        await expect(signup(body)).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'bonus_code_invalid',
        });
        expect(await findUser(body.username)).toBeFalsy();
    });

    it('refuses a dead code before the abuse gate records the attempt', async () => {
        let validated = false;
        onSignupValidate = () => {
            validated = true;
        };
        await expect(
            signup(signupBody({ bonusCode: 'startup3m-abcd1234' })),
        ).rejects.toMatchObject({ legacyCode: 'bonus_code_invalid' });
        expect(validated).toBe(false);
    });

    it('still refuses a code that passed the check but is refused after the gate', async () => {
        onBonusCheck = openCheck;
        const body = signupBody({ bonusCode: 'startup3m-abcd1234' });
        await expect(signup(body)).rejects.toMatchObject({
            legacyCode: 'bonus_code_invalid',
        });
        expect(await findUser(body.username)).toBeFalsy();
    });

    it('refuses a malformed code before any listener runs', async () => {
        let called = false;
        onBonusValidate = () => {
            called = true;
        };
        await expect(
            signup(signupBody({ bonusCode: 'nope' + '!'.repeat(3) })),
        ).rejects.toMatchObject({ legacyCode: 'bonus_code_invalid' });
        expect(called).toBe(false);
    });

    it('400s a non-string bonusCode', async () => {
        await expect(
            signup(signupBody({ bonusCode: ['startup3m'] })),
        ).rejects.toMatchObject({ statusCode: 400, legacyCode: 'bad_request' });
    });

    it('applies the requirements an accepted code raises and reports the code', async () => {
        onBonusCheck = openCheck;
        let seen: EventMap['puter.signup-bonus.validate'] | null = null;
        onBonusValidate = (data) => {
            seen = { ...data };
            data.accepted = true;
            data.requires_card_verification = true;
        };
        const body = signupBody({
            bonusCode: 'STARTUP6M-abcd1234',
            fingerprint: 'fp-bonus',
        });
        const res = await signup(body);
        expect(
            (res.body as { user: Record<string, unknown> }).user,
        ).toMatchObject({ requires_card_verification: true });

        expect(seen).toMatchObject({
            code: 'startup6mabcd1234',
            email: body.email,
            fingerprint: 'fp-bonus',
            requires_phone_verification: false,
            requires_card_verification: false,
        });
        const user = await findUser(body.username);
        expect(Boolean(user!.requires_card_verification)).toBe(true);
        expect(Boolean(user!.requires_phone_verification)).toBe(false);
        const success = await waitForSuccess(user!.uuid);
        expect(success.bonus_code).toBe('startup6mabcd1234');
    });

    it('keeps a requirement the abuse harness set even if the listener clears it', async () => {
        onBonusCheck = openCheck;
        onSignupValidate = (data) => {
            data.requires_phone_verification = true;
        };
        onBonusValidate = (data) => {
            expect(data.requires_phone_verification).toBe(true);
            data.accepted = true;
            data.requires_phone_verification = false;
        };
        const body = signupBody({ bonusCode: 'startup3m-abcd1234' });
        await signup(body);
        const user = await findUser(body.username);
        expect(Boolean(user!.requires_phone_verification)).toBe(true);
    });

    it('never offers the code for a signup the abuse harness blocked', async () => {
        onBonusCheck = openCheck;
        let called = false;
        onSignupValidate = (data) => {
            data.allow = false;
            data.message = 'Signup blocked';
        };
        onBonusValidate = () => {
            called = true;
        };
        await expect(
            signup(signupBody({ bonusCode: 'startup3m-abcd1234' })),
        ).rejects.toMatchObject({ statusCode: 403 });
        expect(called).toBe(false);
    });

    it('leaves the success event without a code when none was presented', async () => {
        const body = signupBody();
        await signup(body);
        const user = await findUser(body.username);
        const success = await waitForSuccess(user!.uuid);
        expect(success).not.toHaveProperty('bonus_code');
    });

    it('ignores a bonus code on a temp signup', async () => {
        let called = false;
        onBonusValidate = () => {
            called = true;
        };
        const res = makeRes();
        await controller.handleSignup(
            makeReq({ is_temp: true, bonusCode: 'startup3m-abcd1234' }),
            res,
        );
        expect((res.body as { user: { is_temp: boolean } }).user.is_temp).toBe(
            true,
        );
        expect(called).toBe(false);
    });
});

// -- /card-verification/confirm awaits user.card-verified ------------

describe('AuthController.handleCardVerificationConfirm', () => {
    it('finishes user.card-verified listeners before responding', async () => {
        const body = signupBody();
        await signup(body);
        const created = await findUser(body.username);
        await server.stores.user.update(created!.id, {
            requires_card_verification: 1,
        });
        const actor = {
            user: {
                id: created!.id,
                uuid: created!.uuid,
                username: created!.username,
                email: created!.email ?? null,
                email_confirmed: false,
            },
        } as Actor;

        onCardConfirm = (data) => {
            data.enabled = true;
            data.verified = true;
            data.fingerprint = 'fp_card_1';
        };
        let listenerDone = false;
        onCardVerified = async () => {
            await new Promise((r) => setTimeout(r, 30));
            listenerDone = true;
        };

        const res = makeRes();
        await controller.handleCardVerificationConfirm(
            makeReq({ setup_intent_id: 'seti_1' }, { actor }),
            res,
        );
        expect(res.body).toMatchObject({ card_verified: true });
        expect(listenerDone).toBe(true);
    });
});
