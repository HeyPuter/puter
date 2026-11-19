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
import { createHash } from 'node:crypto';
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
import type { EventMap } from '../../clients/event/types.js';
import { PuterServer } from '../../server.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import { setupTestServer } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { credentialExposureKey } from './SignInService.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_URL = 'https://api.pwnedpasswords.com/range/';

let server: PuterServer;
let config: IConfig;

beforeAll(async () => {
    server = await setupTestServer();
    config = (server.services.signIn as unknown as { config: IConfig }).config;
});
afterAll(async () => {
    await server?.shutdown();
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete config.pwnedPasswords;
});

const sha1 = (password: string) =>
    createHash('sha1').update(password).digest('hex').toUpperCase();

const newUser = async (fields: Partial<UserRow> = {}): Promise<UserRow> => {
    const username = `svc_${uuidv4().slice(0, 8)}`;
    return server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: `$2b$08$${uuidv4()}`,
        email: `${username}@example.com`,
        email_confirmed: true,
        ...fields,
    } as never);
};

const fakeReq = (signals: string[] = []) =>
    ({
        headers: {},
        ip: '198.51.100.7',
        requestSignals: signals,
    }) as unknown as Request;

const mails = () => {
    const sent: Array<{ to: string; template: string }> = [];
    vi.spyOn(server.clients.email, 'send').mockImplementation(
        async (to, template) => {
            sent.push({ to, template });
            return {} as never;
        },
    );
    return sent;
};

const exposures = (userUuid: string) => {
    const events: EventMap['puter.signin.credential_exposed'][] = [];
    const listener = async (_key: string, data: unknown) => {
        const event = data as EventMap['puter.signin.credential_exposed'];
        if (event.user_uuid === userUuid) events.push(event);
    };
    server.clients.event.on('puter.signin.credential_exposed', listener);
    return {
        events,
        stop: () =>
            server.clients.event.off(
                'puter.signin.credential_exposed',
                listener,
            ),
    };
};

/** A padded range answer, listing `suffix` with `count`. */
const rangeBody = (suffix: string, count: number) =>
    [`${'0'.repeat(35)}:0`, `${suffix}:${count}`, `${'F'.repeat(35)}:12`].join(
        '\r\n',
    );

const stubRange = (body: string, status = 200) =>
    vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () => new Response(body, { status }));

const record = async (userUuid: string) =>
    (await server.stores.kv.get({ key: credentialExposureKey(userUuid) }))
        .res as Record<string, unknown> | null;

