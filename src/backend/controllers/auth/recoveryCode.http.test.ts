import { v4 as uuidv4 } from 'uuid';
import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { hashRecoveryCode } from '../../services/auth/OTPUtil.js';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../../testUtil.js';

describe('recovery code consumption', () => {
    let env: PuterTestEnv;
    const password = 'recovery-code-password';

    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 120_000);
    afterAll(async () => {
        await env?.shutdown();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    // Hold the same cached snapshot until every concurrent request has read it.
    const overlapReads = (userUuid: string, count: number) => {
        const redis = env.server.clients.redis;
        const get = redis.get.bind(redis);
        const ready = Promise.withResolvers<void>();
        let reads = 0;
        vi.spyOn(redis, 'get').mockImplementation(async (key: string) => {
            const value = await get(key);
            if (key.includes(userUuid) && reads < count) {
                if (++reads === count) ready.resolve();
                await ready.promise;
            }
            return value;
        });
    };

    const post = async (path: string, body: Record<string, unknown>) => {
        const response = await fetch(new URL(path, env.origin), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
        return { response, body: await response.json() };
    };

    const account = async (codes: string[]) => {
        const username = `recovery_${uuidv4().slice(0, 8)}`;
        await createTestUser(env.server, { username, password });
        const user = (await env.server.stores.user.getByUsername(username))!;
        await env.server.stores.user.update(user.id, {
            otp_enabled: true,
            otp_secret: 'TESTSECRETBASE32',
            otp_recovery_codes: codes.map(hashRecoveryCode).join(','),
        });
        const challenge = async () => {
            const { response, body } = await post('/login', {
                username,
                password,
            });
            expect(response.status).toBe(202);
            expect(body.next_step).toBe('otp');
            return body.otp_jwt_token as string;
        };
        return { user, challenge };
    };

    it('allows only one concurrent redemption of the same code', async () => {
        const { user, challenge } = await account(['RECOVER1', 'RECOVER2']);
        const tokens = await Promise.all([challenge(), challenge()]);
        overlapReads(user.uuid, tokens.length);
        const results = await Promise.all(
            tokens.map((token) =>
                post('/login/recovery-code', { token, code: 'RECOVER1' }),
            ),
        );
        expect(
            results.filter((result) => result.body.next_step === 'complete'),
        ).toHaveLength(1);
        expect(
            results.filter((result) => result.body.proceed === false),
        ).toHaveLength(1);
        const after = await env.server.stores.user.getById(user.id, {
            force: true,
        });
        expect(after!.otp_recovery_codes).toBe(hashRecoveryCode('RECOVER2'));
    });

    it('consumes different concurrent codes without restoring either one', async () => {
        const codes = ['RECOVER1', 'RECOVER2', 'RECOVER3'];
        const { user, challenge } = await account(codes);
        const tokens = await Promise.all(codes.map(() => challenge()));
        overlapReads(user.uuid, tokens.length);
        const results = await Promise.all(
            codes.map((code, index) =>
                post('/login/recovery-code', { token: tokens[index], code }),
            ),
        );
        expect(
            results.every((result) => result.body.next_step === 'complete'),
        ).toBe(true);
        const after = await env.server.stores.user.getById(user.id, {
            force: true,
        });
        expect(after!.otp_recovery_codes).toBe('');
        const replay = await post('/login/recovery-code', {
            token: tokens[0],
            code: codes[0],
        });
        expect(replay.body).toMatchObject({ proceed: false });
    });

    it.each([{ code: 123456 }, { code: {} }, { code: [] }])(
        'rejects a non-string recovery code $code without consuming a code',
        async ({ code }) => {
            const { user, challenge } = await account(['RECOVER1']);
            const result = await post('/login/recovery-code', {
                token: await challenge(),
                code,
            });
            expect(result.response.status).toBe(400);
            expect(
                (await env.server.stores.user.getById(user.id, {
                    force: true,
                }))!.otp_recovery_codes,
            ).toBe(hashRecoveryCode('RECOVER1'));
        },
    );
});
