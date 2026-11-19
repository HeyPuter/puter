import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../../testUtil.js';

describe('changing an email that is still waiting for its code', () => {
    let env: PuterTestEnv;
    const password = 'pending-email-password';
    const links = new Map<string, string>();
    let smsConfigured: ReturnType<typeof vi.spyOn>;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
        vi.spyOn(env.server.clients.email, 'send').mockImplementation(
            async (to, template, values) => {
                if (template === 'email_verification_link')
                    links.set(to, String(values?.link));
                return null;
            },
        );
        // Phone verification can run, so the change asks for it.
        smsConfigured = vi
            .spyOn(env.server.clients.prelude, 'isConfigured')
            .mockReturnValue(true);
    }, 120_000);
    afterAll(async () => {
        await env?.shutdown();
    });

    const account = async (patch: Record<string, unknown>) => {
        const username = `pendmail_${uuidv4().slice(0, 8)}`;
        const credentials = await createTestUser(env.server, {
            username,
            password,
        });
        const user = (await env.server.stores.user.getByUsername(username))!;
        await env.server.stores.user.update(user.id, {
            email: `${username}@example.com`,
            email_confirmed: false,
            requires_email_confirmation: true,
            ...patch,
        });
        return { ...credentials, id: user.id };
    };

    const change = (token: string, newEmail: string) =>
        fetch(new URL('/user-protected/change-email', env.origin), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                cookie: `puter_auth_token=${token}`,
            },
            body: JSON.stringify({ password, new_email: newEmail }),
        });

    const staged = async (id: number) =>
        (await env.server.stores.user.getById(id, { force: true }))!
            .unconfirmed_change_email;

    it('asks for a verified phone first when the account has nothing verified', async () => {
        const user = await account({});
        const response = await change(user.token, `${uuidv4()}@example.com`);
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
            code: 'phone_verification_required',
            factors: ['phone'],
        });
        expect(await staged(user.id)).toBeFalsy();
    });

    it('keeps asking for the code when no phone or card can be verified', async () => {
        const user = await account({});
        smsConfigured.mockReturnValue(false);
        try {
            const response = await change(
                user.token,
                `${uuidv4()}@example.com`,
            );
            expect(response.status).toBe(403);
            expect(await response.json()).toMatchObject({
                code: 'email_confirmation_required',
            });
        } finally {
            smsConfigured.mockReturnValue(true);
        }
        expect(await staged(user.id)).toBeFalsy();
    });

    it('keeps asking a provider-only account for the code', async () => {
        const user = await account({ phone: '+14155550123', password: null });
        const proof = env.server.services.token.sign(
            'oidc-state',
            {
                user_uuid: (await env.server.stores.user.getById(user.id))!
                    .uuid,
                purpose: 'revalidate',
            },
            { expiresIn: '5m' },
        );
        const response = await fetch(
            new URL('/user-protected/change-email', env.origin),
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    cookie: `puter_auth_token=${user.token}; puter_revalidation=${proof}`,
                },
                body: JSON.stringify({ new_email: `${uuidv4()}@example.com` }),
            },
        );
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
            code: 'email_confirmation_required',
        });
        expect(await staged(user.id)).toBeFalsy();
    });

    it('lets an account with a verified phone replace the address, and the link confirms it', async () => {
        const user = await account({ phone: '+14155550123' });
        const newEmail = `${uuidv4()}@example.com`;
        const confirmed: unknown[] = [];
        env.server.clients.event.on('user.email-confirmed', (_key, data) => {
            confirmed.push(data);
        });
        expect((await change(user.token, newEmail)).status).toBe(200);
        expect(
            (await fetch(links.get(newEmail)!, { redirect: 'manual' })).status,
        ).toBe(200);
        const after = await env.server.stores.user.getById(user.id, {
            force: true,
        });
        expect(after).toMatchObject({
            email: newEmail,
            email_confirmed: true,
            requires_email_confirmation: false,
        });
        // The first confirmed address, so its listeners hear about it.
        await vi.waitFor(() =>
            expect(confirmed).toContainEqual({
                user_id: user.id,
                user_uid: after!.uuid,
                email: newEmail,
            }),
        );
    });

    it('still sends a pending phone step first', async () => {
        const user = await account({
            phone: '+14155550123',
            requires_phone_verification: true,
        });
        const response = await change(user.token, `${uuidv4()}@example.com`);
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
            code: 'phone_verification_required',
        });
        expect(await staged(user.id)).toBeFalsy();
    });

    it('keeps refusing a confirmed account with a pending phone step', async () => {
        const user = await account({
            email_confirmed: true,
            requires_email_confirmation: false,
            requires_phone_verification: true,
        });
        const response = await change(user.token, `${uuidv4()}@example.com`);
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
            code: 'phone_verification_required',
        });
    });
});