describe('pwned password lookups', () => {
    const password = 'correct horse battery staple';

    it('sends only the hash prefix, and records a listed password without alarming', async () => {
        config.pwnedPasswords = { enabled: true };
        const sent = mails();
        const alarm = vi.spyOn(server.clients.alarm, 'create');
        const output: string[] = [];
        for (const level of ['log', 'warn', 'error', 'info'] as const) {
            vi.spyOn(console, level).mockImplementation((...args) => {
                output.push(args.map(String).join(' '));
            });
        }
        const hash = sha1(password);
        const fetch = stubRange(rangeBody(hash.slice(5), 3));
        const user = await newUser();
        const { events, stop } = exposures(user.uuid);

        const check = server.services.signIn.prepareCredentialCheck(
            fakeReq(),
            user,
            password,
        );
        await check!();
        stop();

        expect(fetch).toHaveBeenCalledTimes(1);
        const [url, init] = fetch.mock.calls[0]!;
        expect(url).toBe(`${RANGE_URL}${hash.slice(0, 5)}`);
        expect(init?.headers).toEqual({ 'Add-Padding': 'true' });
        expect(init?.body).toBeUndefined();

        expect(events).toEqual([
            {
                user_id: user.id,
                user_uuid: user.uuid,
                username: user.username,
                source: 'pwned_passwords',
                notified: true,
            },
        ]);
        expect(sent).toEqual([
            {
                to: user.email,
                template: 'credential_exposure_notification',
            },
        ]);
        expect(alarm).not.toHaveBeenCalled();
        expect(output).toContain(
            `[auth] credential exposed user=${user.uuid} source=pwned_passwords notified=1`,
        );

        const stored = JSON.stringify(await record(user.uuid));
        for (const secret of [
            password,
            hash,
            hash.slice(0, 5),
            hash.slice(5),
        ]) {
            expect(stored).not.toContain(secret);
            expect(output.join('\n')).not.toContain(secret);
        }
    });

    it('treats a padding row (count 0) and an absent suffix as not listed', async () => {
        config.pwnedPasswords = { enabled: true };
        const hash = sha1(password);
        for (const body of [
            rangeBody(hash.slice(5), 0),
            rangeBody('A'.repeat(35), 4),
        ]) {
            vi.restoreAllMocks();
            stubRange(body);
            const user = await newUser();
            await server.services.signIn.prepareCredentialCheck(
                fakeReq(),
                user,
                password,
            )!();
            expect(await record(user.uuid)).toBeNull();
        }
    });

    it('does nothing while switched off and no signal is present', () => {
        const fetch = vi.spyOn(globalThis, 'fetch');
        expect(
            server.services.signIn.prepareCredentialCheck(
                fakeReq(['bot']),
                { uuid: uuidv4() } as UserRow,
                password,
            ),
        ).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('fails open on a timeout and logs nothing about the password', async () => {
        config.pwnedPasswords = { enabled: true, timeoutMs: 20 };
        const output: string[] = [];
        vi.spyOn(console, 'warn').mockImplementation((...args) => {
            output.push(args.map(String).join(' '));
        });
        vi.spyOn(globalThis, 'fetch').mockImplementation(
            (_url, init) =>
                new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () =>
                        reject(init.signal!.reason),
                    );
                }),
        );
        const user = await newUser();
        await server.services.signIn.prepareCredentialCheck(
            fakeReq(),
            user,
            password,
        )!();
        expect(await record(user.uuid)).toBeNull();
        expect(output).toContain(
            '[auth] pwned-passwords lookup failed: TimeoutError',
        );
        const hash = sha1(password);
        expect(output.join('\n')).not.toContain(hash.slice(0, 5));
    });

    it('a sign-in both sources report gets one email and one alarm', async () => {
        config.pwnedPasswords = { enabled: true };
        const sent = mails();
        const alarm = vi.spyOn(server.clients.alarm, 'create');
        stubRange(rangeBody(sha1(password).slice(5), 9));
        const user = await newUser();
        const { events, stop } = exposures(user.uuid);
        await server.services.signIn.prepareCredentialCheck(
            fakeReq(['credential_exposed']),
            user,
            password,
        )!();
        stop();
        expect(events.map((e) => [e.source, e.notified])).toEqual([
            ['edge', true],
            ['pwned_passwords', true],
        ]);
        expect(sent).toHaveLength(1);
        expect(
            alarm.mock.calls.filter(
                ([id]) => id === `auth:credential-exposed:${user.uuid}`,
            ),
        ).toHaveLength(1);
        expect(await record(user.uuid)).toMatchObject({
            sources: ['edge', 'pwned_passwords'],
        });
    });

    // Leaves the breaker open, so it runs last.
    it('skips lookups for five minutes after five failures in a row', async () => {
        config.pwnedPasswords = { enabled: true };
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const user = await newUser();
        const lookup = () =>
            server.services.signIn.prepareCredentialCheck(
                fakeReq(),
                user,
                password,
            )!();

        // A success first, so earlier failures don't count toward the run.
        stubRange(rangeBody('A'.repeat(35), 1));
        await lookup();
        vi.restoreAllMocks();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const failing = stubRange('unavailable', 503);
        for (let i = 0; i < 5; i++) await lookup();
        expect(failing).toHaveBeenCalledTimes(5);
        await lookup();
        expect(failing).toHaveBeenCalledTimes(5);

        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + 5 * 60_000 + 1000);
        await lookup();
        expect(failing).toHaveBeenCalledTimes(6);
    });
});

