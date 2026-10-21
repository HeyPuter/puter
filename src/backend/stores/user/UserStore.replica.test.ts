import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../../testUtil.js';

const tag = () => Math.random().toString(36).slice(2, 10);

describe('user row updates re-cached from a lagging replica', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const login = (username: string, password: string, agent: string) =>
        fetch(new URL('/login', env.origin), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'user-agent': agent,
            },
            body: JSON.stringify({ username, password }),
        });

    const rawRow = async (id: number) =>
        (
            await env.server.clients.db.pread(
                'SELECT * FROM `user` WHERE `id` = ?',
                [id],
            )
        )[0];

    const establishedUser = async (username: string, password: string) => {
        const creds = await createTestUser(env.server, { username, password });
        const user = (await env.server.stores.user.getByUsername(username))!;
        await env.server.stores.user.update(user.id, {
            email: `${username}@test.local`,
            email_confirmed: true,
            taskbar_items: JSON.stringify([{ name: 'editor', type: 'app' }]),
        });
        return { creds, user };
    };

    const lagReplica = (snapshot: Record<string, unknown>) => {
        const db = env.server.clients.db;
        const original = db.tryHardRead.bind(db);
        const ids = new Set(
            [snapshot.id, snapshot.uuid, snapshot.username, snapshot.email]
                .filter((v) => v != null)
                .map(String),
        );
        let served = 0;
        const spy = vi
            .spyOn(db, 'tryHardRead')
            .mockImplementation(async (sql: string, params: unknown[] = []) => {
                if (
                    /^SELECT \* FROM `user` WHERE `\w+` = \?/.test(sql) &&
                    ids.has(String(params[0]))
                ) {
                    served++;
                    return [{ ...snapshot }];
                }
                return original(sql, params);
            });
        return {
            served: () => served,
            catchUp: () => spy.mockRestore(),
        };
    };

    it.each([true, false])(
        'uses current two-factor state %s while a replica lags',
        async (enabled) => {
            const username = `otp_${tag()}`;
            const password = 'otp-replica-password';
            const { user } = await establishedUser(username, password);
            await env.server.stores.user.update(user.id, {
                otp_enabled: !enabled,
                otp_secret: 'TESTSECRETBASE32',
            });
            const before = await rawRow(user.id);
            await env.server.stores.user.update(user.id, {
                otp_enabled: enabled,
            });
            const replica = lagReplica(before);
            let response: Response;
            try {
                response = await login(username, password, 'otp-replica-test');
            } finally {
                replica.catchUp();
            }
            expect(response.status).toBe(enabled ? 202 : 200);
            expect((await response.json()).next_step).toBe(
                enabled ? 'otp' : 'complete',
            );
            expect(replica.served()).toBe(0);
        },
    );

    it('rejects the old password after a reset while a replica lags', async () => {
        const username = `rs_${tag()}`;
        const oldPassword = 'old-password-1';
        const newPassword = 'new-password-1';
        const { user } = await establishedUser(username, oldPassword);
        const recoveryToken = uuidv4();
        await env.server.stores.user.update(user.id, {
            pass_recovery_token: recoveryToken,
        });
        const before = await rawRow(user.id);

        const jwt = env.server.services.token.sign(
            'otp',
            {
                token: recoveryToken,
                user_uid: user.uuid,
                email: `${username}@test.local`,
                purpose: 'pass-recovery',
            },
            { expiresIn: '1h' },
        );
        const reset = await fetch(
            new URL('/set-pass-using-token', env.origin),
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ token: jwt, password: newPassword }),
            },
        );
        expect(reset.status).toBe(200);

        const after = await rawRow(user.id);
        expect(await bcrypt.compare(newPassword, String(after.password))).toBe(
            true,
        );

        const replica = lagReplica(before);
        let first: Response;
        try {
            first = await login(username, oldPassword, 'secscan-20b-a');
        } finally {
            replica.catchUp();
        }
        expect(replica.served()).toBe(0);
        expect(first.status).toBe(401);

        const second = await login(username, oldPassword, 'secscan-20b-a');
        expect(second.status).toBe(401);
        const withNew = await login(username, newPassword, 'secscan-20b-a');
        expect(withNew.status).toBe(200);
    });

    it('rejects a suspended user on a peer while its replica lags', async () => {
        const username = `su_${tag()}`;
        const password = 'suspend-password-1';
        const { creds, user } = await establishedUser(username, password);
        const before = await rawRow(user.id);

        const idKey = `users:id:${user.id}`;
        const sent: Array<{ cacheKey: string[]; data?: string }> = [];
        const events = env.server.clients.event;
        const emit = events.emit.bind(events);
        const emitSpy = vi
            .spyOn(events, 'emit')
            .mockImplementation((key, data, meta) => {
                if (key === 'outer.cacheUpdate') {
                    sent.push(
                        data as unknown as {
                            cacheKey: string[];
                            data?: string;
                        },
                    );
                }
                return emit(key, data, meta);
            });
        try {
            await env.server.stores.user.update(user.id, {
                suspended: true,
                suspended_at: Math.floor(Date.now() / 1000),
            });
            await env.server.services.auth.revokeAllSessionsForUserId(user.id);
        } finally {
            emitSpy.mockRestore();
        }

        const replica = lagReplica(before);
        let relogin: Response;
        try {
            for (const payload of sent) {
                events.emit(
                    'outer.cacheUpdate',
                    payload as never,
                    {
                        from_outside: true,
                    } as never,
                );
            }
            for (
                let i = 0;
                i < 50 && (await env.server.clients.redis.get(idKey));
                i++
            ) {
                await new Promise((r) => setTimeout(r, 10));
            }
            expect(await env.server.clients.redis.get(idKey)).toBeNull();

            relogin = await login(username, password, 'secscan-20b-b');
        } finally {
            replica.catchUp();
        }
        expect(replica.served()).toBe(0);
        expect(relogin.status).toBe(401);

        const oldSession = await fetch(new URL('/whoami', env.apiOrigin), {
            headers: { authorization: `Bearer ${creds.token}` },
        });
        expect(oldSession.status).not.toBe(200);

        expect(Boolean((await rawRow(user.id)).suspended)).toBe(true);
    });
});
