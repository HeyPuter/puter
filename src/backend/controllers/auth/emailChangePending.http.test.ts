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
    const PHONE = '+14155550123';
    // What a dormant sign-in records about the number the account had.
    const BEFORE = { phoneAtDormantSignIn: PHONE };
    let smsConfigured: ReturnType<typeof vi.spyOn>;
    const checkVerification = vi.fn(async () => ({ status: 'success' }));

    beforeAll(async () => {
        env = await setupPuterTestEnv();
        vi.spyOn(env.server.clients.email, 'send').mockImplementation(
            async (to, template, values) => {
                if (template === 'email_verification_link')
                    links.set(to, String(values?.link));
                return null;
            },
        );
        const prelude = env.server.clients.prelude;
        smsConfigured = vi.spyOn(prelude, 'isConfigured').mockReturnValue(true);
        vi.spyOn(prelude, 'checkVerification').mockImplementation(
            checkVerification as never,
        );
    }, 120_000);
    afterAll(async () => {
        await env?.shutdown();
    });

    const account = async ({
        metadata,
        ...patch
    }: Record<string, unknown> & { metadata?: Record<string, unknown> }) => {
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
        if (metadata)
            await env.server.stores.user.updateMetadata(user.id, metadata);
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

    it.each([
        ['nothing verified', {}],
        ['a number with no record from before', { phone: PHONE }],
        [
            'a number other than the one it had before',
            { phone: '+14155550199', metadata: BEFORE },
        ],
        ['only a card', { card_fingerprint: 'fp_1' }],
    ])('keeps asking for the code from an account with %s', async (_, patch) => {
        const user = await account(patch);
        const response = await change(user.token, `${uuidv4()}@example.com`);
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
            code: 'email_confirmation_required',
        });
        expect(await staged(user.id)).toBeFalsy();
        // No phone step was started for it either.
        expect(
            (await env.server.stores.user.getById(user.id, { force: true }))!
                .requires_phone_verification,
        ).toBeFalsy();
    });

    it('keeps asking a provider-only account for the code', async () => {
        const user = await account({
            phone: PHONE,
            metadata: BEFORE,
            password: null,
        });
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

    it('asks for the number it had before, then lets the proven account replace the address', async () => {
        const user = await account({ phone: PHONE, metadata: BEFORE });
        const newEmail = `${uuidv4()}@example.com`;
        const confirmed: unknown[] = [];
        env.server.clients.event.on('user.email-confirmed', (_key, data) => {
            confirmed.push(data);
        });

        // Having the number isn't enough: it has to be proven now.
        const asked = await change(user.token, newEmail);
        expect(asked.status).toBe(403);
        expect(await asked.json()).toMatchObject({
            code: 'phone_verification_required',
        });
        expect(await staged(user.id)).toBeFalsy();
        expect(
            (await env.server.stores.user.getById(user.id, { force: true }))!
                .requires_phone_verification,
        ).toBe(true);

        // The code sent to that number clears the step.
        const proof = await fetch(new URL('/confirm-phone', env.apiOrigin), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${user.token}`,
            },
            body: JSON.stringify({ code: '123456' }),
        });
        expect(await proof.json()).toMatchObject({ phone_verified: true });
        expect(checkVerification).toHaveBeenLastCalledWith(PHONE, '123456');

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

    it('keeps asking for the code where no phone code can be sent', async () => {
        const user = await account({ phone: PHONE, metadata: BEFORE });
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
        expect(
            (await env.server.stores.user.getById(user.id, { force: true }))!
                .requires_phone_verification,
        ).toBeFalsy();
    });

    it('still sends a pending phone step first', async () => {
        const user = await account({
            phone: PHONE,
            metadata: BEFORE,
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