describe('credential exposure notices', () => {
    it('go out once per password and at most once in 30 days', async () => {
        const sent = mails();
        const user = await newUser();
        const expose = (row: UserRow) =>
            server.services.signIn.recordCredentialExposure(row, [
                'pwned_passwords',
            ]);

        await expose(user);
        await expose(user);
        expect(sent).toHaveLength(1);

        // A new password inside the window waits for it.
        const changed = { ...user, password: `$2b$08$${uuidv4()}` };
        await expose(changed);
        expect(sent).toHaveLength(1);

        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + 31 * DAY_MS);
        await expose(changed);
        expect(sent).toHaveLength(2);

        // Past the window, the password already noticed stays quiet.
        vi.setSystemTime(Date.now() + 31 * DAY_MS);
        await expose(changed);
        expect(sent).toHaveLength(2);
    });

    it('go out once when sign-ins report the same password at once', async () => {
        const sent = mails();
        const user = await newUser();
        await Promise.all(
            Array.from({ length: 4 }, () =>
                server.services.signIn.recordCredentialExposure(user, ['edge']),
            ),
        );
        expect(sent).toHaveLength(1);
    });

    it('are skipped when the notice cannot be claimed', async () => {
        const sent = mails();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const user = await newUser();
        const kv = server.stores.kv;
        const set = kv.set.bind(kv);
        vi.spyOn(kv, 'set').mockImplementation(async (args, opts) => {
            if (String(args.key).includes('credential-exposure')) {
                throw new Error('kv down');
            }
            return set(args, opts);
        });
        await server.services.signIn.recordCredentialExposure(user, ['edge']);
        expect(sent).toHaveLength(0);
    });

    it('stay quiet for an unchanged password however long it lasts', async () => {
        const sent = mails();
        const user = await newUser();
        const expose = () =>
            server.services.signIn.recordCredentialExposure(user, ['edge']);
        await expose();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + 400 * DAY_MS);
        await expose();
        expect(sent).toHaveLength(1);
    });

    it('skip an account without an email, and still record', async () => {
        const sent = mails();
        const user = await newUser({ email: null });
        await server.services.signIn.recordCredentialExposure(user, ['edge']);
        expect(sent).toHaveLength(0);
        expect(await record(user.uuid)).toMatchObject({
            sources: ['edge'],
            passwordTag: expect.stringMatching(/^[0-9a-f]{16}$/),
        });
    });
});

describe('sign-in exemptions', () => {
    it('a temporary account is never dormant', async () => {
        const user = await newUser({
            password: null,
            email: null,
            email_confirmed: false,
            last_activity_ts: new Date(Date.now() - 400 * DAY_MS)
                .toISOString()
                .slice(0, 19)
                .replace('T', ' '),
        } as never);
        let seen: EventMap['puter.signin.validate'] | undefined;
        const listener = async (_key: string, data: unknown) => {
            const event = data as EventMap['puter.signin.validate'];
            if (event.user.uuid === user.uuid) seen = { ...event };
        };
        server.clients.event.on('puter.signin.validate', listener);
        const deferred: Array<() => Promise<void>> = [];
        try {
            const result = await server.services.signIn.signIn({
                req: fakeReq(),
                user,
                method: 'oidc',
                device: Promise.resolve(null),
                openSession: async () => ({
                    sessionUuid: uuidv4(),
                    guiToken: 'gui',
                }),
                afterResponse: (task) => deferred.push(task),
            });
            expect(result.user.requires_email_confirmation).toBeFalsy();
        } finally {
            server.clients.event.off('puter.signin.validate', listener);
        }
        expect(seen).toMatchObject({
            is_dormant: false,
            account: { is_temp: true, oidc_linked: true },
        });
        expect(seen!.dormant_days).toBeGreaterThanOrEqual(399);
        expect(deferred).toHaveLength(0);
    });
});
